//! Transparent FX overlay window — layout / show-hide / event emit only.
//! Visual themes live in the frontend `src/fx/theme/*` modules.

use crate::edge_dock::DockEdge;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

const FX_LABEL: &str = "fx";
/// Logical px ring around the note panel (flight buffer). Scaled by DPI.
const PAD_LOGICAL: f64 = 240.0;

static HIDE_GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelInset {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FxScatterPayload {
    kind: String,
    edge: DockEdge,
    panel: PanelInset,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FxSyncPayload {
    active: bool,
    edge: Option<DockEdge>,
    panel: Option<PanelInset>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FxAmbientPayload {
    edge: DockEdge,
    phase: String,
}

pub fn create_fx_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window(FX_LABEL).is_some() {
        return Ok(());
    }

    let fx = WebviewWindowBuilder::new(app, FX_LABEL, WebviewUrl::App("index.html".into()))
        .title("Sticky Note FX")
        .inner_size(100.0, 100.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .build()?;

    let _ = fx.set_ignore_cursor_events(true);
    Ok(())
}

fn layout_fx(
    main: &tauri::WebviewWindow,
    fx: &tauri::WebviewWindow,
    panel_pos: PhysicalPosition<i32>,
    panel_size: PhysicalSize<u32>,
) -> Option<PanelInset> {
    let scale = main.scale_factor().unwrap_or(1.0);
    let pad = (PAD_LOGICAL * scale).round().max(80.0) as i32;

    let fx_x = panel_pos.x - pad;
    let fx_y = panel_pos.y - pad;
    let fx_w = panel_size.width.saturating_add((pad * 2) as u32).max(120);
    let fx_h = panel_size.height.saturating_add((pad * 2) as u32).max(120);

    let _ = fx.set_position(tauri::Position::Physical(PhysicalPosition {
        x: fx_x,
        y: fx_y,
    }));
    let _ = fx.set_size(tauri::Size::Physical(PhysicalSize {
        width: fx_w,
        height: fx_h,
    }));
    let _ = fx.set_ignore_cursor_events(true);
    let _ = fx.set_always_on_top(true);
    raise_fx_above_main(main, fx);

    Some(PanelInset {
        x: (pad as f64 / fx_w as f64) * 100.0,
        y: (pad as f64 / fx_h as f64) * 100.0,
        w: (panel_size.width as f64 / fx_w as f64) * 100.0,
        h: (panel_size.height as f64 / fx_h as f64) * 100.0,
    })
}

/// Keep the transparent FX layer above the sticky note without activating/focusing it.
/// Otherwise leaves render "behind" the opaque main HWND.
fn raise_fx_above_main(main: &tauri::WebviewWindow, fx: &tauri::WebviewWindow) {
    let _ = fx.set_always_on_top(true);
    let _ = main.set_always_on_top(true);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };

        let Ok(fx_hwnd) = fx.hwnd() else {
            return;
        };
        let Ok(main_hwnd) = main.hwnd() else {
            return;
        };
        let fx_hwnd = HWND(fx_hwnd.0);
        let main_hwnd = HWND(main_hwnd.0);
        unsafe {
            // Both topmost; place FX at the top of the topmost band, then tuck main under it.
            let _ = SetWindowPos(
                fx_hwnd,
                HWND_TOPMOST,
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

/// Public re-raise when main gains focus so FX stays on top while docked.
pub fn raise_fx_if_visible(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(fx) = app.get_webview_window(FX_LABEL) else {
        return;
    };
    if !fx.is_visible().unwrap_or(false) {
        return;
    }
    raise_fx_above_main(&main, &fx);
}

fn emit_to_fx_and_app<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: &T) {
    let _ = app.emit(event, payload);
    if let Some(fx) = app.get_webview_window(FX_LABEL) {
        let _ = fx.emit(event, payload);
    }
}

fn emit_sync(app: &AppHandle, payload: &FxSyncPayload) {
    emit_to_fx_and_app(app, "fx-sync", payload);
}

/// Cover the sticky-note panel + ring, emit scatter, keep visible for ambient FX.
pub fn play_fx_scatter(
    app: &AppHandle,
    edge: DockEdge,
    kind: &str,
    panel_pos: PhysicalPosition<i32>,
    panel_size: PhysicalSize<u32>,
) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(fx) = app.get_webview_window(FX_LABEL) else {
        return;
    };

    HIDE_GEN.fetch_add(1, Ordering::SeqCst);

    let Some(panel) = layout_fx(&main, &fx, panel_pos, panel_size) else {
        return;
    };
    let _ = fx.show();
    raise_fx_above_main(&main, &fx);

    let payload = FxScatterPayload {
        kind: kind.to_string(),
        edge,
        panel: panel.clone(),
    };
    emit_to_fx_and_app(app, "fx-scatter", &payload);

    emit_sync(
        app,
        &FxSyncPayload {
            active: true,
            edge: Some(edge),
            panel: Some(panel),
        },
    );
}

/// Re-layout overlay after jelly slide settles.
pub fn keep_fx_overlay(
    app: &AppHandle,
    panel_pos: PhysicalPosition<i32>,
    panel_size: PhysicalSize<u32>,
    edge: DockEdge,
) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(fx) = app.get_webview_window(FX_LABEL) else {
        return;
    };

    HIDE_GEN.fetch_add(1, Ordering::SeqCst);

    let Some(panel) = layout_fx(&main, &fx, panel_pos, panel_size) else {
        return;
    };
    let _ = fx.show();
    raise_fx_above_main(&main, &fx);

    emit_sync(
        app,
        &FxSyncPayload {
            active: true,
            edge: Some(edge),
            panel: Some(panel),
        },
    );
}

pub fn hide_fx(app: &AppHandle) {
    HIDE_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(fx) = app.get_webview_window(FX_LABEL) {
        let _ = fx.hide();
    }
    emit_sync(
        app,
        &FxSyncPayload {
            active: false,
            edge: None,
            panel: None,
        },
    );
}

/// Main-window timers invoke this so ambient FX keeps ticking while docked.
pub fn pulse_fx_ambient(app: &AppHandle, edge: DockEdge, phase: &str) {
    let payload = FxAmbientPayload {
        edge,
        phase: phase.to_string(),
    };
    if let Some(fx) = app.get_webview_window(FX_LABEL) {
        let _ = fx.set_ignore_cursor_events(true);
        let _ = fx.show();
        if let Some(main) = app.get_webview_window("main") {
            raise_fx_above_main(&main, &fx);
        }
    }
    emit_to_fx_and_app(app, "fx-ambient", &payload);
}
