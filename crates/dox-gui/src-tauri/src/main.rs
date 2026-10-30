use dox_core::{DeletedNote, Library, LibraryIndex, NoteDocument};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[derive(Default)]
struct Session {
    library: Option<Library>,
    watcher: Option<Box<dyn notify::Watcher + Send>>,
}
fn library(state: &State<'_, Mutex<Session>>) -> Result<Library, String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .library
        .clone()
        .ok_or_else(|| "Open a library first".into())
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[tauri::command(async)]
fn fuzzy_find(query: String, candidates: Vec<Vec<String>>) -> Vec<dox_core::FuzzyResult> {
    dox_core::fuzzy_find(&query, &candidates)
}
#[tauri::command(async)]
fn open_library(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, Mutex<Session>>,
) -> Result<String, String> {
    let lib = Library::init(path).map_err(error)?;
    let handle = app.clone();
    let watcher = lib
        .watch(move || {
            let _ = handle.emit("library-changed", ());
        })
        .map_err(error)?;
    let root = lib.root().to_string_lossy().into_owned();
    let mut session = state.lock().map_err(error)?;
    session.watcher = Some(watcher);
    session.library = Some(lib);
    Ok(root)
}
#[tauri::command(async)]
fn cached_notes(state: State<'_, Mutex<Session>>) -> Result<LibraryIndex, String> {
    library(&state)?.cached_index().map_err(error)
}
#[tauri::command(async)]
fn list_notes(state: State<'_, Mutex<Session>>) -> Result<LibraryIndex, String> {
    library(&state)?.index().map_err(error)
}
#[tauri::command(async)]
fn read_note(id: String, state: State<'_, Mutex<Session>>) -> Result<NoteDocument, String> {
    library(&state)?.read(&id).map_err(error)
}
#[tauri::command(async)]
fn create_note(state: State<'_, Mutex<Session>>) -> Result<NoteDocument, String> {
    library(&state)?.create_untitled().map_err(error)
}
#[tauri::command(async)]
fn create_literature(state: State<'_, Mutex<Session>>) -> Result<NoteDocument, String> {
    library(&state)?.create_literature().map_err(error)
}
#[tauri::command]
async fn import_publication(
    input: String,
    state: State<'_, Mutex<Session>>,
) -> Result<NoteDocument, String> {
    let library = library(&state)?;
    tauri::async_runtime::spawn_blocking(move || library.import_publication(&input))
        .await
        .map_err(error)?
        .map_err(|error| format!("{error:#}"))
}
#[tauri::command(async)]
fn save_note(
    id: String,
    source: String,
    revision: String,
    state: State<'_, Mutex<Session>>,
) -> Result<NoteDocument, String> {
    library(&state)?
        .save(&id, &source, &revision)
        .map_err(error)
}
#[tauri::command(async)]
fn set_note_pinned(
    id: String,
    pinned: bool,
    revision: String,
    state: State<'_, Mutex<Session>>,
) -> Result<NoteDocument, String> {
    library(&state)?
        .set_pinned(&id, pinned, &revision)
        .map_err(error)
}
#[tauri::command(async)]
fn delete_note(
    id: String,
    revision: String,
    state: State<'_, Mutex<Session>>,
) -> Result<DeletedNote, String> {
    library(&state)?.delete(&id, &revision).map_err(error)
}
#[tauri::command(async)]
fn restore_note(
    trash_entry: String,
    state: State<'_, Mutex<Session>>,
) -> Result<NoteDocument, String> {
    library(&state)?.restore(&trash_entry).map_err(error)
}
#[tauri::command(async)]
fn render_note(id: String, state: State<'_, Mutex<Session>>) -> Result<String, String> {
    library(&state)?.render(&id).map_err(error)
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Session::default()))
        .setup(|app| {
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fuzzy_find,
            open_library,
            list_notes,
            cached_notes,
            read_note,
            create_note,
            create_literature,
            import_publication,
            save_note,
            set_note_pinned,
            render_note,
            delete_note,
            restore_note
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start dox");
}
