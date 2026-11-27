//! Native FX layout and delivery; the token-free runtime owns bootstrap state.
use crate::fx_runtime::{FxActionPayload, FxAmbientPayload, FxEpoch, FxScatterPayload, FxSnapshot, PanelInset};
use crate::window_state::DockEdge;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const FX_LABEL: &str = "fx";
const PAD_LOGICAL: f64 = 240.0;

fn presentation_epoch(app: &AppHandle) -> Option<FxEpoch> {
    app.try_state::<crate::AppState>().map(|state| state.fx.epoch())
}

fn emit_snapshot(app: &AppHandle, snapshot: Option<FxSnapshot>) {
    if let Some(snapshot) = snapshot {
        let _ = app.emit_to(FX_LABEL, "fx-state", &snapshot);
    }
}

pub fn dock_changed(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    emit_snapshot(app, state.fx.update_dock(state.edge_dock.snapshot(), state.edge_dock.generation()));
}

pub fn preferences_changed(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let (theme_changed, snapshot) = state.fx.update_preferences(state.preferences.fx_preferences());
    emit_snapshot(app, snapshot);
    if theme_changed {
        if let Some(main) = app.get_webview_window("main") {
            state.edge_dock.sync_current_fx(app, &main);
        }
    }
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    let state = app.state::<crate::AppState>();
    let (changed, snapshot) = state.fx.set_enabled(enabled);
    emit_snapshot(app, snapshot);
    if changed {
        if let Some(main) = app.get_webview_window("main") {
            state.edge_dock.sync_current_fx(app, &main);
        }
    }
}

#[cfg(windows)]
fn apply_fx_overlay_styles(hwnd: windows::Win32::Foundation::HWND) -> Result<(), String> {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next_style = (style
            | (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE).0
                as isize)
            & !(WS_EX_APPWINDOW.0 as isize);
        if next_style != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
            let _ = SetWindowPos(
                hwnd,
                windows::Win32::Foundation::HWND::default(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
        let disable = BOOL(1);
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            (&disable as *const BOOL).cast(),
            std::mem::size_of::<BOOL>() as u32,
        )
        .map_err(|error| error.to_string())
    }
}

#[cfg(windows)]
fn configure_fx_overlay_window(fx: &tauri::WebviewWindow) {
    let Ok(hwnd) = fx.hwnd() else { return; };
    let _ = apply_fx_overlay_styles(windows::Win32::Foundation::HWND(hwnd.0));
}

#[cfg(not(windows))]
fn configure_fx_overlay_window(_fx: &tauri::WebviewWindow) {}

fn set_fx_bounds(
    fx: &tauri::WebviewWindow,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
        };

        let cur_pos = fx.outer_position().map_err(|error| error.to_string())?;
        let cur_size = fx.outer_size().map_err(|error| error.to_string())?;
        if cur_pos != position || cur_size != size {
            let hwnd = fx.hwnd().map_err(|error| error.to_string())?;
            let width = i32::try_from(size.width).unwrap_or(i32::MAX);
            let height = i32::try_from(size.height).unwrap_or(i32::MAX);
            unsafe {
                SetWindowPos(
                    HWND(hwnd.0),
                    HWND::default(),
                    position.x,
                    position.y,
                    width,
                    height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                )
                .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if fx.outer_position().map_err(|error| error.to_string())? != position {
            fx.set_position(position).map_err(|error| error.to_string())?;
        }
        if fx.outer_size().map_err(|error| error.to_string())? != size {
            fx.set_size(size).map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn show_fx_window(fx: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

        configure_fx_overlay_window(fx);
        let hwnd = fx.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNOACTIVATE);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fx.show().map_err(|error| error.to_string())
    }
}

fn hide_fx_window(fx: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

        configure_fx_overlay_window(fx);
        let hwnd = fx.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let _ = ShowWindow(HWND(hwnd.0), SW_HIDE);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fx.hide().map_err(|error| error.to_string())
    }
}

pub fn create_fx_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let main = crate::window::main_window(app)?;
    if app.get_webview_window(FX_LABEL).is_none() {
        emit_snapshot(app, app.state::<crate::AppState>().fx.reset_window());
        let builder = WebviewWindowBuilder::new(app, FX_LABEL, WebviewUrl::App("index.html".into()))
            .title("Sticky Note FX")
            .inner_size(100.0, 100.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .shadow(false)
            .resizable(false)
            .focused(false);
        #[cfg(windows)]
        let builder = builder.owner(&main)?;
        let fx = builder.build()?;
        #[cfg(not(windows))]
        fx.set_ignore_cursor_events(true)?;
        configure_fx_overlay_window(&fx);
        let handle = app.clone();
        fx.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = handle.try_state::<crate::AppState>() {
                    emit_snapshot(&handle, state.fx.reset_window());
                }
            }
        });
    }
    app.state::<crate::AppState>().edge_dock.sync_current_fx(app, &main);
    Ok(())
}

