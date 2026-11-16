#[cfg(windows)]
mod platform {
    use std::io;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_BINARY};
    use winreg::{RegKey, RegValue};

    const NAME: &str = "Sticky Note";
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    pub(super) fn reconcile_installed_path() -> io::Result<()> {
        let executable = std::env::current_exe()?;
        let Some(directory) = executable.parent() else { return Ok(()); };
        // A portable/debug launch must never steal an installed app's startup entry.
        // Only an executable at a registered NSIS install location may migrate it.
        let mut installed = false;
        for root in [HKEY_CURRENT_USER, winreg::enums::HKEY_LOCAL_MACHINE] {
            let key = match RegKey::predef(root).open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Sticky Note", KEY_READ,
            ) {
                Ok(key) => key,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let location = match key.get_value::<String, _>("InstallLocation") {
                Ok(location) => location,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let registered = std::path::Path::new(location.trim_matches('"'));
            if let (Ok(actual), Ok(expected)) = (directory.canonicalize(), registered.canonicalize()) {
                installed |= actual == expected;
            }
        }
        if !installed { return Ok(()); }
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = match hkcu.open_subkey_with_flags(RUN, KEY_READ | KEY_SET_VALUE) {
            Ok(run) => run,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        let previous = match run.get_value::<String, _>(NAME) {
            Ok(previous) => previous,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if let Some(command) = super::replacement_command(&previous, &executable)? {
            run.set_value(NAME, &command)?;
        }
        // Do not touch StartupApproved: Windows-disabled startup stays disabled.
        Ok(())
    }

    pub(super) fn is_enabled() -> io::Result<bool> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = match hkcu.open_subkey_with_flags(RUN, KEY_READ) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        match run.get_value::<String, _>(NAME) {
            Ok(command) if command.trim().is_empty() => return Ok(false),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        }
        let approved = match hkcu.open_subkey_with_flags(APPROVED, KEY_READ) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(true),
            Err(error) => return Err(error),
        };
        match approved.get_raw_value(NAME) {
            // Windows uses even states (2/6) for enabled and odd states (3/7) for disabled.
            Ok(value) => Ok(value.bytes.first().map_or(true, |state| state & 1 == 0)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(error),
        }
    }

    pub(super) fn set_enabled(enabled: bool) -> io::Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let executable = std::env::current_exe()?;
            let path = executable.to_str().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "Application path is not valid Unicode")
            })?;
            // Run values are command lines: quote the executable, including paths with spaces.
            let command = format!("\"{path}\"");
            let (run, _) = hkcu.create_subkey_with_flags(RUN, KEY_SET_VALUE)?;
            let (approved, _) = hkcu.create_subkey_with_flags(APPROVED, KEY_SET_VALUE)?;
            run.set_value(NAME, &command)?;
            let mut bytes = vec![0; 12];
            bytes[0] = 2;
            approved.set_raw_value(NAME, &RegValue { vtype: REG_BINARY, bytes })?;
        } else {
            let run = match hkcu.open_subkey_with_flags(RUN, KEY_SET_VALUE) {
                Ok(key) => key,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(error),
            };
            match run.delete_value(NAME) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn get_autostart_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        platform::reconcile_installed_path().map_err(|error| startup_error(&error))?;
        platform::is_enabled().map_err(|error| startup_error(&error))
    }
    #[cfg(not(windows))]
    { Err(crate::language::text("Launch at startup is only supported on Windows.", "开机自动启动目前仅支持 Windows。").into()) }
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        platform::set_enabled(enabled).map_err(|error| startup_error(&error))?;
        platform::is_enabled().map_err(|error| startup_error(&error))
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err(crate::language::text("Launch at startup is only supported on Windows.", "开机自动启动目前仅支持 Windows。").into())
    }
}

#[cfg(windows)]
fn startup_error(error: &std::io::Error) -> String {
    let message = crate::language::text(
        "Unable to read or update Windows startup settings.",
        "无法读取或更新 Windows 开机启动设置。",
    );
    match error.raw_os_error() {
        Some(code) => format!("{message} (OS {code})"),
        None => message.into(),
    }
}

pub fn reconcile_installed_path() -> Result<(), String> {
    #[cfg(windows)]
    { platform::reconcile_installed_path().map_err(|error| startup_error(&error)) }
    #[cfg(not(windows))]
    { Ok(()) } // No Windows startup migration is attempted on other platforms.
}

#[cfg(any(windows, test))]
fn replacement_command(previous: &str, executable: &std::path::Path) -> std::io::Result<Option<String>> {
    if previous.trim().is_empty() { return Ok(None); }
    let path = executable.to_str().ok_or_else(||
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Application path is not valid Unicode"))?;
    let command = format!("\"{path}\"");
    Ok((previous != command).then_some(command))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_only_retargets_existing_nonempty_startup_commands() {
        let installed = std::path::Path::new(r"D:\Applications\Sticky Note\sticky-note.exe");
        assert!(replacement_command("", installed).unwrap().is_none());
        assert!(replacement_command("   ", installed).unwrap().is_none());
        let expected = format!("\"{}\"", installed.display());
        assert!(replacement_command(&expected, installed).unwrap().is_none());
        assert_eq!(replacement_command(r#""C:\debug\latest.exe""#, installed).unwrap(), Some(expected));
    }
}
