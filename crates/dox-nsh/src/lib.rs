//! Native bridge for the multi-window dox reader.

mod highlight;
mod preview;
mod title;

use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{
        Arc, LazyLock, Mutex, MutexGuard, Weak,
        atomic::{AtomicU64, Ordering},
    },
    thread,
};

use anyhow::{Context, Result, anyhow, ensure};
use dox_core::{
    Attachment, Diagnostic, Library, LibraryIndex, Note, NoteDocument, PublicationImport, Severity,
    git::GitRepository,
};
use futures_channel::oneshot;
use nsh_core::prelude::*;
use serde::Serialize;

static SESSIONS: LazyLock<Mutex<Sessions>> = LazyLock::new(Mutex::default);
static OPENS: Mutex<()> = Mutex::new(());

#[derive(Default)]
struct Sessions {
    by_id: HashMap<String, SessionSlot>,
    // The root index does not keep watchers alive after their last use.
    by_root: HashMap<PathBuf, Weak<RootWatch>>,
}

impl Sessions {
    fn opening_session(&mut self, id: &str, generation: &Arc<()>) -> Result<&mut SessionSlot> {
        self.by_id
            .get_mut(id)
            .filter(|slot| Arc::ptr_eq(&slot.generation, generation))
            .context("The library session was closed")
    }

    // OPENS serializes the lookup and watcher setup for each canonical root.
    fn root_watch(&mut self, root: &Path) -> Arc<RootWatch> {
        self.by_root.retain(|_, watch| watch.strong_count() != 0);
        if let Some(watch) = self.by_root.get(root).and_then(Weak::upgrade) {
            return watch;
        }
        let watch = Arc::new(RootWatch::default());
        self.by_root.insert(root.to_owned(), Arc::downgrade(&watch));
        watch
    }
}

#[derive(Default)]
struct SessionSlot {
    // An open keeps this token while the picker or worker is running. Close
    // removes the slot, so that open cannot install into a reused session ID.
    generation: Arc<()>,
    active: Option<Session>,
}

#[derive(Clone)]
struct Session {
    library: Library,
    watch: Arc<RootWatch>,
}

#[derive(Default)]
struct RootWatch {
    version: Arc<AtomicU64>,
    // Keep the watcher alive without adding a direct notify dependency.
    watcher: Mutex<Option<Box<dyn Send>>>,
    writes: Mutex<()>,
}

impl RootWatch {
    fn ensure_watching(&self, library: &Library) -> Result<Option<String>> {
        let mut watcher = self
            .watcher
            .lock()
            .map_err(|_| anyhow!("The library watcher is unavailable"))?;
        if watcher.is_some() {
            return Ok(None);
        }
        let version = Arc::clone(&self.version);
        match library.watch(move || mark_changed(&version)) {
            Ok(started) => {
                *watcher = Some(Box::new(started));
                Ok(None)
            }
            Err(error) => Ok(Some(format!("{error:#}"))),
        }
    }
}

#[native_module("dox-nsh/native")]
fn native(registry: &mut Registry) {
    registry.module::<Reader>();
    registry.setup(highlight::register);
}

#[derive(Serialize)]
struct Entry {
    id: String,
    title: String,
    title_markup: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title_spans: Option<Vec<title::TitleSpan>>,
    kind: String,
    document: String,
    date: Option<String>,
    links: Vec<String>,
    revision: String,
}

impl From<Note> for Entry {
    fn from(note: Note) -> Self {
        let title = if note.title_text.trim().is_empty() {
            note.id.clone()
        } else {
            note.title_text
        };
        let title_spans = note.title_html.as_deref().and_then(|html| title::spans(html, &title));
        Self {
            title,
            title_markup: note.title,
            title_spans,
            id: note.id,
            kind: note.metadata.kind,
            document: note.metadata.document,
            date: note
                .metadata
                .fields
                .get("date")
                .and_then(|value| value.as_str())
                .map(str::to_owned),
            links: note.links,
            revision: note.revision,
        }
    }
}

#[derive(Serialize)]
struct Opened {
    path: String,
    index: Index,
    watch_error: Option<String>,
}

#[derive(Default, Serialize)]
struct Index {
    entries: Vec<Entry>,
    diagnostics: Vec<Issue>,
}

#[derive(Serialize)]
struct Issue {
    id: String,
    severity: Severity,
    message: String,
    note_id: Option<String>,
    document: Option<String>,
    line: Option<usize>,
    column: Option<usize>,
    target_note_id: Option<String>,
}

