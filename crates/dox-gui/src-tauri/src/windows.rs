use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindowBuilder};

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

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
            if let Some(window) = app.webview_windows().into_values().next() {
                // A minimized or hidden window still exists; reveal it.
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            } else if let Err(error) = create_window(app) {
                eprintln!("Unable to reopen Dox: {error}");
            }
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
