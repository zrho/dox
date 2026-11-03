use dox_core::{Attachment, DeletedNote, Library, LibraryIndex, NoteDocument, PublicationImport};
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager, State};

mod windows;

struct Session {
    library: Library,
    _watcher: Box<dyn notify::Watcher + Send>,
}
type Sessions = Mutex<HashMap<String, Session>>;

fn library(state: &State<'_, Sessions>, window: &tauri::WebviewWindow) -> Result<Library, String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .get(window.label())
        .map(|session| session.library.clone())
        .ok_or_else(|| "Open a library first".into())
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[tauri::command(async)]
fn fuzzy_find(query: String, candidates: Vec<Vec<String>>) -> Vec<dox_core::FuzzyResult> {
    dox_core::fuzzy_find(&query, &candidates)
}
// Embedded compilation and blocking package downloads belong on worker threads,
// including dropping an old compiler when switching libraries.
async fn with_library<T, E>(
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
    action: impl FnOnce(Library) -> Result<T, E> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    let library = library(&state, &window)?;
    tauri::async_runtime::spawn_blocking(move || {
        action(library).map_err(|error| format!("{error:#}"))
    })
    .await
    .map_err(error)?
}
#[tauri::command]
fn web_export_destination_exists(destination: String) -> Result<bool, String> {
    match std::fs::symlink_metadata(destination) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}
#[tauri::command]
async fn export_web(
    destination: String,
    replace: bool,
    progress: tauri::ipc::Channel<dox_core::ExportProgress>,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<dox_core::ExportReport, String> {
    with_library(window, state, move |library| {
        library.export_web(
            dox_core::ExportOptions {
                destination: destination.into(),
                replace,
            },
            |update| {
                let _ = progress.send(update);
            },
        )
    })
    .await
}
#[tauri::command]
async fn open_library(path: String, window: tauri::WebviewWindow) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lib = Library::init(path).map_err(error)?;
        let handle = window.clone();
        let watcher = lib
            .watch(move || {
                let _ = handle.emit_to(handle.label(), "library-changed", ());
            })
            .map_err(error)?;
        let root = lib.root().to_string_lossy().into_owned();
        let state = window.state::<Sessions>();
        let mut sessions = state.lock().map_err(error)?;
        // A library can finish opening after its window has been closed.
        if window
            .app_handle()
            .get_webview_window(window.label())
            .is_none()
        {
            return Err("Window was closed".into());
        }
        let previous = sessions.insert(
            window.label().into(),
            Session {
                _watcher: watcher,
                library: lib,
            },
        );
        drop(sessions);
        drop(previous);
        Ok(root)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
async fn cached_notes(
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<LibraryIndex, String> {
    with_library(window, state, |library| library.cached_index()).await
}
#[tauri::command]
async fn list_notes(
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<LibraryIndex, String> {
    with_library(window, state, |library| library.index()).await
}
#[tauri::command]
async fn read_note(
    id: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<NoteDocument, String> {
    with_library(window, state, move |library| library.read(&id)).await
}
#[tauri::command]
async fn create_note(
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<NoteDocument, String> {
    with_library(window, state, |library| library.create_untitled()).await
}
#[tauri::command]
async fn open_daily_note(
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<NoteDocument, String> {
    with_library(window, state, |library| library.open_daily_note()).await
}
#[tauri::command]
async fn create_literature(
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<NoteDocument, String> {
    with_library(window, state, |library| library.create_literature()).await
}
#[tauri::command]
async fn import_publication(
    input: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<PublicationImport, String> {
    with_library(window, state, move |library| {
        library.import_publication(&input)
    })
    .await
}
#[tauri::command]
async fn find_paper_pdf(
    id: String,
    source: Option<String>,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<Attachment, String> {
    with_library(window, state, move |library| {
        library.find_paper_pdf(&id, source.as_deref())
    })
    .await
}
#[tauri::command]
async fn save_note(
    id: String,
    source: String,
    revision: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<NoteDocument, String> {
    with_library(window, state, move |library| {
        library.save(&id, &source, &revision)
    })
    .await
}
#[tauri::command]
async fn delete_note(
    id: String,
    revision: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<DeletedNote, String> {
    with_library(window, state, move |library| library.delete(&id, &revision)).await
}
#[tauri::command]
async fn restore_note(
    trash_entry: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<NoteDocument, String> {
    with_library(window, state, move |library| library.restore(&trash_entry)).await
}
#[tauri::command]
async fn render_note(
    id: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<String, String> {
    with_library(window, state, move |library| library.render(&id)).await
}
#[tauri::command]
async fn list_attachments(
    id: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<Vec<Attachment>, String> {
    with_library(window, state, move |library| library.attachments(&id)).await
}
#[tauri::command]
async fn attach_files(
    id: String,
    paths: Vec<String>,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<(), String> {
    with_library(window, state, move |library| {
        for path in paths {
            library
                .attach_file(&id, &path)
                .map_err(|error| format!("Could not attach {path}: {error:#}"))?;
        }
        Ok::<_, String>(())
    })
    .await
}
#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only web links can be opened".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(error)
}
#[tauri::command]
async fn open_attachment(
    id: String,
    name: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<(), String> {
    with_library(window, state, move |library| {
        let path = library.attachment_path(&id, &name).map_err(error)?;
        tauri_plugin_opener::open_path(path, None::<&str>).map_err(error)
    })
    .await
}
#[tauri::command]
async fn remove_attachment(
    id: String,
    name: String,
    window: tauri::WebviewWindow,
    state: State<'_, Sessions>,
) -> Result<(), String> {
    with_library(window, state, move |library| {
        library.remove_attachment(&id, &name)
    })
    .await
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_macos_fps::init())
        .manage(Sessions::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            windows::setup_menu(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            windows::new_window,
            fuzzy_find,
            export_web,
            web_export_destination_exists,
            open_library,
            list_notes,
            cached_notes,
            read_note,
            create_note,
            open_daily_note,
            create_literature,
            import_publication,
            find_paper_pdf,
            save_note,
            render_note,
            list_attachments,
            attach_files,
            open_external,
            open_attachment,
            remove_attachment,
            delete_note,
            restore_note
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start dox")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
            {
                let session = app.state::<Sessions>().lock().unwrap().remove(label);
                // Dropping an embedded compiler can block too.
                tauri::async_runtime::spawn_blocking(move || drop(session));
            }
            windows::handle_event(app, event);
        });
}
