use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use window_vibrancy::clear_acrylic;


pub fn apply_always_on_top<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window
        .set_always_on_top(true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Reduce Win11 snap / maximize when dragging to screen edges.
pub fn disable_system_snap_assist<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let _ = window.set_maximizable(false);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_MAXIMIZEBOX,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0);
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let style = style & !(WS_MAXIMIZEBOX.0 as isize);
                SetWindowLongPtrW(hwnd, GWL_STYLE, style);
            }
        }
    }

    Ok(())
}


pub fn apply_theme_effects<R: Runtime>(
    window: &WebviewWindow<R>,
    _theme: &str,
) -> Result<(), String> {
    // Keep the host transparent for every theme, including saved legacy glass themes.
    // Whole-window Acrylic fills the CSS panel's transparent margins with a halo;
    // local glass and the panel shadow are rendered by CSS instead.
    let _ = clear_acrylic(window);
    Ok(())
}

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window("main")
        .ok_or_else(|| crate::language::text("The main note window is unavailable.", "主便签窗口不可用。").into())
}
