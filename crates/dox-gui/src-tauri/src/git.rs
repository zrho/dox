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
                })
            })
            .clone()
    }
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
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut pending = repo.ready.lock().unwrap();
    loop {
        let replies = &pending.as_ref().unwrap().replies;
        for (label, reply) in replies {
            if let Some(Err(problem)) = reply {
                return Err(format!("{label}: {problem}"));
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
#[tauri::command]
pub async fn git_action(
    root: String,
    action: String,
    message: Option<String>,
    automatic: bool,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    let root = root_for(&window, &root)?;
    if !["fetch", "commit", "commit-push", "pull", "push"].contains(&action.as_str()) {
        return Err("Unknown Git action".into());
    }
    if automatic && action != "fetch" {
        return Err("Only remote checks can run automatically".into());
    }
    let repo = window.state::<Coordinator>().repository(&root);
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut git = repo.git.lock().unwrap();
        if automatic {
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
        let outcome: Result<(), String> = (|| {
            // Wait for writes already in progress before asking editors to freeze.
            let _write = if changes_disk {
                Some(repo.writes.write().unwrap())
            } else {
                None
            };
            let _freeze = if changes_disk {
                Some(freeze(&app, &root, &repo)?)
            } else {
                None
            };
            if action.starts_with("commit") {
                committed = Some(
                    git.commit(message.as_deref().unwrap_or(""))
                        .map_err(|e| format!("{e:#}"))?,
                );
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
            if action == "fetch" || action == "pull" {
                snapshot.remote_error = outcome.as_ref().err().cloned();
            }
            if !automatic {
                let message = match &outcome {
                    Ok(()) => match action.as_str() {
                        "commit" => "Committed locally",
                        "commit-push" => "Committed and pushed",
                        "pull" => "Library updated",
                        "push" => "Pushed successfully",
                        _ => "Remote status updated",
                    }
                    .into(),
                    Err(e) if committed.is_some() => format!(
                        "Committed locally; push failed. {e} Retry Push to upload this commit."
                    ),
                    Err(e) => e.clone(),
                };
                snapshot.result = Some(GitResult {
                    action: action.clone(),
                    success: outcome.is_ok(),
                    commit: committed,
                    message,
                });
            }
        }
        let snapshot = publish(&app, &root, &repo);
        if action == "pull" {
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
