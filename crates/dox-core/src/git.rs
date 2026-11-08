//! Small Git operations for a library rooted at an existing repository.
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

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
    // A failed commit may be retried only against the same HEAD and index.
    retry_index: Option<(String, Vec<u8>)>,
}
struct Output {
    success: bool,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
    truncated: bool,
}
impl GitRepository {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            retry_index: None,
        }
    }
    fn run(&self, args: &[&str], limit: usize) -> Result<Output> {
        let stdout = tempfile::tempfile()?;
        let stderr = tempfile::tempfile()?;
        let mut command = Command::new("git");
        command
            .current_dir(&self.root)
            .args([
                "--no-pager",
                "--literal-pathspecs",
                "-c",
                "credential.interactive=false",
            ])
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .env("GIT_ASKPASS", "")
            .env("SSH_ASKPASS", "")
            .env("SSH_ASKPASS_REQUIRE", "never")
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .env_remove("GIT_PREFIX")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(stdout.try_clone()?)
            .stderr(stderr.try_clone()?);
        // Retain custom SSH transports; make the default SSH transport noninteractive.
        if matches!(args.first(), Some(&"fetch") | Some(&"push"))
            && std::env::var_os("GIT_SSH_COMMAND").is_none()
            && std::env::var_os("GIT_SSH").is_none()
            && self.text(&["config", "--get", "core.sshCommand"]).is_err()
        {
            command.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
        }
        // Kill descendants too, including SSH, signing processes and hooks.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .context("Cannot run Git. Install Git and make it available to dox")?;
        let start = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if start.elapsed() > Duration::from_secs(60) {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                bail!(
                    "Git timed out after 60 seconds. Repository state has been refreshed; check it before retrying."
                );
            }
            thread::sleep(Duration::from_millis(25));
        };
        use std::io::{Seek, SeekFrom};
        let mut stdout = stdout;
        let mut stderr = stderr;
        stdout.seek(SeekFrom::Start(0))?;
        stderr.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::new();
        stdout.take(limit as u64 + 1).read_to_end(&mut bytes)?;
        let truncated = bytes.len() > limit;
        bytes.truncate(limit);
        let mut errors = String::new();
        stderr.take(16 * 1024).read_to_string(&mut errors).ok();
        Ok(Output {
            success: status.success(),
            code: status.code(),
            stdout: bytes,
            stderr: errors.trim().into(),
            truncated,
        })
    }
    fn checked(&self, args: &[&str]) -> Result<Vec<u8>> {
        let result = self.run(args, 16 * 1024 * 1024)?;
        if !result.success {
            let details = if result.stderr.is_empty() {
                String::from_utf8_lossy(&result.stdout[..result.stdout.len().min(16 * 1024)])
                    .trim()
                    .to_owned()
            } else {
                result.stderr
            };
            bail!(
                "{}",
                if details.is_empty() {
                    "Git operation failed"
                } else {
                    &details
                }
            );
        }
        ensure!(
            !result.truncated,
            "Git output is too large to process safely"
        );
        Ok(result.stdout)
    }
    fn text(&self, args: &[&str]) -> Result<String> {
        Ok(String::from_utf8(self.checked(args)?)
            .context("Git returned a non-UTF-8 path or reference")?
            .trim()
            .into())
    }
    fn head(&self) -> String {
        self.text(&["rev-parse", "--verify", "HEAD"])
            .unwrap_or_default()
    }
    fn index_fingerprint(&self) -> Result<Vec<u8>> {
        let path = self.text(&["rev-parse", "--git-path", "index"])?;
        Ok(Sha256::digest(fs::read(self.root.join(path)).unwrap_or_default()).to_vec())
    }
    pub fn status(&self) -> Result<GitStatus> {
        let top = match self.run(&["rev-parse", "--show-toplevel"], 64 * 1024) {
            Ok(output) if output.success => String::from_utf8(output.stdout)?,
            Ok(_) => return Ok(GitStatus { reason: Some("This library is not in a Git repository. Set one up externally, then check again.".into()), ..Default::default() }),
            Err(error) => return Ok(GitStatus { reason: Some(format!("{error:#}")), ..Default::default() }),
        };
        if Path::new(top.trim()).canonicalize()? != self.root || !self.root.join(".git").is_dir() {
            return Ok(GitStatus { reason: Some("Git support requires a library at the root of a regular repository. Nested libraries and linked worktrees are not supported yet.".into()), ..Default::default() });
        }
        let branch = self
            .text(&["symbolic-ref", "--quiet", "--short", "HEAD"])
            .ok();
        let upstream = self
            .text(&[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ])
            .ok();
        let mut status = GitStatus {
            available: true,
            branch,
            upstream,
            ..Default::default()
        };
        if status.upstream.is_some()
            && let Ok(counts) =
                self.text(&["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        {
            let mut parts = counts.split_whitespace();
            status.ahead = parts.next().and_then(|s| s.parse().ok());
            status.behind = parts.next().and_then(|s| s.parse().ok());
        }
        let bytes = self.checked(&[
            "-c",
            "status.renames=false",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ])?;
        for entry in bytes.split(|b| *b == 0).filter(|p| !p.is_empty()) {
            ensure!(entry.len() >= 4, "Invalid Git status record");
            let x = entry[0];
            let y = entry[1];
            let path = String::from_utf8(entry[3..].to_vec())
                .context("A changed filename is not valid UTF-8; manage it externally")?;
            let conflict =
                x == b'U' || y == b'U' || (x == b'A' && y == b'A') || (x == b'D' && y == b'D');
            let staged = x != b' ' && x != b'?';
            status.staged |= staged;
            status.conflicts |= conflict;
            let kind = if conflict {
                "conflict"
            } else if x == b'?' || x == b'A' {
                "added"
            } else if x == b'D' || y == b'D' {
                "deleted"
            } else {
                "modified"
            };
            let size = fs::symlink_metadata(self.root.join(&path))
                .ok()
                .map(|m| m.len());
            status.changes.push(GitChange {
                path,
                status: kind.into(),
                staged,
                size,
            });
        }
        status.retry_commit = self.retry_index.as_ref().is_some_and(|(head, index)| {
            *head == self.head()
                && self
                    .index_fingerprint()
                    .is_ok_and(|current| &current == index)
        });
        let git_dir = self.root.join(".git");
        status.blocked = if status.branch.is_none() {
            Some("Detached HEAD: switch to a branch externally.".into())
        } else if status.conflicts {
            Some("Resolve Git conflicts externally before continuing.".into())
        } else if [
            "MERGE_HEAD",
            "rebase-merge",
            "rebase-apply",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "sequencer",
            "BISECT_LOG",
        ]
        .iter()
        .any(|name| git_dir.join(name).exists())
        {
            Some("Finish the current Git operation externally.".into())
        } else {
            None
        };
        if status.changes.iter().any(|change| {
            self.root.join(&change.path).is_dir()
                && self.root.join(&change.path).join(".git").exists()
        }) {
            status.blocked = Some("Nested repositories must be managed externally.".into());
        }
        let tracked = self.checked(&["ls-files", "--stage", "-z"])?;
        for entry in tracked.split(|b| *b == 0) {
            if entry.starts_with(b"160000 ") {
                status.blocked =
                    Some("Repositories containing submodules must be managed externally.".into());
            }
            if let Some(tab) = entry.iter().position(|b| *b == b'\t') {
                let path = &entry[tab + 1..];
                if path.starts_with(b".cache/") || path.starts_with(b".trash/") {
                    status.blocked = Some("Generated .cache or .trash files are tracked. Untrack them externally before using Git in dox.".into());
                }
            }
        }
        let mut fingerprint = Sha256::new();
        fingerprint.update(&bytes);
        fingerprint.update(self.head());
        fingerprint.update(self.index_fingerprint()?);
        for change in &status.changes {
            if let Ok(meta) = fs::symlink_metadata(self.root.join(&change.path)) {
                fingerprint.update(meta.len().to_le_bytes());
                fingerprint.update(format!("{:?}", meta.modified().ok()));
            }
        }
        status.fingerprint = format!("{:x}", fingerprint.finalize());
        Ok(status)
    }
    fn writable(&self) -> Result<GitStatus> {
        let status = self.status()?;
        ensure!(
            status.available,
            "{}",
            status.reason.as_deref().unwrap_or("Git unavailable")
        );
        ensure!(
            status.blocked.is_none(),
            "{}",
            status.blocked.as_deref().unwrap_or_default()
        );
        Ok(status)
    }
    fn remote(&self) -> Result<(String, String)> {
        let branch = self.text(&["symbolic-ref", "--quiet", "--short", "HEAD"])?;
        let remote = self
            .text(&["config", "--get", &format!("branch.{branch}.remote")])
            .context("Configure this branch's upstream externally first")?;
        let merge = self
            .text(&["config", "--get", &format!("branch.{branch}.merge")])
            .context("Configure this branch's upstream externally first")?;
        ensure!(
            !remote.starts_with('-') && remote != "." && merge.starts_with("refs/heads/"),
            "Configure a remote upstream branch externally first"
        );
        Ok((remote, merge))
    }
    pub fn fetch(&self) -> Result<()> {
        let status = self.status()?;
        ensure!(
            status.available,
            "{}",
            status.reason.as_deref().unwrap_or("Git unavailable")
        );
        let (remote, _) = self.remote()?;
        self.checked(&["fetch", "--no-recurse-submodules", "--", &remote])?;
        Ok(())
    }
    pub fn pull(&self) -> Result<()> {
        let status = self.writable()?;
        ensure!(
            status.changes.is_empty(),
            "Commit local changes before pulling updates"
        );
        self.fetch()?;
        let status = self.writable()?;
        ensure!(
            status.changes.is_empty(),
            "Library changed while fetching. Commit changes before pulling"
        );
        ensure!(
            status.upstream.is_some(),
            "Configure an upstream branch externally first"
        );
        ensure!(
            !(status.ahead.unwrap_or(0) > 0 && status.behind.unwrap_or(0) > 0),
            "Local and remote histories have diverged. Resolve them in an external Git tool."
        );
        self.checked(&[
            "merge",
            "--ff-only",
            "--no-autostash",
            "--no-edit",
            "@{upstream}",
        ])?;
        Ok(())
    }
    pub fn push(&self) -> Result<()> {
        self.writable()?;
        let (remote, branch) = self.remote()?;
        self.checked(&[
            "push",
            "--no-recurse-submodules",
            "--",
            &remote,
            &format!("HEAD:{branch}"),
        ])?;
        Ok(())
    }
    pub fn commit(&mut self, message: &str) -> Result<String> {
        let status = self.writable()?;
        ensure!(!status.changes.is_empty(), "There are no changes to commit");
        ensure!(
            !status.staged || status.retry_commit,
            "Changes were staged externally. Finish or clear that staging externally first"
        );
        // Never reset an index after failure: hooks or an external Git client may have changed it.
        self.checked(&["add", "--all", "--", "."])?;
        self.retry_index = Some((self.head(), self.index_fingerprint()?));
        let mut file = tempfile::NamedTempFile::new()?;
        use std::io::Write;
        file.write_all(message.as_bytes())?;
        self.checked(&[
            "commit",
            "--allow-empty-message",
            "--file",
            file.path().to_str().context("Invalid temporary path")?,
        ])?;
        self.retry_index = None;
        Ok(self.head())
    }
    pub fn diff(&self, path: &str) -> Result<GitDiff> {
        ensure!(
            !path.is_empty()
                && Path::new(path)
                    .components()
                    .all(|c| matches!(c, Component::Normal(_))),
            "Invalid repository-relative path"
        );
        let status = self.status()?;
        let change = status
            .changes
            .iter()
            .find(|c| c.path == path)
            .context("This file is no longer changed")?;
        let mut result = GitDiff {
            text: String::new(),
            binary: false,
            truncated: false,
            size: change.size,
        };
        let head = self.head();
        if result.size.is_none() && !head.is_empty() {
            result.size = self
                .text(&["cat-file", "-s", &format!("HEAD:{path}")])
                .ok()
                .and_then(|size| size.parse().ok());
        }
        let untracked = self
            .run(&["ls-files", "--error-unmatch", "--", path], 64 * 1024)?
            .success
            == false;
        let output = if (untracked || head.is_empty())
            && change.status == "added"
            && self.root.join(path).exists()
        {
            let full = self.root.join(path);
            let metadata = fs::symlink_metadata(&full)?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                result.binary = true;
                return Ok(result);
            }
            ensure!(
                full.canonicalize()?.starts_with(&self.root),
                "File is outside the library"
            );
            #[cfg(unix)]
            let empty_path = "/dev/null";
            #[cfg(not(unix))]
            let empty = tempfile::NamedTempFile::new()?;
            #[cfg(not(unix))]
            let empty_path = empty.path().to_str().context("Invalid temporary path")?;
            self.run(
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-index",
                    "--",
                    empty_path,
                    path,
                ],
                DIFF_LIMIT,
            )?
        } else if head.is_empty() {
            self.run(
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--cached",
                    "--",
                    path,
                ],
                DIFF_LIMIT,
            )?
        } else {
            self.run(
                &["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", path],
                DIFF_LIMIT,
            )?
        };
        ensure!(
            output.success || output.code == Some(1),
            "{}",
            output.stderr
        );
        result.binary =
            output.stdout.windows(13).any(|s| s == b"Binary files ") || output.stdout.contains(&0);
        result.text = String::from_utf8_lossy(&output.stdout).into_owned();
        result.truncated = output.truncated;
        Ok(result)
    }
}
