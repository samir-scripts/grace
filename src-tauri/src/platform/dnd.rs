/// Returns whether the platform command completed successfully.
pub fn set_dnd(enable: bool) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let shortcut_name = if enable { "Pomotroid DND On" } else { "Pomotroid DND Off" };
        let status = std::process::Command::new("shortcuts")
            .args(["run", shortcut_name])
            .status();
        match status {
            Ok(s) if s.success() => {
                log::info!("[dnd] Shortcuts automation executed: {shortcut_name}");
                Ok(true)
            }
            _ => {
                log::debug!("[dnd] Shortcut '{shortcut_name}' not executed; continuing without interruption.");
                Ok(false)
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let val = if enable { "false" } else { "true" };
        let succeeded = std::process::Command::new("gsettings")
            .args(["set", "org.gnome.desktop.notifications", "show-banners", val])
            .status().is_ok_and(|status| status.success());
        Ok(succeeded)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = enable;
        Ok(false)
    }
}
