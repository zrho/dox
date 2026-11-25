//! Local-only integration coverage. Each fixture owns a bare remote and two clones.
use dox_core::git::GitRepository;
use git2::{Oid, Repository, RepositoryInitOptions, Signature};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;

struct Fixture {
    _dir: TempDir,
    remote: Repository,
    a: PathBuf,
    b: PathBuf,
}
fn configure(repo: &Repository) {
    // Write identity to this repository's local file only.
    // No global config or process environment is changed.
    let mut config = git2::Config::new().unwrap();
    config
        .add_file(&repo.path().join("config"), git2::ConfigLevel::Local, true)
        .unwrap();
    config.set_str("user.name", "Sync Fixture").unwrap();
    config
        .set_str("user.email", "sync@example.invalid")
        .unwrap();
    config.set_bool("commit.gpgsign", false).unwrap();
    config.set_str("core.autocrlf", "false").unwrap();
}
fn put(root: &Path, path: &str, bytes: &[u8]) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}
fn head(root: &Path) -> Oid {
    Repository::open(root)
        .unwrap()
        .head()
        .unwrap()
        .target()
        .unwrap()
}
fn api(root: &Path) -> GitRepository {
    GitRepository::new(root.to_owned())
}
impl Fixture {
    fn new(files: &[(&str, &[u8])]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut opts = RepositoryInitOptions::new();
        opts.bare(true).initial_head("main");
        let remote = Repository::init_opts(dir.path().join("remote.git"), &opts).unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head("main");
        let seed = Repository::init_opts(&a, &opts).unwrap();
        configure(&seed);
        put(&a, "seed.txt", b"seed\n");
        for (p, bytes) in files {
            put(&a, p, bytes);
        }
        let mut index = seed.index().unwrap();
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = seed.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::new(
            "Sync Fixture",
            "sync@example.invalid",
            &git2::Time::new(1_700_000_000, 0),
        )
        .unwrap();
        seed.commit(Some("HEAD"), &sig, &sig, "seed", &tree, &[])
            .unwrap();
        seed.remote("origin", remote.path().to_str().unwrap())
            .unwrap()
            .push(&["refs/heads/main:refs/heads/main"], None)
            .unwrap();
        seed.find_branch("main", git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some("origin/main"))
            .unwrap();
        let clone = Repository::clone(remote.path().to_str().unwrap(), &b).unwrap();
        configure(&clone);
        Self {
            _dir: dir,
            remote,
            a,
            b,
        }
    }
    fn remote_head(&self) -> Oid {
        self.remote
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap()
    }
    fn assert_clean(&self) {
        assert!(api(&self.a).status().unwrap().changes.is_empty());
        assert_eq!(head(&self.a), self.remote_head());
        let repo = Repository::open(&self.a).unwrap();
        assert!(!repo.index().unwrap().has_conflicts());
        assert!(!api(&self.a).status().unwrap().staged);
        assert!(!repo.path().join("dox-sync-journal").exists());
    }
}
fn records(root: &Path, original: &str) -> Vec<(PathBuf, Vec<u8>)> {
    let mut result = Vec::new();
    if let Ok(notes) = fs::read_dir(root.join("notes")) {
        for note in notes {
            let path = note.unwrap().path();
            let Ok(bytes) = fs::read(path.join("meta.json")) else {
                continue;
            };
            let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            if value["original_path"] == original {
                assert!(value["conflict_identity"].is_string());
                assert!(path.join("note.typ").is_file());
                result.push((
                    path.clone(),
                    fs::read(path.join("attachments/local.bin")).unwrap(),
                ));
            }
        }
    }
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}
#[test]
fn checkpoint_push_and_remote_fast_forward() {
    let f = Fixture::new(&[("local.txt", b"base\n")]);
    put(&f.a, "local.txt", b"checkpoint\n");
    let id = api(&f.a).checkpoint().unwrap();
    assert_eq!(head(&f.a).to_string(), id);
    assert_eq!(fs::read(f.a.join("local.txt")).unwrap(), b"checkpoint\n");
    api(&f.a).push_commit(&id).unwrap();
    api(&f.b).sync().unwrap();
    assert_eq!(head(&f.b), head(&f.a));
    assert_eq!(fs::read(f.b.join("local.txt")).unwrap(), b"checkpoint\n");
    f.assert_clean();
}
#[test]
fn clean_divergent_text_edits() {
    let f = Fixture::new(&[("text.txt", b"one\ntwo\nthree\nfour\nfive\nsix\nseven\n")]);
    put(
        &f.a,
        "text.txt",
        b"LOCAL\ntwo\nthree\nfour\nfive\nsix\nseven\n",
    );
    put(
        &f.b,
        "text.txt",
        b"one\ntwo\nthree\nfour\nfive\nsix\nREMOTE\n",
    );
    api(&f.b).sync().unwrap();
    api(&f.a).sync().unwrap();
    assert_eq!(
        fs::read(f.a.join("text.txt")).unwrap(),
        b"LOCAL\ntwo\nthree\nfour\nfive\nsix\nREMOTE\n"
    );
    assert!(records(&f.a, "text.txt").is_empty());
    assert_eq!(
        Repository::open(&f.a)
            .unwrap()
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .parent_count(),
        2
    );
    f.assert_clean();
}
fn content_conflict(base: Option<&[u8]>, local: &[u8], upstream: &[u8]) {
    let files = base.map(|b| vec![("file.dat", b)]).unwrap_or_default();
    let f = Fixture::new(&files);
    put(&f.a, "file.dat", local);
    put(&f.b, "file.dat", upstream);
    api(&f.b).sync().unwrap();
    api(&f.a).sync().unwrap();
    assert_eq!(fs::read(f.a.join("file.dat")).unwrap(), upstream);
    let before = records(&f.a, "file.dat");
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].1, local);
    let merged = head(&f.a);
    api(&f.a).sync().unwrap();
    api(&f.b).sync().unwrap();
    api(&f.a).sync().unwrap();
    assert_eq!(records(&f.a, "file.dat"), before);
    assert_eq!(head(&f.a), merged);
    f.assert_clean();
}
#[test]
fn overlapping_text_upstream_wins_and_repeat_sync_deduplicates() {
    content_conflict(Some(b"base\n"), b"local exact\r\n", b"upstream\n");
}
#[test]
fn text_conflict_keeps_non_conflicting_local_regions() {
    let f = Fixture::new(&[("text.txt", b"base\n2\n3\n4\n5\n6\n7\n8\nend\n")]);
    let local = b"local conflict\n2\n3\n4\n5\n6\n7\n8\nLOCAL END\n";
    put(&f.a, "text.txt", local);
    put(
        &f.b,
        "text.txt",
        b"upstream conflict\n2\n3\n4\n5\n6\n7\n8\nend\n",
    );
    api(&f.b).sync().unwrap();
    api(&f.a).sync().unwrap();
    assert_eq!(
        fs::read(f.a.join("text.txt")).unwrap(),
        b"upstream conflict\n2\n3\n4\n5\n6\n7\n8\nLOCAL END\n"
    );
    assert_eq!(records(&f.a, "text.txt")[0].1, local);
    api(&f.a).sync().unwrap();
    f.assert_clean();
}
#[test]
fn offline_checkpoint_with_missing_remote() {
    let f = Fixture::new(&[]);
    let repo = Repository::open(&f.a).unwrap();
    repo.remote_set_url(
        "origin",
        f._dir.path().join("missing.git").to_str().unwrap(),
    )
    .unwrap();
    put(&f.a, "offline.txt", b"offline checkpoint\n");
    let old = head(&f.a);
    let id = api(&f.a).checkpoint().unwrap();
    assert_ne!(head(&f.a), old);
    assert_eq!(head(&f.a).to_string(), id);
    assert!(api(&f.a).status().unwrap().changes.is_empty());
    assert!(!repo.path().join("dox-sync-journal").exists());
    assert_eq!(f.remote_head(), old);
    assert!(api(&f.a).fetch().is_err());
    assert_eq!(
        fs::read(f.a.join("offline.txt")).unwrap(),
        b"offline checkpoint\n"
    );
}
#[test]
fn add_add_uses_complete_upstream() {
    content_conflict(
        None,
        b"local\nshared\nlocal tail\n",
        b"remote\nshared\nremote tail\n",
    );
}
#[test]
fn binary_conflict_preserves_exact_local_bytes() {
    content_conflict(Some(b"\0base\xff"), b"\0local\xff\r\n", b"\0remote\xfe");
}
fn edit_delete(local_edits: bool, whole_note: bool) {
    let path = if whole_note {
        "notes/ABCDE/note.typ"
    } else {
        "text.txt"
    };
    let meta = b"{\"type\":\"typst\",\"document\":\"note.typ\",\"title\":\"Original\"}";
    let mut files: Vec<(&str, &[u8])> = vec![(path, b"base\n")];
    if whole_note {
        files.extend([
            ("notes/ABCDE/meta.json", meta.as_slice()),
            (
                "notes/ABCDE/attachments/image.bin",
                b"\0attachment".as_slice(),
            ),
        ]);
    }
    let f = Fixture::new(&files);
    let (edited, deleted) = if local_edits {
        (&f.a, &f.b)
    } else {
        (&f.b, &f.a)
    };
    put(edited, path, b"edited exact\r\n");
    if whole_note {
        fs::remove_dir_all(deleted.join("notes/ABCDE")).unwrap();
    } else {
        fs::remove_file(deleted.join(path)).unwrap();
    }
    api(&f.b).sync().unwrap();
    api(&f.a).sync().unwrap();
    assert_eq!(fs::read(f.a.join(path)).unwrap(), b"edited exact\r\n");
    let copies = records(&f.a, path);
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].1, b"edited exact\r\n");
    if whole_note {
        assert_eq!(fs::read(f.a.join("notes/ABCDE/meta.json")).unwrap(), meta);
        assert_eq!(
            fs::read(f.a.join("notes/ABCDE/attachments/image.bin")).unwrap(),
            b"\0attachment"
        );
    }
    f.assert_clean();
}
#[test]
fn local_edit_remote_delete() {
    edit_delete(true, false);
}
#[test]
fn local_delete_remote_edit() {
    edit_delete(false, false);
}
#[test]
fn local_note_edit_remote_whole_note_delete() {
    edit_delete(true, true);
}
#[test]
fn local_whole_note_delete_remote_edit() {
    edit_delete(false, true);
}
#[test]
fn stale_push_rejected_and_sync_fetched_recovers_race() {
    let f = Fixture::new(&[("local.txt", b"base local"), ("remote.txt", b"base remote")]);
    put(&f.a, "local.txt", b"local");
    api(&f.a).checkpoint().unwrap();
    api(&f.a).fetch().unwrap();
    let stale = api(&f.a).reconcile_fetched().unwrap();
    put(&f.b, "remote.txt", b"remote");
    api(&f.b).sync().unwrap();
    let remote_before = f.remote_head();
    let error = api(&f.a).push_commit(&stale).unwrap_err();
    assert!(GitRepository::is_push_race(&error), "{error:#}");
    assert_eq!(f.remote_head(), remote_before);
    // Still has stale fetched ref: the first push in sync_fetched must retry.
    api(&f.a).sync_fetched().unwrap();
    assert_eq!(fs::read(f.a.join("local.txt")).unwrap(), b"local");
    assert_eq!(fs::read(f.a.join("remote.txt")).unwrap(), b"remote");
    f.assert_clean();
}
#[test]
fn external_staging_is_preserved() {
    let f = Fixture::new(&[]);
    put(&f.a, "seed.txt", b"staged\n");
    let repo = Repository::open(&f.a).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("seed.txt")).unwrap();
    index.write().unwrap();
    put(&f.a, "seed.txt", b"unstaged\n");
    let before = fs::read(repo.path().join("index")).unwrap();
    let old = head(&f.a);
    assert!(api(&f.a).checkpoint().is_err());
    assert!(api(&f.a).sync().is_err());
    assert_eq!(fs::read(repo.path().join("index")).unwrap(), before);
    assert_eq!(fs::read(f.a.join("seed.txt")).unwrap(), b"unstaged\n");
    assert_eq!(head(&f.a), old);
    assert_eq!(f.remote_head(), old);
}
#[test]
fn journal_blocks_writes_without_discarding_changes() {
    let f = Fixture::new(&[]);
    put(&f.a, "seed.txt", b"keep me\n");
    let repo = Repository::open(&f.a).unwrap();
    let journal = repo.path().join("dox-sync-journal");
    fs::write(&journal, b"recovery evidence").unwrap();
    let old = head(&f.a);
    let index = fs::read(repo.path().join("index")).unwrap();
    assert!(
        api(&f.a)
            .status()
            .unwrap()
            .blocked
            .unwrap()
            .contains("recovery")
    );
    assert!(api(&f.a).checkpoint().is_err());
    assert!(api(&f.a).sync().is_err());
    assert!(api(&f.a).fetch().is_err());
    assert!(api(&f.a).push().is_err());
    assert_eq!(fs::read(journal).unwrap(), b"recovery evidence");
    assert_eq!(fs::read(repo.path().join("index")).unwrap(), index);
    assert_eq!(fs::read(f.a.join("seed.txt")).unwrap(), b"keep me\n");
    assert_eq!(head(&f.a), old);
    assert_eq!(f.remote_head(), old);
}