fn layout_fx(
    main: &tauri::WebviewWindow, fx: &tauri::WebviewWindow,
    panel_pos: PhysicalPosition<i32>, panel_size: PhysicalSize<u32>,
) -> Result<PanelInset, String> {
    let scale = main.scale_factor().map_err(|error| error.to_string())?;
    if !scale.is_finite() || scale <= 0.0 { return Err(crate::language::text("Invalid FX display scale.", "特效显示缩放无效。").into()); }
    let pad = (PAD_LOGICAL * scale).round().max(80.0) as i32;
    let position = PhysicalPosition { x: panel_pos.x.saturating_sub(pad), y: panel_pos.y.saturating_sub(pad) };
    let size = PhysicalSize {
        width: panel_size.width.saturating_add((pad * 2) as u32).max(120),
        height: panel_size.height.saturating_add((pad * 2) as u32).max(120),
    };
    set_fx_bounds(fx, position, size)?;
    #[cfg(not(windows))]
    {
        fx.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
        fx.set_always_on_top(true).map_err(|error| error.to_string())?;
    }
    configure_fx_overlay_window(fx);
    Ok(PanelInset {
        x: f64::from(pad) / f64::from(size.width) * 100.0,
        y: f64::from(pad) / f64::from(size.height) * 100.0,
        w: f64::from(panel_size.width) / f64::from(size.width) * 100.0,
        h: f64::from(panel_size.height) / f64::from(size.height) * 100.0,
    })
}

/// Keep the transparent FX layer right above the sticky note without overriding pin preference.
/// Otherwise leaves render "behind" the opaque main HWND.
fn raise_fx_above_main(main: &tauri::WebviewWindow, fx: &tauri::WebviewWindow) {
    let pinned = main.is_always_on_top().unwrap_or(false);
    #[cfg(not(windows))]
    {
        let _ = fx.set_always_on_top(pinned);
    }

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };

        let Ok(fx_hwnd) = fx.hwnd() else {
            return;
        };
        let Ok(main_hwnd) = main.hwnd() else {
            return;
        };
        let fx_hwnd = HWND(fx_hwnd.0);
        let main_hwnd = HWND(main_hwnd.0);
        let band = if pinned { HWND_TOPMOST } else { HWND_NOTOPMOST };
        unsafe {
            // Keep FX directly above main inside main's current z-order band.
            let _ = SetWindowPos(
                fx_hwnd,
                band,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            let _ = SetWindowPos(
                main_hwnd,
                fx_hwnd,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

// Disabling FX must not disable the main window's tray or docking lifecycle.
pub fn main_is_presentable(app: &AppHandle, main: &tauri::WebviewWindow) -> bool {
    app.try_state::<crate::AppState>()
        .map(|state| !state.edge_dock.is_suspended())
        .unwrap_or(false)
        && main.is_visible().unwrap_or(false)
        && !main.is_minimized().unwrap_or(true)
}

// All queued operations recheck lifecycle and policy inside the UI callback.
fn with_presented_fx(
    app: &AppHandle,
    action: impl FnOnce(&AppHandle, &tauri::WebviewWindow, &tauri::WebviewWindow, FxEpoch) -> Result<(), String> + Send + 'static,
) {
    let Some(epoch) = presentation_epoch(app) else { return; };
    if !app.state::<crate::AppState>().fx.allowed() { hide_fx(app); return; }
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if presentation_epoch(&handle) != Some(epoch) { return; }
        let Some(main) = handle.get_webview_window("main") else { return; };
        if !main_is_presentable(&handle, &main) { hide_fx(&handle); return; }
        let Some(fx) = handle.get_webview_window(FX_LABEL) else { return; };
        if let Err(error) = action(&handle, &main, &fx, epoch) {
            eprintln!("FX presentation failed: {error}");
            hide_fx(&handle);
        }
    }) {
        eprintln!("FX UI dispatch failed: {error}");
    }
}

pub fn raise_fx_if_visible(app: &AppHandle) {
    with_presented_fx(app, |_, main, fx, _| {
        if fx.is_visible().map_err(|error| error.to_string())? { raise_fx_above_main(main, fx); }
        Ok(())
    });
}

fn emit_action(app: &AppHandle, epoch: FxEpoch, payload: FxActionPayload) {
    if let Some((snapshot, action)) = app.state::<crate::AppState>().fx.action(epoch, payload) {
        emit_snapshot(app, Some(snapshot));
        let _ = app.emit_to(FX_LABEL, "fx-action", &action);
    }
}

pub fn play_fx_scatter(
    app: &AppHandle, edge: DockEdge, kind: &'static str,
    panel_pos: PhysicalPosition<i32>, panel_size: PhysicalSize<u32>,
) {
    with_presented_fx(app, move |app, main, fx, epoch| {
        let panel = layout_fx(main, fx, panel_pos, panel_size)?;
        let was_visible = fx.is_visible().unwrap_or(false);
        show_fx_window(fx)?;
        if !was_visible {
            crate::window::refresh_transparent_surface_force(fx);
        }
        raise_fx_above_main(main, fx);
        emit_snapshot(app, app.state::<crate::AppState>().fx.apply_layout(epoch, edge, panel));
        emit_action(app, epoch, FxActionPayload::Scatter(FxScatterPayload { kind, edge, panel }));
        Ok(())
    });
}

pub fn keep_fx_overlay(
    app: &AppHandle, panel_pos: PhysicalPosition<i32>, panel_size: PhysicalSize<u32>, edge: DockEdge,
) {
    with_presented_fx(app, move |app, main, fx, epoch| {
        let panel = layout_fx(main, fx, panel_pos, panel_size)?;
        let was_visible = fx.is_visible().unwrap_or(false);
        show_fx_window(fx)?;
        if !was_visible {
            crate::window::refresh_transparent_surface_force(fx);
        }
        raise_fx_above_main(main, fx);
        emit_snapshot(app, app.state::<crate::AppState>().fx.apply_layout(epoch, edge, panel));
        Ok(())
    });
}

pub fn hide_fx(app: &AppHandle) {
    let Some(epoch) = presentation_epoch(app) else { return; };
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if presentation_epoch(&handle) != Some(epoch) { return; }
        if let Some(fx) = handle.get_webview_window(FX_LABEL) {
            if fx.is_visible().unwrap_or(false) {
                if let Err(error) = hide_fx_window(&fx) { eprintln!("Hide FX window failed: {error}"); }
            }
        }
        emit_snapshot(&handle, handle.state::<crate::AppState>().fx.apply_hidden(epoch));
    }) {
        eprintln!("Hide FX dispatch failed: {error}");
    }
}

