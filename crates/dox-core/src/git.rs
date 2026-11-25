//! Git operations. No Git executable, hooks, or external merge drivers are run.
use anyhow::{Context, Result, bail, ensure};
use git2::{Oid, Repository, RepositoryState, StatusOptions};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
mod sync;
const DIFF_LIMIT: usize = 1024 * 1024;
#[derive(Clone, Default, Serialize)]
pub struct GitChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub size: Option<u64>,
}
#[derive(Clone, Default, Serialize)]
pub struct GitStatus {
    pub available: bool,
    pub fingerprint: String,
    pub reason: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: Option<usize>,
    pub behind: Option<usize>,
    pub changes: Vec<GitChange>,
    pub staged: bool,
    pub conflicts: bool,
    pub blocked: Option<String>,
    pub retry_commit: bool,
}
#[derive(Serialize)]
pub struct GitDiff {
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
    pub size: Option<u64>,
}
pub struct GitRepository {
    root: PathBuf,
}
impl GitRepository {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn open(&self) -> Result<Repository> {
        let repo = Repository::open(&self.root)?;
        ensure!(
            !repo.is_bare()
                && self.root.join(".git").is_dir()
                && repo.workdir().context("Missing worktree")?.canonicalize()?
                    == self.root.canonicalize()?,
            "Git requires a library at the root of a regular repository; linked worktrees are unsupported"
        );
        Ok(repo)
    }
    pub fn status(&self) -> Result<GitStatus> {
        let repo = match self.open() {
            Ok(r) => r,
            Err(e) => {
                return Ok(GitStatus {
                    reason: Some(e.to_string()),
                    ..Default::default()
                });
            }
        };
        let head = repo.head().ok();
        let branch = head
            .as_ref()
            .filter(|h| h.is_branch())
            .and_then(|h| h.shorthand())
            .map(str::to_owned);
        let upstream = branch
            .as_ref()
            .and_then(|b| repo.find_branch(b, git2::BranchType::Local).ok())
            .and_then(|b| b.upstream().ok())
            .and_then(|b| b.name().ok().flatten().map(str::to_owned));
        let mut s = GitStatus {
            available: true,
            branch,
            upstream,
            ..Default::default()
        };
        if let (Some(local), Some(up)) =
            (head.as_ref().and_then(|h| h.target()), s.upstream.as_ref())
        {
            let fetched = Self::remote(&repo)
                .ok()
                .and_then(|(n, b)| Self::fetched_ref(&repo, &n, &b).ok());
            let object = fetched
                .as_ref()
                .and_then(|r| repo.revparse_single(r).ok())
                .or_else(|| repo.revparse_single(up).ok());
            if let Some(remote) = object {
                if let Ok((a, b)) = repo.graph_ahead_behind(local, remote.id()) {
                    s.ahead = Some(a);
                    s.behind = Some(b);
                }
            }
        }
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .renames_head_to_index(false)
            .renames_index_to_workdir(false);
        let statuses = repo.statuses(Some(&mut opts))?;
        for entry in statuses.iter() {
            let path = entry
                .path()
                .context("A changed filename is not UTF-8; manage it externally")?
                .to_owned();
            let f = entry.status();
            let staged = f.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            );
            s.staged |= staged;
            s.conflicts |= f.is_conflicted();
            let kind = if f.is_conflicted() {
                "conflict"
            } else if f.is_wt_new() || f.is_index_new() {
                "added"
            } else if f.is_wt_deleted() || f.is_index_deleted() {
                "deleted"
            } else {
                "modified"
            };
            s.changes.push(GitChange {
                size: fs::symlink_metadata(self.root.join(&path))
                    .ok()
                    .map(|m| m.len()),
                path,
                status: kind.into(),
                staged,
            });
        }
        if s.branch.is_none() {
            s.blocked =
                Some("Detached or unborn HEAD: create or switch to a branch externally.".into());
        }
        if repo.state() != RepositoryState::Clean || s.conflicts {
            s.blocked = Some("Finish the current Git operation externally.".into());
        }
        if repo.path().join("dox-sync-journal").exists() {
            s.blocked=Some("An interrupted dox transaction requires external recovery. Inspect .git/dox-sync-journal; do not discard local changes.".into());
        }
        let cfg = repo.config()?;
        if cfg.get_bool("commit.gpgsign").unwrap_or(false)
            || cfg.get_string("core.hooksPath").is_ok()
        {
            s.blocked = Some(
                "Signing and custom hooks are unsupported by dox Git; use an external Git tool."
                    .into(),
            );
        }
        if cfg.get_string("core.autocrlf").is_ok_and(|v| v != "false")
            || cfg.get_string("core.attributesfile").is_ok()
            || repo.path().join("info/attributes").exists()
        {
            s.blocked = Some(
                "Git attribute and line-ending transforms require an external Git tool.".into(),
            );
        }
        if let Ok(mut entries) = cfg.entries(Some("filter.*")) {
            if entries.next().is_some() {
                s.blocked =
                    Some("Git content filters are unsupported; use an external Git tool.".into());
            }
        }
        if fs::read_dir(repo.path().join("hooks"))
            .ok()
            .is_some_and(|entries| {
                entries.filter_map(|e| e.ok()).any(|e| {
                    !e.file_name().to_string_lossy().ends_with(".sample") && e.path().is_file()
                })
            })
        {
            s.blocked = Some(
                "Repository hooks are unsupported by dox Git; use an external Git tool.".into(),
            );
        }
        let index = repo.index()?;
        for e in index.iter() {
            if e.path == b".gitattributes" || e.path.ends_with(b"/.gitattributes") {
                s.blocked = Some("Git attributes require an external Git tool.".into());
            }
            if e.mode == 0o160000 {
                s.blocked = Some("Submodules must be managed externally.".into());
            }
            if e.path.starts_with(b".cache/") || e.path.starts_with(b".trash/") {
                s.blocked = Some("Untrack generated .cache and .trash files externally.".into());
            }
            if e.flags_extended != 0 {
                s.blocked =
                    Some("Sparse or special index entries must be managed externally.".into());
            }
        }
        for c in &s.changes {
            if Path::new(&c.path)
                .file_name()
                .is_some_and(|n| n == ".gitattributes")
            {
                s.blocked = Some("Git attributes require an external Git tool.".into());
            }
            if self.root.join(&c.path).join(".git").exists() {
                s.blocked = Some("Nested repositories must be managed externally.".into());
            }
        }
        s.fingerprint = self.snapshot(&repo)?;
        Ok(s)
    }
    fn writable(&self) -> Result<GitStatus> {
        let s = self.status()?;
        ensure!(
            s.available,
            "{}",
            s.reason.as_deref().unwrap_or("Git unavailable")
        );
        ensure!(
            s.blocked.is_none(),
            "{}",
            s.blocked.as_deref().unwrap_or_default()
        );
        Ok(s)
    }
    fn remote(repo: &Repository) -> Result<(String, String)> {
        let head = repo.head()?;
        let branch = head.shorthand().context("No branch")?;
        let cfg = repo.config()?;
        let remote = cfg
            .get_string(&format!("branch.{branch}.remote"))
            .context("Configure an upstream externally first")?;
        let merge = cfg.get_string(&format!("branch.{branch}.merge"))?;
        ensure!(
            remote != "." && !remote.starts_with('-') && merge.starts_with("refs/heads/"),
            "Configure a remote upstream branch externally first"
        );
        Ok((remote, merge))
    }
    fn callbacks() -> git2::RemoteCallbacks<'static> {
        let mut cb = git2::RemoteCallbacks::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        cb.transfer_progress(move |_| std::time::Instant::now() < deadline);
        let mut attempts = 0;
        cb.credentials(move |url, user, allowed| {
            attempts += 1;
            if attempts > 3 || std::time::Instant::now() >= deadline {
                return Err(git2::Error::from_str(
                    "Authentication cancelled or timed out",
                ));
            }
            if allowed.contains(git2::CredentialType::SSH_KEY) {
                return git2::Cred::ssh_key_from_agent(user.unwrap_or("git"));
            }
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
                return git2::Cred::credential_helper(&git2::Config::open_default()?, url, user);
            }
            if allowed.contains(git2::CredentialType::USERNAME) {
                return git2::Cred::username(user.unwrap_or("git"));
            }
            git2::Cred::default()
        });
        cb.push_negotiation(move |_| {
            if std::time::Instant::now() >= deadline {
                Err(git2::Error::from_str("Push timed out"))
            } else {
                Ok(())
            }
        });
        // Keep libgit2's certificate and SSH known-host verification enabled.
        cb
    }
    pub fn fetch(&self) -> Result<()> {
        self.writable()?;
        let repo = self.open()?;
        let (name, branch) = Self::remote(&repo)?;
        let mut remote = repo.find_remote(&name)?;
        let mut opts = git2::FetchOptions::new();
        opts.remote_callbacks(Self::callbacks());
        let tracking = Self::fetched_ref(&repo, &name, &branch)?;
        remote.fetch(&[&format!("+{branch}:{tracking}")], Some(&mut opts), None)?;
        Ok(())
    }
    pub fn push(&self) -> Result<()> {
        let oid = self
            .open()?
            .head()?
            .target()
            .context("No HEAD")?
            .to_string();
        self.push_commit(&oid)
    }
    pub fn push_commit(&self, oid: &str) -> Result<()> {
        self.writable()?;
        let repo = self.open()?;
        let (name, branch) = Self::remote(&repo)?;
        let mut remote = repo.find_remote(&name)?;
        let mut opts = git2::PushOptions::new();
        let mut cb = Self::callbacks();
        cb.push_update_reference(|_, status| match status {
            Some(s) if s.contains("non-fast-forward") => Err(git2::Error::new(
                git2::ErrorCode::NotFastForward,
                git2::ErrorClass::Reference,
                s,
            )),
            Some(s) => Err(git2::Error::from_str(s)),
            None => Ok(()),
        });
        opts.remote_callbacks(cb);
        let oid = Oid::from_str(oid)?;
        repo.find_commit(oid)?;
        ensure!(
            repo.head()?.target() == Some(oid),
            "HEAD changed before push; reconcile again"
        );
        remote.push(&[&format!("{oid}:{branch}")], Some(&mut opts))?;
        Ok(())
    }
    pub fn pull(&self) -> Result<()> {
        ensure!(
            self.writable()?.changes.is_empty(),
            "Commit local changes before pulling"
        );
        self.fetch()?;
        ensure!(
            self.writable()?.changes.is_empty(),
            "Library changed while fetching; checkpoint before pulling"
        );
        let repo = self.open()?;
        let old = repo.head()?.target().context("No HEAD")?;
        let (name, branch) = Self::remote(&repo)?;
        let new = repo
            .find_reference(&Self::fetched_ref(&repo, &name, &branch)?)?
            .target()
            .context("No fetched commit")?;
        ensure!(
            old == new || repo.graph_descendant_of(new, old)?,
            "Histories diverged; use sync or an external Git tool"
        );
        if old != new {
            self.install(&repo, old, new, &self.snapshot(&repo)?)?;
        }
        Ok(())
    }
    pub fn commit(&mut self, message: &str) -> Result<String> {
        let s = self.writable()?;
        ensure!(
            !s.staged,
            "Changes were staged externally. Finish or clear staging externally first"
        );
        ensure!(!s.changes.is_empty(), "There are no changes to commit");
        let repo = self.open()?;
        let old = repo.head()?.target().context("No HEAD")?;
        let mut index = git2::Index::new()?;
        index.read_tree(&repo.find_commit(old)?.tree()?)?;
        for change in &s.changes {
            self.stage_path(&repo, &mut index, &change.path)?;
        }
        let tree = repo.find_tree(index.write_tree_to(&repo)?)?;
        let sig = repo
            .signature()
            .context("Configure Git user.name and user.email externally")?;
        let id = repo.commit(None, &sig, &sig, message, &tree, &[&repo.find_commit(old)?])?;
        self.install(&repo, old, id, &s.fingerprint)?;
        Ok(id.to_string())
    }
    pub fn diff(&self, path: &str) -> Result<GitDiff> {
        ensure!(
            !path.is_empty()
                && Path::new(path)
                    .components()
                    .all(|c| matches!(c, Component::Normal(_))),
            "Invalid repository-relative path"
        );
        let s = self.status()?;
        let change = s
            .changes
            .iter()
            .find(|c| c.path == path)
            .context("This file is no longer changed")?;
        let repo = self.open()?;
        let tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let mut opts = git2::DiffOptions::new();
        opts.pathspec(path)
            .include_untracked(true)
            .show_untracked_content(true);
        let diff = repo.diff_tree_to_workdir_with_index(tree.as_ref(), Some(&mut opts))?;
        let mut bytes = Vec::new();
        let mut binary = false;
        let mut truncated = false;
        diff.print(git2::DiffFormat::Patch, |delta, _, line| {
            binary |= delta.flags().contains(git2::DiffFlags::BINARY) || line.origin() == 'B';
            let content = line.content();
            let left = DIFF_LIMIT.saturating_sub(bytes.len());
            if matches!(line.origin(), '+' | '-' | ' ') && left > 0 {
                bytes.push(line.origin() as u8);
            }
            let left = DIFF_LIMIT.saturating_sub(bytes.len());
            bytes.extend_from_slice(&content[..content.len().min(left)]);
            truncated |= content.len() > left;
            true
        })?;
        Ok(GitDiff {
            text: String::from_utf8_lossy(&bytes).into_owned(),
            binary,
            truncated,
            size: change.size,
        })
    }
}
