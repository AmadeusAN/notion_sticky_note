mod autostart;
mod database;
mod edge_dock;
mod exit;
mod language;
mod fx_runtime;
mod fx_window;
mod models;
mod monitors;
mod notion;
mod preferences;
mod sync;
mod window;
mod window_state;

use database::{database_work, Database};
use edge_dock::{DockSnapshot, EdgeDock};
use fx_runtime::{FxRuntime, FxSnapshot};
use window_state::{DockEdge, DockPhase, WindowRestore, WindowStateV2};
use models::{AppearanceSaveState, AppearanceSettings, ExitSaveState, ExitSaveStatus, Group, NotionConfig, SaveNotionConfigResult, SettingsSnapshot, Task, TaskImportResult, TaskView};
use notion::NotionClient;
use std::path::PathBuf;
use std::sync::Arc;
use sync::{SyncEngine, SyncState};
use exit::ExitCoordinator;
use preferences::PreferencesWriter;
use language::{LanguageManager, LanguageState};
use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent,
};

pub struct AppState {
    pub db: Arc<Database>,
    pub sync: Arc<SyncEngine>,
    pub edge_dock: Arc<EdgeDock>,
    pub preferences: Arc<PreferencesWriter>,
    pub fx: FxRuntime,
    pub exit: ExitCoordinator,
    pub language: Arc<LanguageManager>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("sticky-note.db"))
}

#[tauri::command]
async fn get_language_state(state: State<'_, AppState>) -> Result<LanguageState, String> {
    let language = state.language.clone();
    tauri::async_runtime::spawn_blocking(move || language.snapshot()).await
        .map_err(|_| language::text("Language preference could not be read.", "未能读取语言偏好。").to_string())?
}

#[tauri::command]
async fn set_language(
    preference: String,
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LanguageState, String> {
    if window.label() != "main" {
        return Err(language::text("Only the main note can change language.", "仅主便签可以修改语言。").into());
    }
    let language = state.language.clone();
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let tray = app.tray_by_id("main-tray").ok_or_else(||
            language::text("The tray menu is unavailable; language was not changed.", "托盘菜单不可用，未修改语言。").to_string())?;
        language.change(&db, &preference, |next| {
            tray.set_menu(Some(tray_menu(&app, next.effective)?)).map_err(|_|
                language::text("Unable to update the tray menu.", "无法更新托盘菜单。").to_string())
        }, |previous| {
            tray.set_menu(Some(tray_menu(&app, previous.effective)?)).map_err(|_|
                language::text("Unable to restore the tray menu.", "无法恢复托盘菜单。").to_string())
        })
    }).await.map_err(|_| language::text("Language update could not finish.", "语言更新未能完成。").to_string())?
}

#[tauri::command]
async fn get_task_view(state: State<'_, AppState>) -> Result<TaskView, String> {
    database_work(state.db.clone(), Database::task_view).await
}

#[tauri::command]
async fn create_group(name: String, state: State<'_, AppState>) -> Result<Group, String> {
    database_work(state.db.clone(), move |db| db.create_group(&name)).await
}

#[tauri::command]
async fn delete_group(id: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    database_work(state.db.clone(), move |db| db.delete_group(&id)).await
}


