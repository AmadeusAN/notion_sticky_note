use crate::database::Database;
use crate::language;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const DEFAULT_APP_ICON_ID: &str = "c3";
const VALID_ICON_IDS: &[&str] = &["c3", "c2", "c4", "l3a", "l3b", "l3c", "l3d", "custom"];
const RGBA_128_BYTES: usize = 128 * 128 * 4;
const RGBA_32_BYTES: usize = 32 * 32 * 4;
const MAX_CUSTOM_DATA_URL_BYTES: usize = 512 * 1024;
const ICON_128_FILE: &str = "app-icon-128.rgba";
const ICON_32_FILE: &str = "app-icon-32.rgba";
const ICO_SUBDIR: &str = "icons";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconState {
    pub icon_id: String,
    pub custom_data_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppIconPayload {
    pub icon_id: String,
    pub custom_data_url: Option<String>,
    pub rgba_128: Vec<u8>,
    pub rgba_32: Vec<u8>,
}

pub fn normalize_icon_id(id: &str) -> &str {
    if VALID_ICON_IDS.contains(&id) {
        id
    } else {
        DEFAULT_APP_ICON_ID
    }
}

pub fn validate_payload(payload: &SetAppIconPayload) -> Result<(), String> {
    if !VALID_ICON_IDS.contains(&payload.icon_id.as_str()) {
        return Err(language::text("Unknown icon preset.", "未知的图标方案。").into());
    }
    if payload.rgba_128.len() != RGBA_128_BYTES {
        return Err(
            language::text("Invalid 128x128 icon pixel buffer.", "128x128 图标像素数据无效。").into(),
        );
    }
    if payload.rgba_32.len() != RGBA_32_BYTES {
        return Err(
            language::text("Invalid 32x32 tray icon pixel buffer.", "32x32 托盘图标像素数据无效。")
                .into(),
        );
    }
    if let Some(url) = payload.custom_data_url.as_deref() {
        if url.len() > MAX_CUSTOM_DATA_URL_BYTES {
            return Err(language::text(
                "Custom icon preview exceeds the 512 KB limit.",
                "自定义图标缩略图超过 512 KB 限制。",
            )
            .into());
        }
        if !url.starts_with("data:image/") {
            return Err(language::text(
                "Custom icon must be an image data URL.",
                "自定义图标必须是有效的图片数据。",
            )
            .into());
        }
    }
    if payload.icon_id == "custom" && payload.custom_data_url.as_deref().is_none_or(str::is_empty)
    {
        return Err(language::text(
            "Upload an icon image before selecting the custom slot.",
            "请先上传自定义图标图片。",
        )
        .into());
    }
    Ok(())
}

fn icon_paths(dir: &Path) -> (PathBuf, PathBuf) {
    (dir.join(ICON_128_FILE), dir.join(ICON_32_FILE))
}

pub fn write_cached_rgba_files(
    dir: &Path,
    rgba_128: &[u8],
    rgba_32: &[u8],
) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let (p128, p32) = icon_paths(dir);
    std::fs::write(p128, rgba_128).map_err(|e| e.to_string())?;
    std::fs::write(p32, rgba_32).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_cached_rgba_files(dir: &Path) -> Option<(Vec<u8>, Vec<u8>)> {
    let (p128, p32) = icon_paths(dir);
    let b128 = std::fs::read(p128).ok()?;
    let b32 = std::fs::read(p32).ok()?;
    if b128.len() == RGBA_128_BYTES && b32.len() == RGBA_32_BYTES {
        Some((b128, b32))
    } else {
        None
    }
}

fn encode_ico_dib_frame(rgba: &[u8], size: u32) -> Vec<u8> {
    let s = size as usize;
    let xor_bytes = s * s * 4;
    let and_row_stride = ((s + 31) / 32) * 4;
    let and_bytes = and_row_stride * s;
    let mut frame = Vec::with_capacity(40 + xor_bytes + and_bytes);

    // BITMAPINFOHEADER (40 bytes)
    frame.extend_from_slice(&40u32.to_le_bytes()); // biSize
    frame.extend_from_slice(&(size as i32).to_le_bytes()); // biWidth
    frame.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // biHeight (XOR + AND)
    frame.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    frame.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    frame.extend_from_slice(&0u32.to_le_bytes()); // biCompression = BI_RGB
    frame.extend_from_slice(&(xor_bytes as u32).to_le_bytes()); // biSizeImage
    frame.extend_from_slice(&0i32.to_le_bytes()); // biXPelsPerMeter
    frame.extend_from_slice(&0i32.to_le_bytes()); // biYPelsPerMeter
    frame.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    frame.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant

    // Bottom-up BGRA XOR pixels
    for row in (0..s).rev() {
        let row_start = row * s * 4;
        for col in 0..s {
            let idx = row_start + col * 4;
            let r = rgba[idx];
            let g = rgba[idx + 1];
            let b = rgba[idx + 2];
            let a = rgba[idx + 3];
            frame.extend_from_slice(&[b, g, r, a]);
        }
    }

    // 1-bpp AND mask (all 0s -> transparency comes from 32-bit alpha channel)
    frame.resize(frame.len() + and_bytes, 0);
    frame
}

/// Encode 128x128 and 32x32 RGBA buffers into a standard 2-frame Windows `.ico` binary.
pub fn encode_ico(rgba_128: &[u8], rgba_32: &[u8]) -> Result<Vec<u8>, String> {
    if rgba_128.len() != RGBA_128_BYTES || rgba_32.len() != RGBA_32_BYTES {
        return Err(language::text("Invalid icon buffer size.", "图标像素尺寸无效。").into());
    }
    let frame_128 = encode_ico_dib_frame(rgba_128, 128);
    let frame_32 = encode_ico_dib_frame(rgba_32, 32);

    let header_size = 6usize;
    let entry_size = 16usize;
    let offset_128 = (header_size + entry_size * 2) as u32;
    let offset_32 = offset_128 + frame_128.len() as u32;

    let mut out = Vec::with_capacity(offset_32 as usize + frame_32.len());
    // ICONDIR
    out.extend_from_slice(&0u16.to_le_bytes()); // idReserved
    out.extend_from_slice(&1u16.to_le_bytes()); // idType (1 = icon)
    out.extend_from_slice(&2u16.to_le_bytes()); // idCount

    for (dim, len, offset) in [
        (128u8, frame_128.len() as u32, offset_128),
        (32u8, frame_32.len() as u32, offset_32),
    ] {
        out.push(dim); // bWidth
        out.push(dim); // bHeight
        out.push(0); // bColorCount
        out.push(0); // bReserved
        out.extend_from_slice(&1u16.to_le_bytes()); // wPlanes
        out.extend_from_slice(&32u16.to_le_bytes()); // wBitCount
        out.extend_from_slice(&len.to_le_bytes()); // dwBytesInRes
        out.extend_from_slice(&offset.to_le_bytes()); // dwImageOffset
    }

    out.extend_from_slice(&frame_128);
    out.extend_from_slice(&frame_32);
    Ok(out)
}

pub fn write_versioned_ico(
    dir: &Path,
    icon_id: &str,
    rgba_128: &[u8],
    rgba_32: &[u8],
) -> Result<PathBuf, String> {
    let ico_bytes = encode_ico(rgba_128, rgba_32)?;
    let icons_dir = dir.join(ICO_SUBDIR);
    std::fs::create_dir_all(&icons_dir).map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let normalized = normalize_icon_id(icon_id);
    let target = icons_dir.join(format!("sticky-note-{normalized}-{stamp}.ico"));
    std::fs::write(&target, ico_bytes).map_err(|e| e.to_string())?;

    if let Ok(entries) = std::fs::read_dir(&icons_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path == target {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with("sticky-note-") && name.ends_with(".ico") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(target)
}

fn find_latest_ico(dir: &Path) -> Option<PathBuf> {
    let icons_dir = dir.join(ICO_SUBDIR);
    let entries = std::fs::read_dir(&icons_dir).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("sticky-note-") || !name.ends_with(".ico") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if best
            .as_ref()
            .is_none_or(|(best_time, _)| modified >= *best_time)
        {
            best = Some((modified, path));
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(windows)]
mod win_shell {
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use tauri::WebviewWindow;
    use windows::core::{GUID, HSTRING, Interface, PCWSTR, PROPVARIANT};
    use windows::Win32::Foundation::{HWND, LPARAM, MAX_PATH, RPC_E_CHANGED_MODE, WPARAM};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoUninitialize, IPersistFile, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, PROPERTYKEY, SHGetPropertyStoreForWindow,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_IDLIST, SHCNF_PATHW,
        SHChangeNotify, SLGP_RAWPATH, ShellLink,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GCLP_HICON, GCLP_HICONSM, GetSystemMetrics, HICON, ICON_BIG, ICON_SMALL,
        IMAGE_ICON, LR_LOADFROMFILE, LoadImageW, SM_CXICON, SM_CXSMICON, SM_CYICON, SM_CYSMICON,
        SendMessageW, SetClassLongPtrW, WM_SETICON,
    };

    // PKEY_AppUserModel_RelaunchIconResource = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, pid 3
    const PKEY_APP_USER_MODEL_RELAUNCH_ICON_RESOURCE: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9F4C_2855_9F79_4B39_A8D0_E1D4_2DE1_D5F3),
        pid: 3,
    };

    struct HeldHandles {
        big: isize,
        small: isize,
    }

    static HELD_ICONS: OnceLock<Mutex<Option<HeldHandles>>> = OnceLock::new();

    unsafe fn load_ico_handle(path: &HSTRING, w: i32, h: i32) -> Option<HICON> {
        let handle = LoadImageW(
            None,
            PCWSTR(path.as_ptr()),
            IMAGE_ICON,
            w,
            h,
            LR_LOADFROMFILE,
        )
        .ok()?;
        if handle.is_invalid() {
            None
        } else {
            Some(HICON(handle.0))
        }
    }

    fn apply_win32_window_icons(win: &WebviewWindow, ico_path: &Path) {
        let Ok(raw_hwnd) = win.hwnd() else {
            return;
        };
        let hwnd = HWND(raw_hwnd.0);
        let h_path = HSTRING::from(ico_path.as_os_str());
        let icon_resource = format!("{},0", ico_path.display());

        unsafe {
            let cx_big = GetSystemMetrics(SM_CXICON).max(32);
            let cy_big = GetSystemMetrics(SM_CYICON).max(32);
            let cx_small = GetSystemMetrics(SM_CXSMICON).max(16);
            let cy_small = GetSystemMetrics(SM_CYSMICON).max(16);

            let big = load_ico_handle(&h_path, cx_big, cy_big);
            let small = load_ico_handle(&h_path, cx_small, cy_small);

            if let Some(h_big) = big {
                SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_BIG as usize), LPARAM(h_big.0 as isize));
                SetClassLongPtrW(hwnd, GCLP_HICON, h_big.0 as isize);
            }
            if let Some(h_small) = small {
                SendMessageW(
                    hwnd,
                    WM_SETICON,
                    WPARAM(ICON_SMALL as usize),
                    LPARAM(h_small.0 as isize),
                );
                SetClassLongPtrW(hwnd, GCLP_HICONSM, h_small.0 as isize);
            }

            if big.is_some() || small.is_some() {
                let mut guard = HELD_ICONS
                    .get_or_init(|| Mutex::new(None))
                    .lock()
                    .unwrap();
                if let Some(prev) = guard.take() {
                    if prev.big != 0 {
                        let _ = DestroyIcon(HICON(prev.big as *mut _));
                    }
                    if prev.small != 0 && prev.small != prev.big {
                        let _ = DestroyIcon(HICON(prev.small as *mut _));
                    }
                }
                *guard = Some(HeldHandles {
                    big: big.map_or(0, |h| h.0 as isize),
                    small: small.map_or(0, |h| h.0 as isize),
                });
            }

            if let Ok(store) = SHGetPropertyStoreForWindow::<_, IPropertyStore>(hwnd) {
                let prop = PROPVARIANT::from(icon_resource.as_str());
                let _ = store.SetValue(&PKEY_APP_USER_MODEL_RELAUNCH_ICON_RESOURCE, &prop);
                let _ = store.Commit();
            }
        }
    }

    fn candidate_shortcut_paths() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            let base = PathBuf::from(appdata);
            let programs = base.join("Microsoft\\Windows\\Start Menu\\Programs");
            paths.push(programs.join("Sticky Note.lnk"));
            paths.push(programs.join("Sticky Note\\Sticky Note.lnk"));
            paths.push(
                base.join("Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\Sticky Note.lnk"),
            );
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let base = PathBuf::from(profile);
            paths.push(base.join("Desktop\\Sticky Note.lnk"));
            paths.push(base.join("OneDrive\\Desktop\\Sticky Note.lnk"));
        }
        paths
    }

    unsafe fn retarget_shortcut_icon(lnk_path: &Path, ico_path: &Path) -> bool {
        if !lnk_path.exists() {
            return false;
        }
        let Ok(link): windows::core::Result<IShellLinkW> =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
        else {
            return false;
        };
        let Ok(persist): windows::core::Result<IPersistFile> = link.cast() else {
            return false;
        };
        let h_lnk = HSTRING::from(lnk_path.as_os_str());
        if persist.Load(PCWSTR(h_lnk.as_ptr()), STGM_READWRITE).is_err() {
            return false;
        }

        let mut target_buf = [0u16; MAX_PATH as usize];
        if link
            .GetPath(
                &mut target_buf,
                std::ptr::null_mut(),
                SLGP_RAWPATH.0 as u32,
            )
            .is_err()
        {
            return false;
        }
        let len = target_buf
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(target_buf.len());
        let target_str = String::from_utf16_lossy(&target_buf[..len]).to_lowercase();
        if !target_str.contains("sticky-note.exe") && !target_str.contains("sticky note") {
            return false;
        }

        let h_ico = HSTRING::from(ico_path.as_os_str());
        if link.SetIconLocation(PCWSTR(h_ico.as_ptr()), 0).is_err() {
            return false;
        }
        if persist.Save(PCWSTR(h_lnk.as_ptr()), true).is_err() {
            return false;
        }
        SHChangeNotify(
            SHCNE_UPDATEITEM,
            SHCNF_PATHW,
            Some(h_lnk.as_ptr() as *const _),
            None,
        );
        true
    }

    pub fn sync_windows_shell_icons(win: Option<&WebviewWindow>, ico_path: &Path) {
        if let Some(w) = win {
            apply_win32_window_icons(w, ico_path);
        }

        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let should_uninit = hr.is_ok();
            if hr.is_ok() || hr == RPC_E_CHANGED_MODE {
                for lnk in candidate_shortcut_paths() {
                    let _ = retarget_shortcut_icon(&lnk, ico_path);
                }
            }
            if should_uninit {
                CoUninitialize();
            }
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
        }
    }
}