impl From<Diagnostic> for Issue {
    fn from(issue: Diagnostic) -> Self {
        // Source coordinates are one-based and must fit exactly in a JS number.
        let valid_coordinate = |&value: &usize| value > 0 && value as u64 <= (1_u64 << 53) - 1;
        let line = issue.line.filter(valid_coordinate);
        Self {
            id: issue.id,
            severity: issue.severity,
            message: issue.message,
            note_id: issue.note_id,
            document: issue.document,
            line,
            column: line.and(issue.column.filter(valid_coordinate)),
            target_note_id: issue.target_note_id,
        }
    }
}

#[derive(Serialize)]
struct GitSummary {
    branch: Option<String>,
    upstream: Option<String>,
    changed: usize,
    ahead: Option<usize>,
    behind: Option<usize>,
}

#[derive(Serialize)]
struct SyncSummary {
    commit: String,
    message: &'static str,
}

#[derive(Serialize)]
struct Reading {
    entry: Entry,
    html: Option<String>,
    source: String,
    revision: String,
    diagnostics: Vec<String>,
    attachments: Vec<Attachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

impl From<LibraryIndex> for Index {
    fn from(index: LibraryIndex) -> Self {
        Self {
            entries: index.notes.into_iter().map(Entry::from).collect(),
            diagnostics: index.diagnostics.into_iter().map(Issue::from).collect(),
        }
    }
}

fn sessions() -> Result<MutexGuard<'static, Sessions>> {
    SESSIONS
        .lock()
        .map_err(|_| anyhow!("The library session is unavailable"))
}

fn active_session(session_id: &str) -> Result<Session> {
    sessions()?
        .by_id
        .get(session_id)
        .and_then(|slot| slot.active.clone())
        .context("Open a library first")
}

fn active_library(session_id: &str) -> Result<Library> {
    active_session(session_id).map(|session| session.library)
}

fn mark_changed(version: &AtomicU64) {
    // Keep the version exactly representable as a JavaScript number.
    const MAX_VERSION: u64 = (1 << 53) - 1;
    let _ = version.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        (current < MAX_VERSION).then(|| current + 1)
    });
}

// Do not remove a write lock left by a crashed process.
struct DiskWriteGuard(PathBuf);

impl Drop for DiskWriteGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn check_sync_journal(git: &Path) -> Result<()> {
    match fs::symlink_metadata(git.join("dox-sync-journal")) {
        Ok(_) => anyhow::bail!(
            "An interrupted sync requires external recovery before writing. Preserve the library and inspect .git/dox-sync-journal."
        ),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("Cannot check .git/dox-sync-journal"),
    }
}

fn lock_disk(root: &Path) -> Result<Option<DiskWriteGuard>> {
    let git = root.join(".git");
    match fs::metadata(&git) {
        Ok(metadata) if metadata.is_dir() => (),
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("Cannot check .git before writing"),
    }
    check_sync_journal(&git)?;
    let lock = git.join("dox-write.lock");
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .context("Cannot lock library writes. Another dox process may be writing. After a crash, preserve files and inspect .git/dox-sync-journal before removing .git/dox-write.lock.")?;
    let guard = DiskWriteGuard(lock);
    // A sync can leave a journal between the first check and lock acquisition.
    check_sync_journal(&git)?;
    Ok(Some(guard))
}

fn with_write_guards<T>(
    library: &Library,
    require_git: bool,
    action: impl FnOnce(&Library) -> Result<T>,
) -> Result<T> {
    let watch = sessions()?.root_watch(library.root());
    let _write = watch.writes
        .lock()
        .map_err(|_| anyhow!("The library write lock is unavailable"))?;
    let disk = lock_disk(library.root())?;
    ensure!(
        !require_git || disk.is_some(),
        "Git sync requires a library at the root of a regular repository"
    );
    action(library)
}

fn reading_json(
    library: &Library,
    document: NoteDocument,
    warning: Option<String>,
) -> Result<String> {
    let mut diagnostics: Vec<_> = document
        .note
        .diagnostics
        .iter()
        .map(|d| d.message.clone())
        .collect();
    let rendered = library.render(&document.note.id);
    let html = match rendered {
        Ok(html) => Some(html),
        Err(error) => {
            let message = error.to_string();
            if !diagnostics.contains(&message) {
                diagnostics.push(message);
            }
            None
        }
    };
    Ok(serde_json::to_string(&Reading {
        revision: document.note.revision.clone(),
        entry: document.note.into(),
        html,
        source: document.source,
        diagnostics,
        attachments: document.attachments,
        warning,
    })?)
}