#[tauri::command]
async fn import_tasks(
    titles: Vec<String>,
    group_id: Option<String>,
    new_group_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskImportResult, String> {
    database_work(state.db.clone(), move |db|
        db.import_local_tasks(titles, group_id.as_deref(), new_group_name.as_deref())).await
}

#[tauri::command]
async fn delete_task(id: String, state: State<'_, AppState>) -> Result<(), String> {
    database_work(state.db.clone(), move |db| db.delete_local_task(&id)).await
}

#[tauri::command]
async fn clear_archive(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    database_work(state.db.clone(), Database::clear_archive).await
}

#[tauri::command]
async fn toggle_task(id: String, state: State<'_, AppState>) -> Result<Task, String> {
    let task = database_work(state.db.clone(), move |db| db.toggle_task(&id)).await?;
    if task.notion_id.is_some() { state.sync.wake_pending(); }
    Ok(task)
}

#[tauri::command]
async fn get_settings(window: WebviewWindow, state: State<'_, AppState>) -> Result<SettingsSnapshot, String> {
    if window.label() != "main" { return Err(crate::language::text("Only the main note can read complete settings.", "完整设置仅供主便签读取").into()); }
    state.preferences.settings_snapshot().await
}

#[tauri::command]
async fn save_notion_config(
    config: NotionConfig,
    discard_pending: Option<bool>,
    expected_pending_version: Option<u64>,
    state: State<'_, AppState>,
) -> Result<SaveNotionConfigResult, String> {
    let result = database_work(state.db.clone(), move |db|
        db.save_notion_config(&config, discard_pending.unwrap_or(false), expected_pending_version)).await?;
    if matches!(result, SaveNotionConfigResult::Saved) { state.sync.configuration_changed(); }
    Ok(result)
}

#[tauri::command]
fn update_appearance(
    appearance: AppearanceSettings,
    client_revision: u64,
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppearanceSaveState, String> {
    if window.label() != "main" { return Err(crate::language::text("Only the main note can update appearance settings.", "仅主便签可以更新外观设置").into()); }
    let save = state.preferences.update_appearance(appearance, client_revision)?;
    if save.revision == client_revision {
        fx_window::preferences_changed(&app);
    }
    Ok(save)
}

#[tauri::command]
fn get_fx_snapshot(state: State<'_, AppState>) -> FxSnapshot {
    state.fx.snapshot()
}

#[tauri::command]
fn set_fx_enabled(enabled: bool, window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    if window.label() != "fx" { return Err(crate::language::text("Only the effects window can update presentation policy.", "仅特效窗可以更新呈现策略").into()); }
    fx_window::set_enabled(&app, enabled);
    Ok(())
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ExitAction { Retry, Cancel, Discard }

#[tauri::command]
fn get_exit_state(state: State<'_, AppState>) -> Result<ExitSaveState, String> {
    state.exit.snapshot()
}

#[tauri::command]
async fn request_exit(action: Option<ExitAction>, window: WebviewWindow, app: AppHandle) -> Result<ExitSaveState, String> {
    if window.label() != "main" { return Err(crate::language::text("Only the main note can request exit.", "仅主便签可以请求退出").into()); }
    request_exit_internal(app, action.unwrap_or(ExitAction::Retry)).await
}

fn emit_exit_state(app: &AppHandle, state: &ExitSaveState) {
    let _ = app.emit_to("main", "exit-save-state", state);
}

fn finish_exit_on_ui(app: &AppHandle, revision: u64) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let state = handle.state::<AppState>();
        let current = match state.exit.snapshot() {
            Ok(current) => current,
            Err(error) => { eprintln!("Exit state unavailable: {error}"); return; }
        };
        if current.revision != revision || current.status != ExitSaveStatus::Idle { return; }
        state.preferences.stop();
        state.sync.stop();
        handle.exit(0);
    }).map_err(|error| error.to_string())
}

async fn capture_before_exit(app: &AppHandle) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = match handle.get_webview_window("main") {
            Some(window) => {
                let state = handle.state::<AppState>();
                state.edge_dock.capture_valid_geometry(&handle, &window)
            }
            None => Ok(()),
        };
        let _ = send.send(result);
    }).map_err(|error| error.to_string())?;
    receive.await.map_err(|_| crate::language::text("Unable to confirm the final window position.", "无法确认最后的窗口位置").to_string())?
}

async fn request_exit_internal(app: AppHandle, action: ExitAction) -> Result<ExitSaveState, String> {
    if matches!(action, ExitAction::Cancel | ExitAction::Discard) {
        let state = app.state::<AppState>().exit.cancel()?;
        emit_exit_state(&app, &state);
        if matches!(action, ExitAction::Discard) { finish_exit_on_ui(&app, state.revision)?; }
        return Ok(state);
    }
    let Some(started) = app.state::<AppState>().exit.begin()? else {
        return app.state::<AppState>().exit.snapshot();
    };
    emit_exit_state(&app, &started);
    let capture = capture_before_exit(&app).await;
    let preferences = app.state::<AppState>().preferences.clone();
    let flushed = preferences.flush().await;
    let result = capture.and(flushed);
    let Some(finished) = app.state::<AppState>().exit.finish(started.revision, result)? else {
        return app.state::<AppState>().exit.snapshot();
    };
    emit_exit_state(&app, &finished);
    if finished.status == ExitSaveStatus::Idle {
        finish_exit_on_ui(&app, finished.revision)?;
    } else {
        let handle = app.clone();
        let revision = finished.revision;
        app.run_on_main_thread(move || {
            let current = handle.state::<AppState>().exit.snapshot();
            if !current.is_ok_and(|state| state.revision == revision && state.status == ExitSaveStatus::Error) { return; }
            if let Err(error) = show_main(&handle) { eprintln!("Unable to show save failure: {error}"); }
        }).map_err(|error| error.to_string())?;
    }
    Ok(finished)
}