pub fn apply_rgba_icon(
    app: &AppHandle,
    rgba_128: Vec<u8>,
    rgba_32: Vec<u8>,
    ico_path: Option<&Path>,
) -> Result<(), String> {
    if rgba_128.len() != RGBA_128_BYTES || rgba_32.len() != RGBA_32_BYTES {
        return Err(language::text("Invalid icon buffer size.", "图标像素尺寸无效。").into());
    }
    let main_win = app.get_webview_window("main");
    if let Some(ref win) = main_win {
        let win_icon = tauri::image::Image::new_owned(rgba_128, 128, 128);
        win.set_icon(win_icon).map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tray_icon = tauri::image::Image::new_owned(rgba_32, 32, 32);
        tray.set_icon(Some(tray_icon)).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    if let Some(path) = ico_path {
        win_shell::sync_windows_shell_icons(main_win.as_ref(), path);
    }
    #[cfg(not(windows))]
    let _ = ico_path;
    Ok(())
}

pub fn restore_saved_icon_on_startup(app: &AppHandle, db: &Database) {
    let Ok((icon_id, _)) = db.load_app_icon() else {
        return;
    };
    if icon_id == DEFAULT_APP_ICON_ID {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if let Some((rgba_128, rgba_32)) = read_cached_rgba_files(&dir) {
        let ico_path = find_latest_ico(&dir)
            .or_else(|| write_versioned_ico(&dir, &icon_id, &rgba_128, &rgba_32).ok());
        if let Err(err) = apply_rgba_icon(app, rgba_128, rgba_32, ico_path.as_deref()) {
            eprintln!("Failed to restore saved app icon ({icon_id}): {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_icon_payload_and_buffers() {
        let ok = SetAppIconPayload {
            icon_id: "c3".into(),
            custom_data_url: None,
            rgba_128: vec![0; RGBA_128_BYTES],
            rgba_32: vec![0; RGBA_32_BYTES],
        };
        assert!(validate_payload(&ok).is_ok());

        let bad_id = SetAppIconPayload {
            icon_id: "unknown".into(),
            ..ok.clone()
        };
        assert!(validate_payload(&bad_id).is_err());

        let bad_buf = SetAppIconPayload {
            rgba_128: vec![0; 16],
            ..ok.clone()
        };
        assert!(validate_payload(&bad_buf).is_err());

        let custom_without_url = SetAppIconPayload {
            icon_id: "custom".into(),
            custom_data_url: None,
            ..ok.clone()
        };
        assert!(validate_payload(&custom_without_url).is_err());

        let custom_ok = SetAppIconPayload {
            icon_id: "custom".into(),
            custom_data_url: Some("data:image/png;base64,AAAA".into()),
            ..ok
        };
        assert!(validate_payload(&custom_ok).is_ok());
    }

    #[test]
    fn roundtrips_cached_rgba_files() {
        let dir = std::env::temp_dir().join(format!("sticky_note_icon_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let b128 = vec![42u8; RGBA_128_BYTES];
        let b32 = vec![84u8; RGBA_32_BYTES];
        write_cached_rgba_files(&dir, &b128, &b32).unwrap();
        let loaded = read_cached_rgba_files(&dir).unwrap();
        assert_eq!(loaded.0, b128);
        assert_eq!(loaded.1, b32);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn encodes_valid_two_frame_bgra_ico_and_writes_versioned_file() {
        let mut rgba_128 = vec![0u8; RGBA_128_BYTES];
        rgba_128[0] = 10;
        rgba_128[1] = 20;
        rgba_128[2] = 30;
        rgba_128[3] = 255;
        let rgba_32 = vec![200u8; RGBA_32_BYTES];

        let ico = encode_ico(&rgba_128, &rgba_32).unwrap();
        // ICONDIR: reserved=0, type=1, count=2
        assert_eq!(&ico[0..6], &[0, 0, 1, 0, 2, 0]);
        // First entry: 128x128
        assert_eq!(ico[6], 128);
        assert_eq!(ico[7], 128);
        // Second entry: 32x32
        assert_eq!(ico[22], 32);
        assert_eq!(ico[23], 32);

        let expected_128_len = 40 + RGBA_128_BYTES + (16 * 128);
        let expected_32_len = 40 + RGBA_32_BYTES + (4 * 32);
        assert_eq!(ico.len(), 6 + 32 + expected_128_len + expected_32_len);

        // Verify BITMAPINFOHEADER height = 256 (2 * 128) and bottom-up BGRA conversion on top-left pixel
        let offset_128 = 38;
        assert_eq!(
            i32::from_le_bytes(ico[offset_128 + 8..offset_128 + 12].try_into().unwrap()),
            256
        );
        // Top-left pixel (row 0 in top-down RGBA) lands at last row (row 127) in bottom-up BMP
        let last_row_offset = offset_128 + 40 + (127 * 128 * 4);
        assert_eq!(&ico[last_row_offset..last_row_offset + 4], &[30, 20, 10, 255]);

        let dir = std::env::temp_dir().join(format!("sticky_note_ico_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = write_versioned_ico(&dir, "c2", &rgba_128, &rgba_32).unwrap();
        assert!(first.exists());
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = write_versioned_ico(&dir, "c4", &rgba_128, &rgba_32).unwrap();
        assert!(second.exists());
        assert!(!first.exists(), "previous versioned .ico should be cleaned up");
        assert_eq!(find_latest_ico(&dir), Some(second));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