fn imported_json(library: &Library, imported: PublicationImport) -> Result<String> {
    let warning = (!imported.warnings.is_empty()).then(|| imported.warnings.join("\n"));
    reading_json(library, imported.document, warning)
}

async fn background<T: Send + 'static>(
    job: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let (send, receive) = oneshot::channel();
    thread::Builder::new()
        .name("dox-reader".into())
        .spawn(move || {
            let _ = send.send(job());
        })?;
    receive.await.context("The library worker stopped")?
}

#[cfg(target_os = "macos")]
fn pick_folder() -> Result<Option<PathBuf>> {
    Ok(rfd::FileDialog::new()
        .set_title("Open or create a dox library")
        .pick_folder())
}

#[cfg(not(target_os = "macos"))]
fn pick_folder() -> Result<Option<PathBuf>> {
    anyhow::bail!("The dox NSH reader currently supports macOS only")
}

async fn write_reading(
    session_id: &str,
    action: impl FnOnce(&Library) -> Result<String> + Send + 'static,
) -> Result<String, String> {
    let library = active_library(session_id).map_err(|error| error.to_string())?;
    background(move || with_write_guards(&library, false, action))
        .await
        .map_err(|error| format!("{error:#}"))
}

async fn pick_write_reading<T: 'static>(
    session_id: &str,
    pick: impl FnOnce() -> Result<Option<T>> + Send + 'static,
    action: impl FnOnce(&Library, T) -> Result<String> + Send + 'static,
) -> Result<Option<String>, String> {
    // Keep the library from the start of the request, but do not hold a write
    // lock while the picker is open.
    let library = active_library(session_id).map_err(|error| error.to_string())?;
    background(move || {
        let Some(selection) = pick()? else {
            return Ok(None);
        };
        with_write_guards(&library, false, |library| action(library, selection)).map(Some)
    })
    .await
    .map_err(|error| format!("{error:#}"))
}

#[cfg(target_os = "macos")]
fn pick_attachments() -> Result<Option<Vec<PathBuf>>> {
    Ok(rfd::FileDialog::new()
        .set_title("Add attachments")
        .pick_files())
}

#[cfg(not(target_os = "macos"))]
fn pick_attachments() -> Result<Option<Vec<PathBuf>>> {
    anyhow::bail!("The dox NSH reader currently supports macOS only")
}

#[cfg(target_os = "macos")]
fn pick_bibtex() -> Result<Option<PathBuf>> {
    Ok(rfd::FileDialog::new()
        .set_title("Import BibTeX")
        .add_filter("BibTeX", &["bib", "bibtex"])
        .pick_file())
}

#[cfg(not(target_os = "macos"))]
fn pick_bibtex() -> Result<Option<PathBuf>> {
    anyhow::bail!("The dox NSH reader currently supports macOS only")
}

#[cfg(target_os = "macos")]
fn open_file(path: &Path) -> Result<()> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg(path)
        .status()
        .context("Could not start the attachment opener")?;
    ensure!(status.success(), "Could not open the attachment ({status})");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_file(_path: &Path) -> Result<()> {
    anyhow::bail!("The dox NSH reader currently supports macOS only")
}

/// The dox library and its rendered notes for each reader session.
#[module]
pub struct Reader;

