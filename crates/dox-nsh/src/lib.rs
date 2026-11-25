//! Native bridge for the single-window dox reader.

mod preview;

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
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

static LIBRARY: Mutex<Option<Session>> = Mutex::new(None);
static OPENS: Mutex<()> = Mutex::new(());
static WRITES: Mutex<()> = Mutex::new(());

struct Session {
    library: Library,
    change_version: Arc<AtomicU64>,
    // Keep the watcher alive without adding a direct notify dependency.
    _watcher: Option<Box<dyn Send>>,
}

#[native_module("dox-nsh/native")]
fn native(registry: &mut Registry) {
    registry.module::<Reader>();
}

#[derive(Serialize)]
struct Entry {
    id: String,
    title: String,
    title_markup: String,
    kind: String,
    date: Option<String>,
    links: Vec<String>,
    revision: String,
}

impl From<Note> for Entry {
    fn from(note: Note) -> Self {
        Self {
            title: if note.title_text.trim().is_empty() {
                note.id.clone()
            } else {
                note.title_text
            },
            title_markup: note.title,
            id: note.id,
            kind: note.metadata.kind,
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
}

impl From<Diagnostic> for Issue {
    fn from(issue: Diagnostic) -> Self {
        Self {
            id: issue.id,
            severity: issue.severity,
            message: issue.message,
            note_id: issue.note_id,
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

fn active_session() -> Result<(Library, Arc<AtomicU64>)> {
    LIBRARY
        .lock()
        .map_err(|_| anyhow!("The library session is unavailable"))?
        .as_ref()
        .map(|session| (session.library.clone(), Arc::clone(&session.change_version)))
        .context("Open a library first")
}

fn active_library() -> Result<Library> {
    active_session().map(|(library, _)| library)
}

fn mark_changed(version: &AtomicU64) {
    // Keep the version exactly representable as a JavaScript number.
    const MAX_VERSION: u64 = (1 << 53) - 1;
    let _ = version.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        (current < MAX_VERSION).then(|| current + 1)
    });
}

// Match the Tauri write lock. Do not remove a lock left by a crashed process.
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
    let _write = WRITES
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
        .set_title("Open dox library")
        .pick_folder())
}

#[cfg(not(target_os = "macos"))]
fn pick_folder() -> Result<Option<PathBuf>> {
    anyhow::bail!("The dox NSH reader currently supports macOS only")
}

async fn write_reading(
    action: impl FnOnce(&Library) -> Result<String> + Send + 'static,
) -> Result<String, String> {
    let library = active_library().map_err(|error| error.to_string())?;
    background(move || with_write_guards(&library, false, action))
        .await
        .map_err(|error| format!("{error:#}"))
}

async fn pick_write_reading<T: 'static>(
    pick: impl FnOnce() -> Result<Option<T>> + Send + 'static,
    action: impl FnOnce(&Library, T) -> Result<String> + Send + 'static,
) -> Result<Option<String>, String> {
    // Keep the library from the start of the request, but do not hold a write
    // lock while the picker is open.
    let library = active_library().map_err(|error| error.to_string())?;
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

/// The active dox library and its rendered notes.
#[module]
pub struct Reader;

#[module]
impl Reader {
    /// Open a saved path or pick an existing library. Returns the path and cached index as JSON.
    pub async fn open_library(saved_path: Option<String>) -> Result<Option<String>, String> {
        background(move || {
            let path = match saved_path {
                Some(saved) => PathBuf::from(saved),
                None => match pick_folder()? {
                    Some(path) => path,
                    None => return Ok(None),
                },
            };
            ensure!(path.is_absolute(), "The library path must be absolute");
            ensure!(
                path.join("notes").is_dir(),
                "The library folder '{}' does not contain a notes directory",
                path.display()
            );
            // Concurrent opens of the same library must reuse its installed counter.
            let _open = OPENS
                .lock()
                .map_err(|_| anyhow!("The library session is unavailable"))?;
            let library = Library::open(path)?;
            let change_version = LIBRARY
                .lock()
                .map_err(|_| anyhow!("The library session is unavailable"))?
                .as_ref()
                .filter(|session| session.library.root() == library.root())
                .map(|session| Arc::clone(&session.change_version))
                .unwrap_or_default();
            let version = Arc::clone(&change_version);
            let (watcher, watch_error) = match library.watch(move || mark_changed(&version)) {
                Ok(watcher) => (Some(Box::new(watcher) as Box<dyn Send>), None),
                Err(error) => (None, Some(format!("{error:#}"))),
            };
            let opened = Opened {
                path: library.root().display().to_string(),
                index: library.cached_index().map(Index::from).unwrap_or_default(),
                watch_error,
            };
            let response = serde_json::to_string(&opened)?;
            let previous = LIBRARY
                .lock()
                .map_err(|_| anyhow!("The library session is unavailable"))?
                .replace(Session {
                    library,
                    change_version,
                    _watcher: watcher,
                });
            drop(previous);
            Ok(Some(response))
        })
        .await
        .map_err(|error| format!("{error:#}"))
    }

    /// Return the active library's change version, or zero if no library is open.
    pub fn change_version() -> f64 {
        LIBRARY
            .lock()
            .ok()
            .and_then(|session| {
                session
                    .as_ref()
                    .map(|session| session.change_version.load(Ordering::Relaxed) as f64)
            })
            .unwrap_or(0.0)
    }

    /// Refresh the active library index. Returns entries and diagnostics as JSON.
    pub async fn refresh() -> Result<String, String> {
        let library = active_library().map_err(|error| error.to_string())?;
        background(move || Ok(serde_json::to_string(&Index::from(library.index()?))?))
            .await
            .map_err(|error| format!("{error:#}"))
    }

    /// Read local Git status, without fetching or changing the repository.
    pub async fn git_summary() -> Result<Option<String>, String> {
        let library = active_library().map_err(|error| error.to_string())?;
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
    pub async fn read_note(id: String) -> Result<String, String> {
        let library = active_library().map_err(|error| error.to_string())?;
        background(move || reading_json(&library, library.read(&id)?, None))
            .await
            .map_err(|error| format!("{error:#}"))
    }

    /// Save only if the on-disk revision matches, then return the updated reading as JSON.
    pub async fn save_note(id: String, source: String, revision: String) -> Result<String, String> {
        write_reading(move |library| {
            let document = library.save(&id, &source, &revision)?;
            reading_json(library, document, None)
        })
        .await
    }

    /// Move the note to the library trash only if its revision still matches.
    pub async fn delete_note(id: String, revision: String) -> Result<String, String> {
        write_reading(move |library| Ok(library.delete(&id, &revision)?.trash_entry)).await
    }

    /// Restore a previously trashed note and return Reading JSON.
    pub async fn restore_note(trash_entry: String) -> Result<String, String> {
        write_reading(move |library| {
            let document = library.restore(&trash_entry)?;
            reading_json(library, document, None)
        })
        .await
    }

    /// Create a note or open today's note. Returns Reading JSON.
    pub async fn create_note(kind: String) -> Result<String, String> {
        write_reading(move |library| {
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
    pub async fn add_attachments(id: String) -> Result<Option<String>, String> {
        pick_write_reading(pick_attachments, move |library, paths| {
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
    pub async fn drop_attachments(id: String, uris: Vec<String>) -> Result<String, String> {
        write_reading(move |library| {
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
    pub async fn remove_attachment(id: String, name: String) -> Result<String, String> {
        write_reading(move |library| {
            library.remove_attachment(&id, &name)?;
            reading_json(library, library.read(&id)?, None)
        })
        .await
    }

    /// Open a validated attachment path in the default application.
    pub async fn open_attachment(id: String, name: String) -> Result<(), String> {
        let library = active_library().map_err(|error| error.to_string())?;
        background(move || open_file(&library.attachment_path(&id, &name)?))
            .await
            .map_err(|error| format!("{error:#}"))
    }

    /// Find and attach the paper PDF, using the note's reference by default.
    pub async fn find_paper_pdf(id: String, source: Option<String>) -> Result<String, String> {
        write_reading(move |library| {
            library.find_paper_pdf(&id, source.as_deref())?;
            reading_json(library, library.read(&id)?, None)
        })
        .await
    }

    /// Import a publication identifier or link and return Reading JSON.
    pub async fn import_publication(input: String) -> Result<String, String> {
        write_reading(move |library| imported_json(library, library.import_publication(&input)?))
            .await
    }

    /// Pick a BibTeX file to import. Returns Reading JSON or null on cancel.
    pub async fn import_bibtex() -> Result<Option<String>, String> {
        pick_write_reading(pick_bibtex, |library, path| {
            imported_json(library, library.import_bibtex(path)?)
        })
        .await
    }

    /// Manually sync the active repository after the UI saves its drafts.
    pub async fn sync_library() -> Result<String, String> {
        let (library, version) = active_session().map_err(|error| error.to_string())?;
        background(move || {
            with_write_guards(&library, true, |library| {
                let result = GitRepository::new(library.root().to_owned()).sync();
                // Even a failed sync can leave a local checkpoint. Git-only
                // updates do not trigger the library filesystem watcher.
                mark_changed(&version);
                Ok(serde_json::to_string(&SyncSummary {
                    commit: result?,
                    message: "Library synced",
                })?)
            })
        })
        .await
        .map_err(|error| format!("{error:#}"))
    }
}