#[tauri::command]
async fn force_sync(state: State<'_, AppState>) -> Result<SyncState, String> {
    Ok(state.sync.force_sync().await)
}

#[tauri::command]
fn get_sync_state(state: State<'_, AppState>) -> SyncState {
    state.sync.get_state()
}

#[tauri::command]
async fn test_notion_connection(config: NotionConfig, state: State<'_, AppState>) -> Result<String, String> {
    state.sync.client().test_connection(&config).await.map_err(|error| error.to_string())
}

#[tauri::command]
fn get_edge_dock(state: State<'_, AppState>) -> DockSnapshot {
    state.edge_dock.snapshot()
}

#[tauri::command]
fn pulse_fx_ambient(app: AppHandle, edge: String, phase: String, revision: u64) -> Result<(), String> {
    let dock_edge = match edge.as_str() {
        "left" => DockEdge::Left,
        "right" => DockEdge::Right,
        "top" => DockEdge::Top,
        "bottom" => DockEdge::Bottom,
        _ => return Err(format!("{}: {edge}", language::text("Invalid edge", "贴边方向无效"))),
    };
    let dock_phase = match phase.as_str() {
        "collapsed" => DockPhase::Collapsed,
        "expanded" => DockPhase::Expanded,
        _ => return Err(language::text("Invalid ambient phase.", "环境特效状态无效。").into()),
    };
    let current = app.state::<AppState>().edge_dock.snapshot();
    if current.revision != revision || !current.presented
        || current.edge != Some(dock_edge) || current.phase != dock_phase
    {
        return Ok(());
    }
    fx_window::pulse_fx_ambient(&app, dock_edge, phase);
    Ok(())
}