#[module]
impl Reader {
    /// Restore an existing library or open or create one with the folder picker.
    /// Returns the path and cached index as JSON, or null if the picker is canceled.
    pub async fn open_library(
        session_id: String,
        saved_path: Option<String>,
    ) -> Result<Option<String>, String> {
        let generation = Arc::clone(
            &sessions()
                .map_err(|error| error.to_string())?
                .by_id
                .entry(session_id.clone())
                .or_default()
                .generation,
        );
        background(move || {
            let restore = saved_path.is_some();
            let path = match saved_path {
                Some(saved) => PathBuf::from(saved),
                None => match pick_folder()? {
                    Some(path) => path,
                    None => return Ok(None),
                },
            };
            ensure!(path.is_absolute(), "The library path must be absolute");
            let _open = OPENS
                .lock()
                .map_err(|_| anyhow!("The library session is unavailable"))?;
            sessions()?.opening_session(&session_id, &generation)?;
            let root = path
                .canonicalize()
                .context("Library directory does not exist")?;
            ensure!(root.is_dir(), "Library must be a directory");
            let watch = sessions()?.root_watch(&root);
            let library = if restore {
                // Library::open can create notes. Do not do this for a saved path.
                ensure!(
                    fs::symlink_metadata(root.join("notes"))
                        .is_ok_and(|metadata| metadata.is_dir()),
                    "The library folder '{}' does not contain a real notes directory",
                    path.display()
                );
                Library::open(root)?
            } else {
                let _write = watch.writes
                    .lock()
                    .map_err(|_| anyhow!("The library write lock is unavailable"))?;
                sessions()?.opening_session(&session_id, &generation)?;
                let _disk = lock_disk(&root)?;
                Library::init(root)?
            };
            sessions()?.opening_session(&session_id, &generation)?;
            let watch_error = watch.ensure_watching(&library)?;
            let opened = Opened {
                path: library.root().display().to_string(),
                index: library.cached_index().map(Index::from).unwrap_or_default(),
                watch_error,
            };
            let response = serde_json::to_string(&opened)?;
            let previous = sessions()?
                .opening_session(&session_id, &generation)?
                .active
                .replace(Session { library, watch });
            drop(previous);
            Ok(Some(response))
        })
        .await
        .map_err(|error| format!("{error:#}"))
    }

    /// Dispose of a reader session. A pending open cannot restore it after this call.
    pub fn close_session(session_id: String) -> Result<(), String> {
        let removed = sessions()
            .map_err(|error| error.to_string())?
            .by_id
            .remove(&session_id);
        drop(removed);
        Ok(())
    }

    /// Return this session's library change version, or zero if no library is open.
    pub fn change_version(session_id: String) -> f64 {
        sessions()
            .ok()
            .and_then(|sessions| {
                let session = sessions.by_id.get(&session_id)?.active.as_ref()?;
                Some(session.watch.version.load(Ordering::Relaxed) as f64)
            })
            .unwrap_or(0.0)
    }

    /// Refresh the active library index. Returns entries and diagnostics as JSON.
    pub async fn refresh(session_id: String) -> Result<String, String> {
        let library = active_library(&session_id).map_err(|error| error.to_string())?;
        background(move || Ok(serde_json::to_string(&Index::from(library.index()?))?))
            .await
            .map_err(|error| format!("{error:#}"))
    }

    /// Read local Git status, without fetching or changing the repository.
    pub async fn git_summary(session_id: String) -> Result<Option<String>, String> {
        let library = active_library(&session_id).map_err(|error| error.to_string())?;
        background(move || {
            let status = GitRepository::new(library.root().to_owned()).status()?;
            if !status.available {
                return Ok(None);
            }
            Ok(Some(serde_json::to_string(&GitSummary {
                branch: status.branch,
                upstream: status.upstream,
                changed: status.changes.len(),
                ahead: status.ahead,
                behind: status.behind,
            })?))
        })
        .await
        .map_err(|error| format!("{error:#}"))
    }

    /// The home directory used to shorten displayed paths on macOS.
    pub fn home_directory() -> String {
        std::env::var("HOME").unwrap_or_default()
    }

    /// The fixed HTML shell shared by all preview views.
    pub fn preview_shell() -> String {
        preview::shell()
    }

    /// Read and render one entry. Returns preview, source, revision and diagnostics as JSON.
    pub async fn read_note(session_id: String, id: String) -> Result<String, String> {
        let library = active_library(&session_id).map_err(|error| error.to_string())?;
        background(move || reading_json(&library, library.read(&id)?, None))
            .await
            .map_err(|error| format!("{error:#}"))
    }

