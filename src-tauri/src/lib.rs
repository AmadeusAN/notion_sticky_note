mod database;
mod edge_dock;
mod fx_window;
mod models;
mod notion;
mod sync;
mod window;

use database::Database;
use edge_dock::{DockEdge, DockPhase, DockSnapshot, EdgeDock};
use models::{AppSettings, NotionConfig, Task};
use notion::NotionClient;
use std::path::PathBuf;
use std::sync::Arc;
use sync::SyncEngine;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewWindow, WindowEvent,
};

pub struct AppState {
    pub db: Arc<Database>,
    pub sync: Arc<SyncEngine>,
    pub edge_dock: Arc<EdgeDock>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("sticky-note.db"))
}

#[tauri::command]
fn get_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    state.db.list_tasks()
}

#[tauri::command]
async fn toggle_task(id: String, state: State<'_, AppState>) -> Result<Task, String> {
    let mut task = state
        .db
        .get_task(&id)?
        .ok_or_else(|| "Task not found".to_string())?;
    task.completed = !task.completed;
    task.updated_time = chrono::Utc::now().timestamp_millis();
    state.db.upsert_task(&task)?;

    let settings = state.db.load_settings()?;
    if let Some(page_id) = task.notion_id.clone() {
        if !settings.notion.token.is_empty() {
            let client = NotionClient::new();
            match client
                .set_done(&settings.notion, &page_id, task.completed)
                .await
            {
                Ok(()) => {}
                Err(e) => {
                    state.db.enqueue_pending(&task.id, task.completed)?;
                    let _ = state.db.log_sync(&format!("toggle queued: {e}"));
                }
            }
        }
    }

    Ok(task)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.db.load_settings()
}

#[tauri::command]
fn save_notion_config(
    config: NotionConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.db.save_notion_config(&config)
}

#[tauri::command]
fn set_theme(theme: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_theme(&theme)?;
    if let Ok(win) = window::main_window(&app) {
        let _ = window::apply_theme_effects(&win, &theme);
    }
    Ok(())
}

#[tauri::command]
fn set_light_theme(theme: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_light_theme(&theme)
}

#[tauri::command]
fn set_dark_theme(theme: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_dark_theme(&theme)
}

#[tauri::command]
fn set_font(font: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_font(&font)
}

#[tauri::command]
async fn force_sync(state: State<'_, AppState>) -> Result<String, String> {
    state.sync.sync_once().await
}

#[tauri::command]
async fn test_notion_connection(config: NotionConfig) -> Result<String, String> {
    let client = NotionClient::new();
    client.test_connection(&config).await
}

#[tauri::command]
fn get_edge_dock(state: State<'_, AppState>) -> DockSnapshot {
    state.edge_dock.snapshot()
}

#[tauri::command]
fn pulse_fx_ambient(app: AppHandle, edge: String, phase: String) -> Result<(), String> {
    let dock_edge = match edge.as_str() {
        "left" => DockEdge::Left,
        "right" => DockEdge::Right,
        "top" => DockEdge::Top,
        "bottom" => DockEdge::Bottom,
        _ => return Err(format!("invalid edge: {edge}")),
    };
    fx_window::pulse_fx_ambient(&app, dock_edge, &phase);
    Ok(())
}

fn restore_window_geometry(win: &WebviewWindow, db: &Database) {
    if let Ok(Some(raw)) = db.get_setting("window_geometry") {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            let x = value.get("x").and_then(|v| v.as_i64()).unwrap_or(100) as i32;
            let y = value.get("y").and_then(|v| v.as_i64()).unwrap_or(100) as i32;
            let w = value.get("width").and_then(|v| v.as_f64()).unwrap_or(320.0);
            let h = value.get("height").and_then(|v| v.as_f64()).unwrap_or(500.0);
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: w.max(100.0),
                height: h.max(100.0),
            }));
        }
    }
}

fn save_window_geometry(win: &WebviewWindow, db: &Database, edge_dock: &EdgeDock) {
    // Don't persist collapsed off-screen geometry as the normal layout
    if matches!(edge_dock.snapshot().phase, DockPhase::Collapsed) {
        return;
    }
    let Ok(pos) = win.outer_position() else {
        return;
    };
    let Ok(size) = win.outer_size() else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let payload = serde_json::json!({
        "x": pos.x,
        "y": pos.y,
        "width": (size.width as f64) / scale,
        "height": (size.height as f64) / scale,
    });
    let _ = db.set_setting("window_geometry", &payload.to_string());
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "显示便签", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏便签", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("missing default window icon")?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Sticky Note")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let path = db_path(app.handle())?;
            let db = Arc::new(Database::open(path)?);
            db.seed_mocks_if_empty()?;
            let sync = Arc::new(SyncEngine::new(db.clone()));
            let sync_clone = sync.clone();
            tauri::async_runtime::spawn(async move {
                sync_clone.spawn_polling().await;
            });

            let edge_dock = EdgeDock::new();
            if let Ok(Some(raw)) = db.get_setting("edge_dock") {
                if let Ok(snap) = serde_json::from_str::<DockSnapshot>(&raw) {
                    edge_dock.load(snap);
                }
            }

            app.manage(AppState {
                db: db.clone(),
                sync,
                edge_dock: edge_dock.clone(),
            });

            if let Some(win) = app.get_webview_window("main") {
                let _ = window::apply_always_on_top(&win);
                let _ = window::disable_system_snap_assist(&win);
                let theme = app
                    .state::<AppState>()
                    .db
                    .load_settings()
                    .map(|s| s.theme)
                    .unwrap_or_else(|_| "paper".into());
                let _ = window::apply_theme_effects(&win, &theme);
                restore_window_geometry(&win, &db);
                window::remember_size(&win);
                edge_dock.restore_on_startup(app.handle(), &win);
                edge_dock.spawn_cursor_poller(app.handle().clone());

                let win_clone = win.clone();
                let db_for_geo = db.clone();
                let dock_for_events = edge_dock.clone();
                let app_handle = app.handle().clone();
                win.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        save_window_geometry(&win_clone, &db_for_geo, &dock_for_events);
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                    WindowEvent::Moved(_) => {
                        save_window_geometry(&win_clone, &db_for_geo, &dock_for_events);
                        dock_for_events.on_user_moved(app_handle.clone());
                    }
                    WindowEvent::Resized(_) => {
                        // Undo Win11 Aero Snap half/maximize resizes; remember only intentional sizes
                        window::undo_system_snap_resize_if_needed(&win_clone);
                        save_window_geometry(&win_clone, &db_for_geo, &dock_for_events);
                    }
                    WindowEvent::Focused(true) => {
                        // Main activation can bury the FX topmost sibling — lift it back.
                        fx_window::raise_fx_if_visible(&app_handle);
                    }
                    _ => {}
                });
            }

            if let Err(e) = fx_window::create_fx_window(app.handle()) {
                eprintln!("fx window create failed: {e}");
            }

            setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            toggle_task,
            get_settings,
            save_notion_config,
            set_theme,
            set_light_theme,
            set_dark_theme,
            set_font,
            force_sync,
            test_notion_connection,
            get_edge_dock,
            pulse_fx_ambient
        ])
        .run(tauri::generate_context!())
        .expect("error while running sticky note");
}