fn hide_main_window(app: &AppHandle) -> Result<(), String> {
    let win = window::main_window(app)?;
    let state = app.state::<AppState>();
    if let Err(error) = state.edge_dock.capture_valid_geometry(app, &win) {
        eprintln!("Unable to capture window before hiding: {error}");
    }
    state.edge_dock.suspend(app);
    fx_window::hide_fx(app);
    if let Err(error) = win.hide() {
        if let Err(restore_error) = state.edge_dock.reveal(app, &win) {
            return Err(format!("{error}; {}: {restore_error}", language::text("Window restore failed", "恢复窗口失败")));
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn hide_main(app: AppHandle) -> Result<(), String> {
    hide_main_window(&app)
}

fn show_main(app: &AppHandle) -> Result<(), String> {
    let win = window::main_window(app)?;
    let state = app.state::<AppState>();
    state.edge_dock.reveal(app, &win)?;
    win.set_focus().map_err(|error| error.to_string())
}


fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = tray_menu(app, app.state::<AppState>().language.snapshot()?.effective)?;

    let icon = tauri::include_image!("icons/tray.png");

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(app.config().product_name.as_deref().unwrap_or("Sticky Note"))
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "show" => show_main(app),
                "hide" => hide_main_window(app),
                "quit" => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = request_exit_internal(handle, ExitAction::Retry).await {
                            eprintln!("Exit request failed: {error}");
                        }
                    });
                    Ok(())
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("Tray window action failed: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let shown = app.get_webview_window("main")
                    .map(|win| fx_window::main_is_presentable(app, &win)
                        && !app.state::<AppState>().edge_dock.is_collapsed())
                    .unwrap_or(false);
                let result = if shown { hide_main_window(app) } else { show_main(app) };
                if let Err(error) = result {
                    eprintln!("Tray toggle failed: {error}");
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn tray_menu(app: &AppHandle, effective: language::EffectiveLanguage) -> Result<Menu<tauri::Wry>, String> {
    let [show, hide, quit] = language::labels(effective);
    let make = || -> tauri::Result<Menu<tauri::Wry>> {
        let show = MenuItem::with_id(app, "show", show, true, None::<&str>)?;
        let hide = MenuItem::with_id(app, "hide", hide, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
        Menu::with_items(app, &[&show, &hide, &quit])
    };
    make().map_err(|_| language::text("Unable to create the tray menu.", "无法创建托盘菜单。").into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    language::initialize_system_language();
    tauri::Builder::default()
        .setup(|app| {
            let path = db_path(app.handle())?;
            let db = Arc::new(Database::open(path)?);
            let language = Arc::new(LanguageManager::load(&db)?);
            if let Err(error) = autostart::reconcile_installed_path() {
                eprintln!("{error}");
            }
            db.seed_mocks_if_empty()?;
            let settings = db.load_settings()?;
            let win = window::main_window(app.handle())?;
            let position = win.outer_position()?;
            let size = win.outer_size()?;
            let scale = win.scale_factor()?;
            let fallback = WindowStateV2 {
                version: 2, phase: DockPhase::Free, edge: None,
                restore: WindowRestore {
                    x: position.x, y: position.y,
                    width: f64::from(size.width) / scale,
                    height: f64::from(size.height) / scale,
                    monitor_id: win.current_monitor()?.and_then(|monitor| monitor.name().cloned()),
                    saved_scale: scale,
                },
            };
            let monitors = monitors::enumerate(&win)?;
            let saved_window = db.load_or_migrate_window_state(&monitors, &fallback)?;
            let preferences = PreferencesWriter::new(
                db.clone(), AppearanceSettings::from_settings(&settings), Some(saved_window.clone()),
            );
            let preferences_app = app.handle().clone();
            preferences.clone().start(move |save| {
                let _ = preferences_app.emit_to("main", "appearance-save-state", save);
            });
            let sync = Arc::new(SyncEngine::new(db.clone(), NotionClient::new()?));
            let sync_app = app.handle().clone();
            sync.clone().start(move |state| {
                let _ = sync_app.emit_to("main", "sync-state-changed", state);
            });
            let edge_dock = EdgeDock::new();
            edge_dock.load(saved_window)?;
            let fx = FxRuntime::new(preferences.fx_preferences(), edge_dock.snapshot(), edge_dock.generation());
            app.manage(AppState {
                db: db.clone(),
                sync,
                edge_dock: edge_dock.clone(),
                preferences: preferences.clone(),
                fx,
                exit: ExitCoordinator::default(),
                language,
            });

            let _ = window::apply_always_on_top(&win);
            let _ = window::disable_system_snap_assist(&win);
            edge_dock.restore_on_startup(app.handle(), &win)?;
            edge_dock.spawn_cursor_poller(app.handle().clone());
            let win_clone = win.clone();
            let dock_for_events = edge_dock.clone();
            let app_handle = app.handle().clone();
            win.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Err(error) = hide_main_window(&app_handle) {
                        eprintln!("Close-to-tray failed: {error}");
                    }
                }
                WindowEvent::Moved(_) => dock_for_events.on_user_moved(&app_handle),
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    match win_clone.is_minimized() {
                        Ok(true) => {
                            dock_for_events.suspend(&app_handle);
                            fx_window::hide_fx(&app_handle);
                        }
                        Ok(false) if dock_for_events.is_suspended() => {
                            if win_clone.is_visible().unwrap_or(false) {
                                if let Err(error) = dock_for_events.reveal(&app_handle, &win_clone) {
                                    eprintln!("Window restore failed: {error}");
                                }
                            }
                        }
                        Ok(false) => {
                            if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
                                dock_for_events.on_scale_changed(&app_handle);
                                window::refresh_transparent_surface_force(&win_clone);
                            } else {
                                dock_for_events.on_user_resized(&app_handle);
                            }
                        }
                        Err(error) => eprintln!("Unable to inspect window presentation: {error}"),
                    }
                }
                WindowEvent::Focused(true) => {
                    if dock_for_events.is_suspended()
                        && win_clone.is_visible().unwrap_or(false)
                        && !win_clone.is_minimized().unwrap_or(true)
                    {
                        if let Err(error) = dock_for_events.reveal(&app_handle, &win_clone) {
                            eprintln!("Window activation restore failed: {error}");
                        }
                    } else if win_clone.is_visible().unwrap_or(false)
                        && !win_clone.is_minimized().unwrap_or(true)
                    {
                        window::refresh_transparent_surface(&win_clone);
                    }
                    fx_window::raise_fx_if_visible(&app_handle);
                }
                WindowEvent::Destroyed => {
                    dock_for_events.suspend(&app_handle);
                    fx_window::hide_fx(&app_handle);
                }
                _ => {}
            });

            if let Err(e) = fx_window::create_fx_window(app.handle()) {
                eprintln!("fx window create failed: {e}");
            }

            setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            autostart::get_autostart_enabled,
            autostart::set_autostart_enabled,
            get_language_state,
            set_language,
            hide_main,
            get_task_view,
            create_group,
            delete_group,
            import_tasks,
            delete_task,
            clear_archive,
            toggle_task,
            get_settings,
            save_notion_config,
            update_appearance,
            get_fx_snapshot,
            set_fx_enabled,
            get_exit_state,
            request_exit,
            force_sync,
            get_sync_state,
            test_notion_connection,
            get_edge_dock,
            pulse_fx_ambient
        ])
        .run(tauri::generate_context!())
        .expect("error while running sticky note");
}