    /// Save only if the on-disk revision matches, then return the updated reading as JSON.
    pub async fn save_note(
        session_id: String,
        id: String,
        source: String,
        revision: String,
    ) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            let document = library.save(&id, &source, &revision)?;
            reading_json(library, document, None)
        })
        .await
    }

    /// Move the note to the library trash only if its revision still matches.
    pub async fn delete_note(
        session_id: String,
        id: String,
        revision: String,
    ) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            Ok(library.delete(&id, &revision)?.trash_entry)
        })
        .await
    }

    /// Restore a previously trashed note and return Reading JSON.
    pub async fn restore_note(session_id: String, trash_entry: String) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            let document = library.restore(&trash_entry)?;
            reading_json(library, document, None)
        })
        .await
    }

    /// Create a note or open today's note. Returns Reading JSON.
    pub async fn create_note(session_id: String, kind: String) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            let document = match kind.as_str() {
                "note" => library.create_untitled()?,
                "daily" => library.open_daily_note()?,
                "literature" => library.create_literature()?,
                _ => anyhow::bail!("Unknown note kind: {kind}"),
            };
            reading_json(library, document, None)
        })
        .await
    }

    /// Pick files to copy into a note. Returns Reading JSON or null on cancel.
    pub async fn add_attachments(session_id: String, id: String) -> Result<Option<String>, String> {
        pick_write_reading(&session_id, pick_attachments, move |library, paths| {
            for path in paths {
                library
                    .attach_file(&id, &path)
                    .with_context(|| format!("Could not attach {}", path.display()))?;
            }
            reading_json(library, library.read(&id)?, None)
        })
        .await
    }

    /// Attach files from a native drop. Only local file URIs are accepted.
    pub async fn drop_attachments(
        session_id: String,
        id: String,
        uris: Vec<String>,
    ) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            ensure!(!uris.is_empty(), "No files were dropped");
            let paths = uris
                .into_iter()
                .map(|uri| {
                    let url = url::Url::parse(&uri).context("Invalid file drop")?;
                    ensure!(
                        url.scheme() == "file"
                            && url.host().is_none()
                            && url.query().is_none()
                            && url.fragment().is_none(),
                        "Drop local files only"
                    );
                    url.to_file_path()
                        .map_err(|()| anyhow!("Invalid local file path"))
                })
                .collect::<Result<Vec<_>>>()?;
            for path in paths {
                library
                    .attach_file(&id, &path)
                    .with_context(|| format!("Could not attach {}", path.display()))?;
            }
            reading_json(library, library.read(&id)?, None)
        })
        .await
    }

    /// Remove the library's copy of an attachment and return Reading JSON.
    pub async fn remove_attachment(
        session_id: String,
        id: String,
        name: String,
    ) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            library.remove_attachment(&id, &name)?;
            reading_json(library, library.read(&id)?, None)
        })
        .await
    }

    /// Open a validated attachment path in the default application.
    pub async fn open_attachment(session_id: String, id: String, name: String) -> Result<(), String> {
        let library = active_library(&session_id).map_err(|error| error.to_string())?;
        background(move || open_file(&library.attachment_path(&id, &name)?))
            .await
            .map_err(|error| format!("{error:#}"))
    }

    /// Find and attach the paper PDF, using the note's reference by default.
    pub async fn find_paper_pdf(
        session_id: String,
        id: String,
        source: Option<String>,
    ) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            library.find_paper_pdf(&id, source.as_deref())?;
            reading_json(library, library.read(&id)?, None)
        })
        .await
    }

    /// Import a publication identifier or link and return Reading JSON.
    pub async fn import_publication(session_id: String, input: String) -> Result<String, String> {
        write_reading(&session_id, move |library| {
            imported_json(library, library.import_publication(&input)?)
        })
        .await
    }

    /// Pick a BibTeX file to import. Returns Reading JSON or null on cancel.
    pub async fn import_bibtex(session_id: String) -> Result<Option<String>, String> {
        pick_write_reading(&session_id, pick_bibtex, |library, path| {
            imported_json(library, library.import_bibtex(path)?)
        })
        .await
    }

    /// Manually sync the active repository after the UI saves its drafts.
    pub async fn sync_library(session_id: String) -> Result<String, String> {
        // Keep the root counter alive if this session closes before sync ends.
        let Session { library, watch } =
            active_session(&session_id).map_err(|error| error.to_string())?;
        background(move || {
            let mut git = GitRepository::new(library.root().to_owned());
            let result = (|| -> Result<String> {
                with_write_guards(&library, true, |_| git.checkpoint())?;
                for attempt in 0..3 {
                    git.fetch().context("Saved locally; sync pending")?;
                    let commit = with_write_guards(&library, true, |_| git.reconcile_fetched())?;
                    match git.push_commit(&commit) {
                        Ok(()) => return Ok(commit),
                        Err(error) if attempt < 2 && GitRepository::is_push_race(&error) => {
                            thread::sleep(std::time::Duration::from_millis(250 * (1 << attempt)));
                        }
                        Err(error) => return Err(error).context("Saved locally; sync pending"),
                    }
                }
                unreachable!()
            })();
            // Git-only changes do not trigger the filesystem watcher, even
            // when a failed sync leaves a local checkpoint.
            mark_changed(&watch.version);
            Ok(serde_json::to_string(&SyncSummary {
                commit: result?,
                message: "Library synced",
            })?)
        })
        .await
        .map_err(|error| format!("{error:#}"))
    }
}
