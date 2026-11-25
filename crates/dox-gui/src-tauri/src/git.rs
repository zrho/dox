//! Application-wide repository coordination; editor readiness is checked before disk mutations.
use crate::{Sessions, library};
use dox_core::git::{GitDiff, GitRepository, GitStatus};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct WindowDrafts {
    pub window: String,
    pub titles: Vec<String>,
}
#[derive(Clone, Serialize)]
pub struct GitResult {
    pub action: String,
    pub success: bool,
    pub commit: Option<String>,
    pub message: String,
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub root: String,
    pub revision: u64,
    pub status: GitStatus,
    pub operation: Option<String>,
    pub checked_at: Option<u64>,
    pub remote_error: Option<String>,
    pub drafts: Vec<WindowDrafts>,
    pub result: Option<GitResult>,
}
struct Ready {
    token: u64,
    replies: HashMap<String, Option<Result<(), String>>>,
}
pub struct Repository {
    git: Mutex<GitRepository>,
    pub writes: RwLock<()>,
    snapshot: Mutex<Snapshot>,
    refreshed: Mutex<Option<Instant>>,
    attempted: Mutex<Option<Instant>>,
    ready: Mutex<Option<Ready>>,
    wake: Condvar,
    // (worker active, another automatic sync requested)
    sync_queue: Mutex<(bool, bool)>,
}
#[derive(Default)]
pub struct Coordinator {
    roots: Mutex<HashMap<PathBuf, Arc<Repository>>>,
}
impl Coordinator {
    pub fn repository(&self, root: &Path) -> Arc<Repository> {
        self.roots
            .lock()
            .unwrap()
            .entry(root.into())
            .or_insert_with(|| {
                Arc::new(Repository {
                    git: Mutex::new(GitRepository::new(root.into())),
                    writes: RwLock::new(()),
                    snapshot: Mutex::new(Snapshot {
                        root: root.to_string_lossy().into(),
                        revision: 0,
                        status: GitStatus::default(),
                        operation: None,
                        checked_at: None,
                        remote_error: None,
                        drafts: vec![],
                        result: None,
                    }),
                    refreshed: Mutex::new(None),
                    attempted: Mutex::new(None),
                    ready: Mutex::new(None),
                    wake: Condvar::new(),
                    sync_queue: Mutex::new((false, false)),
                })
            })
            .clone()
    }
}
/// All dox processes use this lock for file mutations. A crash leaves the
/// marker in place: recovery must preserve files before removing a stale lock.
pub struct DiskWriteGuard(Option<PathBuf>);
impl Drop for DiskWriteGuard {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}
pub fn lock_disk(root: &Path) -> Result<DiskWriteGuard, String> {
    if !root.join(".git").is_dir() {
        return Ok(DiskWriteGuard(None));
    }
    if root.join(".git/dox-sync-journal").exists() {
        return Err("An interrupted sync requires external recovery before writing. Preserve the library and inspect .git/dox-sync-journal.".into());
    }
    let path = root.join(".git/dox-write.lock");
    std::fs::OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|e| format!("Cannot lock library writes: {e}. Another dox process may be writing. After a crash, preserve files and inspect .git/dox-sync-journal before removing .git/dox-write.lock."))?;
    Ok(DiskWriteGuard(Some(path)))
}
pub fn joining_allowed(repo: &Repository) -> Result<(), String> {
    if repo.ready.lock().unwrap().is_some() {
        return Err("Wait for sync before opening this library in another window".into());
    }
    Ok(())
}
fn windows(app: &tauri::AppHandle, root: &Path) -> Vec<String> {
    app.state::<Sessions>()
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, s)| s.library.root() == root)
        .map(|(label, _)| label.clone())
        .collect()
}
fn emit<T: Serialize + Clone>(app: &tauri::AppHandle, root: &Path, event: &str, value: T) {
    for label in windows(app, root) {
        let _ = app.emit_to(&label, event, value.clone());
    }
}
fn publish(app: &tauri::AppHandle, root: &Path, repo: &Repository) -> Snapshot {
    let snapshot = {
        let mut state = repo.snapshot.lock().unwrap();
        state.revision += 1;
        state.clone()
    };
    emit(app, root, "git-state", snapshot.clone());
    snapshot
}
fn refresh(repo: &Repository, git: &GitRepository) {
    let status = git.status().unwrap_or_else(|e| GitStatus {
        reason: Some(format!("{e:#}")),
        ..Default::default()
    });
    repo.snapshot.lock().unwrap().status = status;
    *repo.refreshed.lock().unwrap() = Some(Instant::now());
}
fn root_for(window: &tauri::WebviewWindow, expected: &str) -> Result<PathBuf, String> {
    let root = library(&window.state::<Sessions>(), window)?
        .root()
        .to_path_buf();
    if root.to_string_lossy() != expected {
        return Err("The open library changed".into());
    }
    Ok(root)
}
pub fn switching_allowed(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if let Some(session) = app.state::<Sessions>().lock().unwrap().get(label) {
        let repo = app
            .state::<Coordinator>()
            .repository(session.library.root());
        if repo.ready.lock().unwrap().is_some() {
            return Err("Wait for the Git operation before switching libraries".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn git_status(
    root: String,
    force: bool,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    let root = root_for(&window, &root)?;
    let repo = window.state::<Coordinator>().repository(&root);
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(git) = repo.git.try_lock() {
            let recent = repo
                .refreshed
                .lock()
                .unwrap()
                .is_some_and(|at| at.elapsed() < Duration::from_secs(2));
            if force || !recent {
                refresh(&repo, &git);
            }
        }
        publish(&app, &root, &repo)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn git_diff(
    root: String,
    path: String,
    window: tauri::WebviewWindow,
) -> Result<GitDiff, String> {
    let root = root_for(&window, &root)?;
    let repo = window.state::<Coordinator>().repository(&root);
    tauri::async_runtime::spawn_blocking(move || {
        let git = repo.git.lock().unwrap();
        let _read = repo.writes.read().unwrap();
        git.diff(&path).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn git_report_drafts(
    root: String,
    titles: Vec<String>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let root = root_for(&window, &root)?;
    let repo = window.state::<Coordinator>().repository(&root);
    {
        let mut snapshot = repo.snapshot.lock().unwrap();
        snapshot.drafts.retain(|d| d.window != window.label());
        if !titles.is_empty() {
            snapshot.drafts.push(WindowDrafts {
                window: window.label().into(),
                titles,
            });
        }
    }
    publish(window.app_handle(), &root, &repo);
    Ok(())
}
#[tauri::command]
pub fn git_ready(
    root: String,
    token: u64,
    problem: Option<String>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let root = root_for(&window, &root)?;
    let repo = window.state::<Coordinator>().repository(&root);
    let mut pending = repo.ready.lock().unwrap();
    if let Some(ready) = pending.as_mut()
        && ready.token == token
        && let Some(reply) = ready.replies.get_mut(window.label())
    {
        *reply = Some(problem.map_or(Ok(()), Err));
        repo.wake.notify_all();
    }
    Ok(())
}
#[derive(Clone, Serialize)]
struct FreezeEvent {
    root: String,
    token: u64,
}
struct Freeze<'a> {
    app: &'a tauri::AppHandle,
    repo: &'a Repository,
    event: FreezeEvent,
    labels: Vec<String>,
}
impl Drop for Freeze<'_> {
    fn drop(&mut self) {
        *self.repo.ready.lock().unwrap() = None;
        for label in &self.labels {
            let _ = self.app.emit_to(label, "git-release", self.event.clone());
        }
    }
}
fn freeze<'a>(
    app: &'a tauri::AppHandle,
    root: &Path,
    repo: &'a Repository,
) -> Result<Freeze<'a>, String> {
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_micros() as u64;
    let labels = windows(app, root);
    let event = FreezeEvent {
        root: root.to_string_lossy().into(),
        token,
    };
    let guard = Freeze {
        app,
        repo,
        event: event.clone(),
        labels: labels.clone(),
    };
    *repo.ready.lock().unwrap() = Some(Ready {
        token,
        replies: labels.iter().map(|l| (l.clone(), None)).collect(),
    });
    for label in &labels {
        let _ = app.emit_to(label, "git-prepare", event.clone());
    }
    // Saving can compile several notes. Keep the token alive while those
    // writes finish; a late acknowledgement must never start a transaction.
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut pending = repo.ready.lock().unwrap();
    loop {
        let replies = &pending.as_ref().unwrap().replies;
        for (label, reply) in replies {
            if let Some(Err(problem)) = reply {
                let problem = format!("{label}: {problem}");
                drop(pending);
                return Err(problem);
            }
        }
        if replies.values().all(Option::is_some) {
            break;
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            // Release the mutex before dropping the RAII guard on error.
            drop(pending);
            return Err(
                "Another window did not respond. Try again when all library windows are ready."
                    .into(),
            );
        };
        pending = repo.wake.wait_timeout(pending, remaining).unwrap().0;
    }
    drop(pending);
    Ok(guard)
}
fn sync_transaction(
    app: &tauri::AppHandle,
    root: &Path,
    repo: &Repository,
    action: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    let frozen = freeze(app, root, repo)?;
    let _write = repo.writes.write().unwrap();
    let _disk = lock_disk(root)?;
    let mut current = windows(app, root);
    let mut prepared = frozen.labels.clone();
    current.sort();
    prepared.sort();
    if current != prepared {
        return Err("Library windows changed during preparation; retry sync".into());
    }
    action()
}
// Save and checkpoint before network work, including when offline.
// Network work holds neither the editor freeze nor the write gate.
fn sync_once(
    app: &tauri::AppHandle,
    root: &Path,
    repo: &Repository,
    git: &mut GitRepository,
) -> Result<String, String> {
    sync_transaction(app, root, repo, || {
        git.checkpoint().map_err(|e| format!("{e:#}"))
    })?;
    for attempt in 0..3 {
        git.fetch()
            .map_err(|e| format!("Saved locally; sync pending. {e:#}"))?;
        repo.snapshot.lock().unwrap().checked_at = Some(now());
        let oid = sync_transaction(app, root, repo, || {
            git.reconcile_fetched().map_err(|e| format!("{e:#}"))
        });
        // A failed reconciliation can still leave a local checkpoint on disk.
        emit(app, root, "library-changed", ());
        let oid = oid?;
        match git.push_commit(&oid) {
            Ok(()) => return Ok(oid),
            Err(error) if attempt < 2 && GitRepository::is_push_race(&error) => {
                std::thread::sleep(Duration::from_millis(250 * (1 << attempt)));
            }
            Err(error) => return Err(format!("Saved locally; sync pending. {error:#}")),
        }
    }
    unreachable!()
}
#[tauri::command]
pub async fn git_action(
    root: String,
    action: String,
    message: Option<String>,
    automatic: bool,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    let root = root_for(&window, &root)?;
    if !["fetch", "commit", "commit-push", "pull", "push", "sync"].contains(&action.as_str()) {
        return Err("Unknown Git action".into());
    }
    if automatic && action != "fetch" && action != "sync" {
        return Err("Only remote checks and sync can run automatically".into());
    }
    let repo = window.state::<Coordinator>().repository(&root);
    let app = window.app_handle().clone();
    if automatic && action == "sync" {
        {
            let mut queue = repo.sync_queue.lock().unwrap();
            queue.1 = true;
            if queue.0 {
                drop(queue);
                return Ok(publish(&app, &root, &repo));
            }
            queue.0 = true;
        }
        return tauri::async_runtime::spawn_blocking(move || {
            loop {
                repo.sync_queue.lock().unwrap().1 = false;
                // Wait on a worker thread rather than lose the trigger when Git is busy.
                let mut git = repo.git.lock().unwrap();
                repo.snapshot.lock().unwrap().operation = Some("sync".into());
                publish(&app, &root, &repo);
                let outcome = sync_once(&app, &root, &repo, &mut git);
                refresh(&repo, &git);
                {
                    let mut state = repo.snapshot.lock().unwrap();
                    state.operation = None;
                    state.remote_error = outcome.as_ref().err().cloned();
                    state.result = Some(GitResult {
                        action: "sync".into(),
                        success: outcome.is_ok(),
                        commit: outcome.as_ref().ok().cloned(),
                        message: match &outcome {
                            Ok(_) => "Library synced".into(),
                            Err(error) => error.clone(),
                        },
                    });
                }
                let snapshot = publish(&app, &root, &repo);
                drop(git);
                let mut queue = repo.sync_queue.lock().unwrap();
                if outcome.is_err() || !queue.1 {
                    // Do not retry errors merely because saves queued during prepare.
                    *queue = (false, false);
                    return snapshot;
                }
            }
        })
        .await
        .map_err(|e| e.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Automatic requests must not queue behind another operation. The active
        // operation publishes its result to every window for this library.
        let mut git = if automatic {
            match repo.git.try_lock() {
                Ok(git) => git,
                Err(std::sync::TryLockError::WouldBlock) => return publish(&app, &root, &repo),
                Err(std::sync::TryLockError::Poisoned(error)) => panic!("{error}"),
            }
        } else {
            repo.git.lock().unwrap()
        };
        if automatic && action == "fetch" {
            if repo
                .attempted
                .lock()
                .unwrap()
                .is_some_and(|at| at.elapsed() < Duration::from_secs(60))
            {
                return publish(&app, &root, &repo);
            }
            refresh(&repo, &git);
            let can_fetch = {
                let snapshot = repo.snapshot.lock().unwrap();
                snapshot.status.available && snapshot.status.branch.is_some()
            };
            if !can_fetch {
                return publish(&app, &root, &repo);
            }
        }
        let changes_disk = action == "pull" || action.starts_with("commit");
        repo.snapshot.lock().unwrap().operation = Some(action.clone());
        publish(&app, &root, &repo);
        let mut committed = None;
        let mut sync_message = None;
        let outcome: Result<(), String> = (|| {
            // Editors must finish their prepare saves before we block writes.
            let _freeze = if changes_disk {
                Some(freeze(&app, &root, &repo)?)
            } else {
                None
            };
            let _write = if changes_disk {
                Some(repo.writes.write().unwrap())
            } else {
                None
            };
            let _disk = if changes_disk {
                Some(lock_disk(&root)?)
            } else {
                None
            };
            if let Some(frozen) = &_freeze {
                let mut current = windows(&app, &root);
                let mut prepared = frozen.labels.clone();
                current.sort();
                prepared.sort();
                if current != prepared {
                    return Err("Library windows changed during preparation; retry sync".into());
                }
            }
            if action.starts_with("commit") {
                committed = Some(
                    git.commit(message.as_deref().unwrap_or(""))
                        .map_err(|e| format!("{e:#}"))?,
                );
            } else if action == "sync" {
                committed = Some(sync_once(&app, &root, &repo, &mut git)?);
                sync_message = Some("Library synced".to_string());
            } else if action == "pull" {
                *repo.attempted.lock().unwrap() = Some(Instant::now());
                git.pull().map_err(|e| format!("{e:#}"))?;
                repo.snapshot.lock().unwrap().checked_at = Some(now());
            } else if action == "fetch" {
                *repo.attempted.lock().unwrap() = Some(Instant::now());
                git.fetch().map_err(|e| format!("{e:#}"))?;
                repo.snapshot.lock().unwrap().checked_at = Some(now());
            }
            Ok(())
        })();
        // Push doesn't need to keep editors frozen.
        let outcome = if outcome.is_ok() && (action == "push" || action == "commit-push") {
            git.push().map_err(|e| format!("{e:#}"))
        } else {
            outcome
        };
        // Cool down from completion as well: another window may have queued
        // the same automatic check during a slow or timed-out fetch.
        if action == "fetch" || action == "pull" {
            *repo.attempted.lock().unwrap() = Some(Instant::now());
        }
        refresh(&repo, &git);
        {
            let mut snapshot = repo.snapshot.lock().unwrap();
            snapshot.operation = None;
            if action == "fetch" || action == "pull" || action == "sync" {
                snapshot.remote_error = outcome.as_ref().err().cloned();
            }
            let message = match &outcome {
                Ok(()) => match action.as_str() {
                    "commit" => "Committed locally",
                    "commit-push" => "Committed and pushed",
                    "pull" => "Library updated",
                    "push" => "Pushed successfully",
                    "sync" => sync_message.as_deref().unwrap_or("Library synced"),
                    _ => "Remote status updated",
                }
                .into(),
                Err(e) if committed.is_some() => {
                    format!("Committed locally; push failed. {e} Retry Push to upload this commit.")
                }
                Err(e) => e.clone(),
            };
            snapshot.result = Some(GitResult {
                action: action.clone(),
                success: outcome.is_ok(),
                commit: committed,
                message,
            });
        }
        let snapshot = publish(&app, &root, &repo);
        if action == "pull" || action == "sync" {
            emit(&app, &root, "library-changed", ());
        }
        snapshot
    })
    .await
    .map_err(|e| e.to_string())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
pub fn forget_window(app: &tauri::AppHandle, label: &str, root: &Path) {
    let repo = app.state::<Coordinator>().repository(root);
    repo.snapshot
        .lock()
        .unwrap()
        .drafts
        .retain(|d| d.window != label);
    if let Some(pending) = repo.ready.lock().unwrap().as_mut() {
        pending.replies.remove(label);
        repo.wake.notify_all();
    }
    publish(app, root, &repo);
}