pub fn pulse_fx_ambient(app: &AppHandle, edge: DockEdge, phase: String) {
    with_presented_fx(app, move |app, _, _, epoch| {
        emit_action(app, epoch, FxActionPayload::Ambient(FxAmbientPayload { edge, phase }));
        Ok(())
    });
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn fx_overlay_retains_toolwindow_owner_and_dwm_flags_across_show_move_and_hide() {
        use windows::core::w;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindow, GetWindowLongPtrW, SetWindowPos,
            ShowWindow, GWL_EXSTYLE, GW_OWNER, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE,
            SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_POPUP,
        };

        let required = (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED).0 as isize;

        unsafe {
            let owner = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("Sticky Note Owner Fixture"),
                WS_POPUP,
                100,
                100,
                320,
                500,
                HWND::default(),
                None,
                None,
                None,
            )
            .expect("create owner window");

            let fx = CreateWindowExW(
                WS_EX_APPWINDOW,
                w!("STATIC"),
                w!("Sticky Note FX Fixture"),
                WS_POPUP,
                60,
                60,
                400,
                580,
                owner,
                None,
                None,
                None,
            )
            .expect("create owned fx window");

            let assert_fx_invariants = |stage: &str| {
                let ex = GetWindowLongPtrW(fx, GWL_EXSTYLE);
                assert_eq!(ex & required, required, "{stage}: missing required overlay ex-style bits: 0x{ex:X}");
                assert_eq!(ex & (WS_EX_APPWINDOW.0 as isize), 0, "{stage}: unexpected WS_EX_APPWINDOW: 0x{ex:X}");
                assert_eq!(GetWindow(fx, GW_OWNER).ok(), Some(owner), "{stage}: GW_OWNER must match main owner");
            };

            apply_fx_overlay_styles(fx).expect("apply DWM and overlay styles");
            assert_fx_invariants("after apply_fx_overlay_styles");

            SetWindowPos(fx, HWND::default(), 40, 40, 440, 620, SWP_NOZORDER | SWP_NOACTIVATE)
                .expect("SetWindowPos");
            let _ = ShowWindow(fx, SW_SHOWNOACTIVATE);
            assert_fx_invariants("after SetWindowPos + ShowWindow(SW_SHOWNOACTIVATE)");

            apply_fx_overlay_styles(fx).expect("reapply DWM and overlay styles before hide");
            let _ = ShowWindow(fx, SW_HIDE);
            assert_fx_invariants("after ShowWindow(SW_HIDE)");

            DestroyWindow(fx).expect("destroy fx window");
            DestroyWindow(owner).expect("destroy owner window");
        }
    }
}
