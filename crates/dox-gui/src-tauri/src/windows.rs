use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindowBuilder};

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

#[derive(Default)]
pub struct ReadyWindows(Mutex<HashSet<String>>);

#[tauri::command]
pub async fn set_window_theme(
    window: tauri::WebviewWindow,
    preference: Option<tauri::Theme>,
    dark: bool,
) -> Result<(), String> {
    // Keep automatic mode tied to the OS rather than pinning its current theme.
    window
        .set_theme(preference)
        .map_err(|error| error.to_string())?;
    let background = if dark {
        tauri::utils::config::Color(30, 30, 46, 255)
    } else {
        tauri::utils::config::Color(248, 249, 250, 255)
    };
    window
        .set_background_color(Some(background))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn window_ready(
    window: tauri::WebviewWindow,
    ready: tauri::State<'_, ReadyWindows>,
) -> Result<(), String> {
    // The frontend calls this after rendering and synchronizing its theme.
    window.show().map_err(|error| error.to_string())?;
    ready.0.lock().unwrap().insert(window.label().to_owned());
    window.set_focus().map_err(|error| error.to_string())
}

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    // Reuse the initial window's appearance and security configuration.
    let mut config = app.config().app.windows[0].clone();
    config.label = format!("main-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

#[tauri::command]
pub async fn new_window(app: AppHandle) -> Result<(), String> {
    create_window(&app).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub fn setup_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use std::collections::HashMap;
    use tauri::menu::{Menu, MenuItem};

    #[derive(serde::Deserialize)]
    struct Command {
        title: String,
        binding: Option<Binding>,
    }
    #[derive(serde::Deserialize)]
    struct Binding {
        key: String,
        #[serde(default)]
        shift: bool,
    }

    // The native menu and command picker share one command registry. A native
    // accelerator remains available even when no webviews are open.
    let mut commands: HashMap<String, Command> =
        serde_json::from_str(include_str!("../../src/utils/commands.json"))?;
    let command = commands
        .remove("new-window")
        .ok_or("Missing new-window command")?;
    let binding = command.binding.ok_or("Missing new-window binding")?;
    let accelerator = format!(
        "CmdOrCtrl+{}{}",
        if binding.shift { "Shift+" } else { "" },
        binding.key.to_uppercase()
    );
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            if submenu.text()? == "File" {
                submenu.prepend(&MenuItem::with_id(
                    app,
                    "new-window",
                    command.title,
                    true,
                    Some(accelerator),
                )?)?;
                break;
            }
        }
    }
    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_event(app: &AppHandle, event: RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        RunEvent::ExitRequested {
            code: None, api, ..
        } if app.webview_windows().is_empty() => api.prevent_exit(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let windows = app.webview_windows();
            let ready_window = {
                let ready = app.state::<ReadyWindows>();
                let ready = ready.0.lock().unwrap();
                windows.values().find(|window| ready.contains(window.label())).cloned()
            };
            if let Some(window) = ready_window {
                // A minimized or hidden window still exists; reveal it.
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            } else if windows.is_empty() {
                if let Err(error) = create_window(app) {
                    eprintln!("Unable to reopen Dox: {error}");
                }
            }
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            app.state::<ReadyWindows>().0.lock().unwrap().remove(&label);
        }
        #[cfg(target_os = "macos")]
        RunEvent::MenuEvent(event) if event.id().as_ref() == "new-window" => {
            if let Err(error) = create_window(app) {
                eprintln!("Unable to create a Dox window: {error}");
            }
        }
        _ => {
            let _ = app;
        }
    }
}
