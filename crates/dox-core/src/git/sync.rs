use super::*;
use std::io::Write;

impl GitRepository {
    // Hash bytes, not just timestamps. Include ignored files because checkout must
    // not replace an ignored local file with a newly tracked remote file.
    pub(super) fn snapshot(&self, repo: &Repository) -> Result<String> {
        fn visit(dir: &Path, hash: &mut Sha256) -> Result<()> {
            let mut entries = fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(|e| e.file_name());
            for e in entries {
                if e.file_name() == ".git" || e.file_name() == ".cache" || e.file_name() == ".trash"
                {
                    continue;
                }
                ensure!(
                    !e.file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(".gitattributes"),
                    "Git attributes require an external Git tool (including ignored attribute files)"
                );
                hash.update((e.file_name().as_encoded_bytes().len() as u64).to_le_bytes());
                hash.update(e.file_name().as_encoded_bytes());
                let m = fs::symlink_metadata(e.path())?;
                hash.update(format!("{:?}", m.permissions()));
                if m.is_dir() {
                    hash.update(b"directory");
                    visit(&e.path(), hash)?;
                    hash.update(b"end-directory");
                } else if m.is_file() {
                    let bytes = fs::read(e.path())?;
                    hash.update(b"file");
                    hash.update((bytes.len() as u64).to_le_bytes());
                    hash.update(bytes);
                } else {
                    hash.update(fs::read_link(e.path())?.as_os_str().as_encoded_bytes());
                }
            }
            Ok(())
        }
        let mut hash = Sha256::new();
        hash.update(
            repo.head()
                .ok()
                .and_then(|h| h.name().map(str::to_owned))
                .unwrap_or_default(),
        );
        hash.update(
            repo.head()
                .ok()
                .and_then(|h| h.target())
                .map(|o| o.to_string())
                .unwrap_or_default(),
        );
        hash.update(fs::read(repo.path().join("index")).unwrap_or_default());
        visit(&self.root, &mut hash)?;
        Ok(format!("{:x}", hash.finalize()))
    }
    fn add_blob(
        repo: &Repository,
        index: &mut git2::Index,
        path: &str,
        bytes: &[u8],
        mode: u32,
    ) -> Result<()> {
        ensure!(
            Path::new(path)
                .components()
                .all(|c| matches!(c, Component::Normal(_)))
                && !path.starts_with(".git/"),
            "Unsafe tree path"
        );
        let entry = git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode,
            uid: 0,
            gid: 0,
            file_size: bytes.len() as u32,
            id: repo.blob(bytes)?,
            flags: 0,
            flags_extended: 0,
            path: path.as_bytes().to_vec(),
        };
        index.add(&entry)?;
        Ok(())
    }
    pub(super) fn stage_path(
        &self,
        repo: &Repository,
        index: &mut git2::Index,
        path: &str,
    ) -> Result<()> {
        let full = self.root.join(path);
        match fs::symlink_metadata(&full) {
            Ok(m) => {
                ensure!(
                    m.is_file() && !m.file_type().is_symlink(),
                    "Only regular files can be checkpointed; manage symlinks and nested repositories externally"
                );
                ensure!(
                    full.canonicalize()?.starts_with(self.root.canonicalize()?),
                    "Path escapes repository"
                );
                #[cfg(unix)]
                let mode = {
                    use std::os::unix::fs::PermissionsExt;
                    if m.permissions().mode() & 0o111 != 0 {
                        0o100755
                    } else {
                        0o100644
                    }
                };
                #[cfg(not(unix))]
                let mode = 0o100644;
                Self::add_blob(repo, index, path, &fs::read(full)?, mode)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                index.remove_path(Path::new(path))?;
            }
            Err(e) => return Err(e.into()),
        }
        Ok(())
    }
    // A durable journal intentionally blocks future writes after any partial
    // checkout or ref/index failure. Recovery is external, never a forced reset.
    pub(super) fn install(
        &self,
        repo: &Repository,
        old: Oid,
        new: Oid,
        expected: &str,
    ) -> Result<()> {
        ensure!(
            self.snapshot(repo)? == expected,
            "Repository changed during operation; nothing installed"
        );
        let head = repo.head()?;
        let name = head.name().context("Invalid HEAD")?.to_owned();
        ensure!(head.target() == Some(old), "HEAD changed externally");
        let tree = repo.find_commit(new)?.tree()?;
        Self::validate_tree(repo, &tree)?;
        // Keep both commits reachable even if checkout, ref update, or recovery
        // is interrupted. Never replace an existing retention reference.
        for oid in [old, new] {
            let retention = format!("refs/dox/retained/{oid}");
            match repo.find_reference(&retention) {
                Ok(reference) => ensure!(
                    reference.target() == Some(oid),
                    "Retention reference has an unexpected target"
                ),
                Err(e) if e.code() == git2::ErrorCode::NotFound => {
                    repo.reference(&retention, oid, false, "dox recovery retention")?;
                }
                Err(e) => return Err(e.into()),
            }
        }
        let mut journal = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(repo.path().join("dox-sync-journal"))?;
        journal.write_all(serde_json::to_string_pretty(&serde_json::json!({"branch":name,"old":old.to_string(),"new":new.to_string(),"snapshot":expected,"recovery":"Inspect worktree and index against both commits. Preserve external edits before completing or reverting this transaction. Remove this journal only after external recovery."}))?.as_bytes())?;
        journal.sync_all()?;
        ensure!(
            self.snapshot(repo)? == expected,
            "Repository changed; journal retained for recovery"
        );
        if repo.diff_tree_to_workdir(Some(&tree), None)?.deltas().len() == 0 {
            // A checkpoint already matches the files on disk. Checking it out
            // would reject its newly added files as untracked collisions.
            // Encode a separate index, then install it under Git's index lock.
            let staging = tempfile::tempdir_in(repo.path())?;
            let staged_path = staging.path().join("index");
            let mut staged = git2::Index::open(&staged_path)?;
            staged.read_tree(&tree)?;
            staged.write()?;
            let lock_path = repo.path().join("index.lock");
            let mut lock = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
                .context("Cannot lock Git index; journal retained")?;
            let result = (|| -> Result<()> {
                ensure!(
                    self.snapshot(repo)? == expected,
                    "Repository changed before checkpoint; journal retained"
                );
                lock.write_all(&fs::read(&staged_path)?)?;
                lock.sync_all()?;
                fs::rename(&lock_path, repo.path().join("index"))?;
                Ok(())
            })();
            drop(lock);
            if result.is_err() {
                let _ = fs::remove_file(&lock_path);
            }
            result?;
        } else {
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout
                .safe()
                .recreate_missing(false)
                .overwrite_ignored(false);
            repo.checkout_tree(tree.as_object(), Some(&mut checkout))
                .context("Checkout incomplete; journal retained for external recovery")?;
        }
        ensure!(
            repo.head()?.name() == Some(name.as_str()),
            "Branch switched; journal retained"
        );
        // checkout_tree updates the on-disk index under libgit2's lock. Never
        // rewrite it a second time: that could erase a concurrent client's edit.
        let mut index = repo.index()?;
        index.read(true)?;
        ensure!(
            index.write_tree_to(repo)? == tree.id(),
            "Index changed during checkout; journal retained"
        );
        ensure!(
            repo.diff_tree_to_workdir_with_index(Some(&tree), None)?
                .deltas()
                .len()
                == 0,
            "Worktree changed during checkout; journal retained"
        );
        repo.reference_matching(&name, new, true, old, "dox transaction")?;
        fs::remove_file(repo.path().join("dox-sync-journal"))?;
        Ok(())
    }
    fn validate_tree(repo: &Repository, tree: &git2::Tree<'_>) -> Result<()> {
        let mut failure = None;
        let walk = tree.walk(git2::TreeWalkMode::PreOrder, |prefix, e| {
            let path = format!("{prefix}{}", e.name().unwrap_or(""));
            if e.name().is_none()
                || e.filemode() == 0o160000
                || e.filemode() == 0o120000
                || path == ".cache"
                || path == ".trash"
                || path.starts_with(".cache/")
                || path.starts_with(".trash/")
                || path.split('/').any(|p| {
                    p.eq_ignore_ascii_case(".git") || p.eq_ignore_ascii_case(".gitattributes")
                })
            {
                failure = Some(format!("Unsupported or unsafe tree entry: {path}"));
                return git2::TreeWalkResult::Abort;
            }
            git2::TreeWalkResult::Ok
        });
        if let Some(e) = failure {
            bail!("{e}");
        }
        walk?;
        if let Ok(notes) = tree.get_path(Path::new("notes")) {
            let notes = repo.find_tree(notes.id())?;
            for note in notes.iter() {
                let id = note.name().context("Invalid note path")?;
                if !crate::valid_id(id) {
                    continue;
                }
                let nt = repo.find_tree(note.id())?;
                let meta = nt
                    .get_name("meta.json")
                    .context("Structural note deletion or metadata conflict; resolve externally")?;
                let metadata: crate::Metadata =
                    serde_json::from_slice(repo.find_blob(meta.id())?.content())?;
                ensure!(
                    !metadata.kind.is_empty()
                        && !metadata.document.is_empty()
                        && Path::new(&metadata.document)
                            .components()
                            .all(|c| matches!(c, Component::Normal(_))),
                    "Unsafe note metadata"
                );
                let doc = nt.get_path(Path::new(&metadata.document)).context(
                    "Note document missing after merge; resolve structural edit/delete externally",
                )?;
                ensure!(
                    doc.kind() == Some(git2::ObjectType::Blob),
                    "Note source is not a file"
                );
            }
        }
        Ok(())
    }
    pub(super) fn fetched_ref(repo: &Repository, remote: &str, branch: &str) -> Result<String> {
        let r = repo.find_remote(remote)?;
        let url = r.url().context("Remote URL is not UTF-8")?;
        Ok(format!(
            "refs/dox/fetched/{:x}",
            Sha256::digest(format!("{remote}\0{branch}\0{url}").as_bytes())
        ))
    }
    pub fn is_push_race(error: &anyhow::Error) -> bool {
        error
            .downcast_ref::<git2::Error>()
            .is_some_and(|e| e.code() == git2::ErrorCode::NotFastForward)
    }
    pub fn checkpoint(&mut self) -> Result<String> {
        let s = self.writable()?;
        ensure!(!s.staged, "Clear external staging before sync");
        if !s.changes.is_empty() {
            return self.commit("dox: local checkpoint");
        }
        Ok(self
            .open()?
            .head()?
            .target()
            .context("No HEAD")?
            .to_string())
    }
    /// No network operations. The fetched ref is bound to the configured upstream.
    pub fn reconcile_fetched(&mut self) -> Result<String> {
        self.checkpoint()?;
        let repo = self.open()?;
        let expected = self.snapshot(&repo)?;
        let local = repo.head()?.target().context("No HEAD")?;
        let (name, branch) = Self::remote(&repo)?;
        let remote = repo
            .find_reference(&Self::fetched_ref(&repo, &name, &branch)?)?
            .target()
            .context("Fetch upstream first")?;
        let target = if local == remote || repo.graph_descendant_of(local, remote)? {
            local
        } else if repo.graph_descendant_of(remote, local)? {
            remote
        } else {
            self.merge(&repo, local, remote)?
        };
        if target != local {
            self.install(&repo, local, target, &expected)?;
        }
        Ok(target.to_string())
    }
    pub fn sync(&mut self) -> Result<String> {
        let s = self.writable()?;
        ensure!(!s.staged, "Clear external staging before sync");
        if !s.changes.is_empty() {
            self.commit("dox: local checkpoint")?;
        }
        self.fetch()?;
        self.sync_fetched()
    }
    /// Convenience wrapper after fetch. Push and race retries use the network;
    /// editor integrations should use reconcile_fetched and push_commit instead.
    pub fn sync_fetched(&mut self) -> Result<String> {
        let s = self.writable()?;
        ensure!(!s.staged, "Clear external staging before sync");
        if !s.changes.is_empty() {
            self.commit("dox: local checkpoint")?;
        }
        for attempt in 0..3 {
            let target = self.reconcile_fetched()?;
            match self.push_commit(&target) {
                Ok(()) => return Ok(target),
                Err(e) if attempt == 2 => {
                    return Err(e.context(
                        "Sync push failed after three attempts; local commits remain safe",
                    ));
                }
                Err(e) if Self::is_push_race(&e) => {
                    std::thread::sleep(std::time::Duration::from_millis(100 * (attempt + 1)));
                    self.fetch()?;
                }
                Err(e) => return Err(e),
            }
        }
        unreachable!()
    }
    fn merge(&self, repo: &Repository, local: Oid, remote: Oid) -> Result<Oid> {
        let base = repo
            .merge_base(local, remote)
            .context("Unrelated histories cannot be synced")?;
        let ours = repo.find_commit(local)?;
        let theirs = repo.find_commit(remote)?;
        let ancestor = repo.find_commit(base)?.tree()?;
        // Check all inputs before libgit2 can apply incoming merge attributes.
        Self::validate_tree(repo, &ancestor)?;
        Self::validate_tree(repo, &ours.tree()?)?;
        Self::validate_tree(repo, &theirs.tree()?)?;
        let mut options = git2::MergeOptions::new();
        options.find_renames(false);
        let mut index =
            repo.merge_trees(&ancestor, &ours.tree()?, &theirs.tree()?, Some(&options))?;
        let conflicts = index
            .conflicts()?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for conflict in conflicts {
            let entry = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .context("Empty conflict")?;
            let path = std::str::from_utf8(&entry.path)?;
            let mut bytes = None;
            match (&conflict.our, &conflict.their) {
                (Some(o), Some(t)) => {
                    ensure!(
                        o.path == t.path
                            && (o.mode == 0o100644 || o.mode == 0o100755)
                            && o.mode == t.mode,
                        "Structural conflict requires external resolution"
                    );
                    let mut opts = git2::MergeFileOptions::new();
                    opts.favor(git2::FileFavor::Theirs);
                    let local_blob = repo.find_blob(o.id)?;
                    let upstream_blob = repo.find_blob(t.id)?;
                    // Metadata is structured JSON. Prefer the complete upstream
                    // object rather than risk a text merge with invalid fields.
                    let merged = if path.ends_with("/meta.json")
                        || conflict.ancestor.is_none()
                        || local_blob.content().contains(&0)
                        || upstream_blob.content().contains(&0)
                    {
                        Err(git2::Error::from_str(
                            "Use complete upstream for add/add or binary conflict",
                        ))
                    } else {
                        repo.merge_file_from_index(
                            conflict
                                .ancestor
                                .as_ref()
                                .context("Missing merge ancestor")?,
                            o,
                            t,
                            Some(&mut opts),
                        )
                    };
                    bytes = Some(match merged {
                        Ok(m) if m.is_automergeable() => m.content().to_vec(),
                        _ => upstream_blob.content().to_vec(),
                    });
                }
                (Some(o), None) => bytes = Some(repo.find_blob(o.id)?.content().to_vec()),
                (None, Some(t)) => bytes = Some(repo.find_blob(t.id)?.content().to_vec()),
                _ => {}
            }
            if let Some(o) = &conflict.our {
                self.conflict_note(
                    repo,
                    &mut index,
                    path,
                    o,
                    conflict.their.as_ref(),
                    &ours.tree()?,
                )?;
            } else if let Some(t) = &conflict.their {
                // The edited side also needs a durable record when local deleted.
                self.conflict_note(repo, &mut index, path, t, None, &theirs.tree()?)?;
            }
            index.conflict_remove(Path::new(path))?;
            if let Some(bytes) = bytes {
                Self::add_blob(repo, &mut index, path, &bytes, entry.mode)?;
            }
        }
        // Whole-note edit/delete: restore the complete edited note, including
        // unchanged metadata, source dependencies and attachments.
        for (edited, deleted) in [(&ours, &theirs), (&theirs, &ours)] {
            if let Ok(notes) = edited.tree()?.get_path(Path::new("notes")) {
                for note in repo.find_tree(notes.id())?.iter() {
                    let id = note.name().context("Invalid note ID")?;
                    if !crate::valid_id(id) {
                        continue;
                    }
                    let prefix = format!("notes/{id}");
                    if deleted.tree()?.get_path(Path::new(&prefix)).is_ok() {
                        continue;
                    }
                    let Ok(base_note) = ancestor.get_path(Path::new(&prefix)) else {
                        continue;
                    };
                    if base_note.id() == note.id() {
                        continue;
                    }
                    let nt = repo.find_tree(note.id())?;
                    let mut files = Vec::new();
                    nt.walk(git2::TreeWalkMode::PreOrder, |p, e| {
                        if e.kind() == Some(git2::ObjectType::Blob) {
                            files.push((
                                format!("{prefix}/{p}{}", e.name().unwrap_or("")),
                                e.id(),
                                e.filemode() as u32,
                            ));
                        }
                        git2::TreeWalkResult::Ok
                    })?;
                    for (path, oid, mode) in files {
                        let _ = index.remove_path(Path::new(&path));
                        Self::add_blob(
                            repo,
                            &mut index,
                            &path,
                            repo.find_blob(oid)?.content(),
                            mode,
                        )?;
                    }
                }
            }
        }
        let tree = repo.find_tree(index.write_tree_to(repo)?)?;
        Self::validate_tree(repo, &tree)?;
        let sig = repo.signature()?;
        Ok(repo.commit(
            None,
            &sig,
            &sig,
            "dox: sync upstream (local conflict copies preserved)",
            &tree,
            &[&ours, &theirs],
        )?)
    }
    fn conflict_note(
        &self,
        repo: &Repository,
        index: &mut git2::Index,
        path: &str,
        local: &git2::IndexEntry,
        remote: Option<&git2::IndexEntry>,
        tree: &git2::Tree<'_>,
    ) -> Result<()> {
        let identity = format!(
            "{path}\0{}\0{}",
            local.id,
            remote.map(|r| r.id.to_string()).unwrap_or_default()
        );
        let hash = Sha256::digest(identity.as_bytes());
        let mut n = u64::from_be_bytes(hash[..8].try_into().unwrap());
        const A: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let mut chosen = None;
        for _ in 0..1024 {
            let mut v = n;
            let mut id = String::new();
            for _ in 0..5 {
                id.push(A[(v % 36) as usize] as char);
                v /= 36;
            }
            let prefix = format!("notes/{id}");
            if let Some(meta) = index.get_path(Path::new(&format!("{prefix}/meta.json")), 0) {
                if let Ok(value) =
                    serde_json::from_slice::<serde_json::Value>(repo.find_blob(meta.id)?.content())
                {
                    if value.get("conflict_identity").and_then(|v| v.as_str())
                        == Some(identity.as_str())
                    {
                        ensure!(
                            index
                                .get_path(Path::new(&format!("{prefix}/attachments/local.bin")), 0)
                                .is_some_and(|e| e.id == local.id)
                                && index
                                    .get_path(Path::new(&format!("{prefix}/note.typ")), 0)
                                    .is_some(),
                            "An existing conflict record is incomplete or edited; preserve and resolve it externally"
                        );
                        return Ok(());
                    }
                }
            }
            if tree.get_path(Path::new(&prefix)).is_err()
                && !index
                    .iter()
                    .any(|e| e.path.starts_with(format!("{prefix}/").as_bytes()))
            {
                chosen = Some(prefix);
                break;
            }
            n = n.wrapping_add(1);
        }
        let prefix = chosen.context("Conflict note ID space exhausted")?;
        let meta = serde_json::to_vec_pretty(
            &serde_json::json!({"type":"typst","document":"note.typ","title":"Git conflict: preserved edit","conflict_identity":identity,"original_path":path}),
        )?;
        Self::add_blob(repo, index, &format!("{prefix}/meta.json"), &meta, 0o100644)?;
        let kind = if remote.is_none() {
            "edit/delete"
        } else {
            "content or add/add"
        };
        let description = format!(
            "= Git conflict: preserved edit\n\n#text({})\n\nThe complete preserved file is in attachments/local.bin. Upstream wins conflicting regions; edits win deletion.\n",
            serde_json::to_string(&format!(
                "Path: {path}; preserved blob: {}; other blob: {}; conflict: {kind}",
                local.id,
                remote
                    .map(|r| r.id.to_string())
                    .unwrap_or_else(|| "deleted".into())
            ))?
        );
        Self::add_blob(
            repo,
            index,
            &format!("{prefix}/note.typ"),
            description.as_bytes(),
            0o100644,
        )?;
        Self::add_blob(
            repo,
            index,
            &format!("{prefix}/attachments/local.bin"),
            repo.find_blob(local.id)?.content(),
            0o100644,
        )?;
        let parts = path.split('/').collect::<Vec<_>>();
        if parts.len() >= 3 && parts[0] == "notes" && crate::valid_id(parts[1]) {
            if let Ok(e) = tree.get_path(Path::new(&format!("notes/{}/attachments", parts[1]))) {
                let attachments = repo.find_tree(e.id())?;
                for a in attachments.iter() {
                    ensure!(
                        a.kind() == Some(git2::ObjectType::Blob),
                        "Nested attachment directories require external resolution"
                    );
                    let name = a.name().context("Invalid attachment path")?;
                    Self::add_blob(
                        repo,
                        index,
                        &format!("{prefix}/attachments/original-{name}"),
                        repo.find_blob(a.id())?.content(),
                        0o100644,
                    )?;
                }
            }
        }
        Ok(())
    }
}
