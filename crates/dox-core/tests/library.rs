use dox_core::{Library, valid_id};
use serde_json::json;
use std::{fs, process::Command, sync::mpsc, time::Duration};

fn fixture() -> (tempfile::TempDir, Library) {
    let dir = tempfile::tempdir().unwrap();
    let lib = Library::init(dir.path()).unwrap();
    (dir, lib)
}
fn note(lib: &Library, id: &str, meta: serde_json::Value, source: &str) {
    let dir = lib.root().join(id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("meta.json"), serde_json::to_vec(&meta).unwrap()).unwrap();
    fs::write(dir.join("note.typ"), source).unwrap();
}
fn require_typst() {
    assert!(
        Command::new("typst").arg("--version").output().is_ok(),
        "Integration tests require Typst 0.14+ on PATH"
    );
}
#[test]
fn create_persist_and_conflict() {
    require_typst();
    let (_dir, lib) = fixture();
    let first = lib.create("First thought", vec!["math".into()]).unwrap();
    let id = &first.note.id;
    assert!(valid_id(id));
    assert_eq!(first.note.title, "First thought");
    assert_eq!(first.note.tags, ["math"]);
    let saved = lib
        .save(id, "= Updated\n\n$ x^2 $", &first.note.revision)
        .unwrap();
    assert_ne!(first.note.revision, saved.note.revision);
    fs::write(lib.root().join(id).join("note.typ"), "= External edit").unwrap();
    assert!(
        lib.save(id, "= Overwrite", &saved.note.revision)
            .unwrap_err()
            .to_string()
            .contains("Conflict")
    );
    assert_eq!(lib.read(id).unwrap().source, "= External edit");
    assert!(
        fs::read_to_string(lib.root().join(".gitignore"))
            .unwrap()
            .contains("/.cache/")
    );
}
#[test]
fn compiled_metadata_links_math_and_diagram() {
    require_typst();
    let (_dir, lib) = fixture();
    note(
        &lib,
        "ABC12",
        json!({"type":"typst", "document":"note.typ", "title":"Explicit"}),
        r##"
#metadata((title: "Derived", tags: ("math",), authors: ("Ada",))) <dox>
= Content title
$ integral_0^1 x^2 dif x = 1/3 $
#let target = "dox:XYZ89"
#link(target)[A computed link]
#html.frame[#rect(width: 80pt, height: 30pt)[Diagram]]
"##,
    );
    let doc = lib.read("ABC12").unwrap();
    assert!(doc.note.diagnostic.is_none(), "{:?}", doc.note.diagnostic);
    assert_eq!(doc.note.title, "Explicit");
    assert_eq!(doc.note.tags, ["math"]);
    assert_eq!(doc.note.metadata.fields["authors"], json!(["Ada"]));
    assert_eq!(doc.note.links, ["XYZ89"]);
    let html = lib.render("ABC12").unwrap();
    assert!(html.contains("<math"));
    assert!(html.contains("<svg"));
    assert!(html.contains("dox:XYZ89"));
    let index = lib.index().unwrap();
    assert_eq!(index.notes.len(), 1);
    assert!(lib.root().join(".cache/index.json").exists());
    assert!(lib.root().join(".cache/ABC12/note.html").exists());
}
#[test]
fn broken_typst_remains_editable_and_indexed() {
    require_typst();
    let (_dir, lib) = fixture();
    note(
        &lib,
        "ABC12",
        json!({"type":"typst", "document":"note.typ"}),
        "= Draft\n#link(\"dox:XYZ89\")[Link]\n#not-defined()",
    );
    let doc = lib.read("ABC12").unwrap();
    assert!(doc.note.diagnostic.is_some());
    assert_eq!(doc.note.links, ["XYZ89"]);
    assert!(lib.render("ABC12").is_err());
    assert_eq!(lib.index().unwrap().notes.len(), 1);
}
#[test]
fn unknown_types_and_malformed_notes_do_not_break_library() {
    let (_dir, lib) = fixture();
    note(
        &lib,
        "ABC12",
        json!({"type":"future", "document":"note.typ", "title":"Future"}),
        "opaque content",
    );
    fs::create_dir(lib.root().join("BAD12")).unwrap();
    fs::write(lib.root().join("BAD12/meta.json"), "{}").unwrap();
    let index = lib.index().unwrap();
    assert_eq!(index.notes.len(), 1);
    assert_eq!(index.warnings.len(), 1);
    assert_eq!(lib.read("ABC12").unwrap().source, "opaque content");
    assert!(lib.render("ABC12").is_err());
}
#[test]
fn rejects_path_traversal() {
    let (_dir, lib) = fixture();
    note(
        &lib,
        "ABC12",
        json!({"type":"typst", "document":"../outside.typ"}),
        "",
    );
    assert!(lib.read("ABC12").is_err());
    assert!(lib.read("../hi").is_err());
    assert!(!valid_id("abc12"));
}
#[cfg(unix)]
#[test]
fn rejects_source_symlinks_outside_note() {
    let (_dir, lib) = fixture();
    let outside = tempfile::NamedTempFile::new().unwrap();
    note(
        &lib,
        "ABC12",
        json!({"type":"typst", "document":"escape.typ"}),
        "",
    );
    std::os::unix::fs::symlink(outside.path(), lib.root().join("ABC12/escape.typ")).unwrap();
    assert!(lib.read("ABC12").is_err());
}
#[test]
fn watches_external_edits_and_ignores_cache() {
    let (_dir, lib) = fixture();
    let (tx, rx) = mpsc::channel();
    fs::create_dir(lib.root().join(".cache")).unwrap();
    let _watcher = lib
        .watch(move || {
            let _ = tx.send(());
        })
        .unwrap();
    fs::write(lib.root().join(".cache/test"), "cache").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
    fs::write(lib.root().join("external.typ"), "= External").unwrap();
    rx.recv_timeout(Duration::from_secs(5)).unwrap();
}
