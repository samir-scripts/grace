pub mod audio;
pub mod commands;
pub mod db;
pub mod notifications;
pub mod focus;
pub mod platform;
pub mod settings;
pub mod shortcuts;
pub mod themes;
pub mod timer;
pub mod tray;
pub mod websocket;
pub mod window_view;

use std::sync::Arc;

use log::LevelFilter;
use tauri::Manager;
use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use commands::{
    appearance_publish,
    accessibility_trusted,
    accessibility_request,
    tray_supported,
    app_version,
    check_update,
    install_update,
    audio_clear_custom, audio_get_custom_info, audio_set_custom,
    get_log_dir, open_log_dir,
    notification_show,
    settings_get, settings_reset_defaults, settings_set,
    shortcuts_reload,
    sessions_clear,
    stats_get_detailed, stats_get_heatmap,
    themes_list,
    timer_get_state, timer_reset, timer_restart_round, timer_skip, timer_toggle,
    window_set_visibility,
    window_set_view_size,
    focus_apps_list,
    focus_app_icon,
    focus_snapshot_get,
    focus_profiles_get,
    focus_profile_save,
    focus_profile_delete,
    focus_profile_select,
    focus_preferences_set_unblock_breaks,
    focus_passphrase_set,
    focus_passphrase_clear,
    focus_escape_start_hold,
    focus_escape_pulse_hold,
    focus_escape_cancel_hold,
    focus_escape_submit_passphrase,
    focus_browser_setup_get,
    focus_browser_profile_require,
    focus_browsers_list,
    focus_native_host_register,
    focus_chrome_extension_install,
    focus_browser_extension_install,
    focus_browser_extension_remove,
    focus_enforcement_retry,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    let main_window_config = {
        let config = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
            .expect("main window configuration not found");
        let original = config.clone();
        config.create = false;
        original
    };
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app_handle| {
            use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};

            let invalid_layout = || {
                tauri::Error::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "unexpected macOS default menu layout: guarded Quit could not be installed",
                ))
            };
            let menu = Menu::default(app_handle)?;
            let root_items = menu.items()?;
            let Some(MenuItemKind::Submenu(application_menu)) = root_items.first() else {
                return Err(invalid_layout());
            };
            let expected_pkg = app_handle.package_info().name.as_str();
            let expected_product = app_handle.config().product_name.as_deref();
            if !matches_macos_application_menu_title(&application_menu.text()?, expected_pkg, expected_product) {
                return Err(invalid_layout());
            }
            let application_items = application_menu.items()?;
            let Some(MenuItemKind::Predefined(quit_item)) = application_items.last() else {
                return Err(invalid_layout());
            };
            let quit_text = quit_item.text()?;
            if quit_text != PredefinedMenuItem::quit(app_handle, None)?.text()? {
                return Err(invalid_layout());
            }

            // Predefined macOS Quit calls terminate: directly, bypassing ExitRequested.
            let guarded_quit = MenuItem::with_id(
                app_handle,
                "guarded-quit",
                quit_text,
                true,
                Some("CmdOrCtrl+Q"),
            )?;
            application_menu.remove(quit_item)?;
            application_menu.insert(&guarded_quit, application_items.len() - 1)?;
            let _ = application_menu.set_text("grace.");
            Ok(menu)
        })
        .on_menu_event(|app_handle, event| {
            if event.id().as_ref() != "guarded-quit" {
                return;
            }
            if let Some(focus) = app_handle.try_state::<Arc<focus::controller::FocusController>>() {
                if focus.should_prevent_app_exit() {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    return;
                }
            }
            app_handle.exit(0);
        });
    builder
        .plugin(
            LogBuilder::new()
                .targets([Target::new(TargetKind::LogDir { file_name: None })])
                .max_file_size(5 * 1024 * 1024)
                .rotation_strategy(RotationStrategy::KeepOne)
                .level(LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            // Capture Rust panics to the log file before the process terminates.
            std::panic::set_hook(Box::new(|info| {
                log::error!("PANIC: {info}");
            }));

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");

            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data directory");

            let browser_bridge = match tauri::async_runtime::block_on(
                focus::browser::BrowserBridge::new_persistent_deferred(
                    &app_data_dir,
                    focus::browser::BROWSER_PORT_DEFAULT,
                ),
            ) {
                Ok(bridge) => Arc::new(bridge),
                Err(error) => {
                    log::error!("failed to initialize browser focus bridge: {error}");
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(format!(
                            "Grace could not start its browser connection on 127.0.0.1:{}.\n\nThe port may be in use by another instance or application. Close it if appropriate, then reopen Grace.\n\nDetails: {error}",
                            focus::browser::BROWSER_PORT_DEFAULT,
                        ))
                        .title("Grace could not start")
                        .kind(MessageDialogKind::Error)
                        .buttons(MessageDialogButtons::Ok)
                        .show(move |_| {
                            // tauri-runtime-wry 2.11 discards request_exit's code.
                            // Clean up explicitly before returning a failure status.
                            let cleanup_handle = handle.clone();
                            if handle.run_on_main_thread(move || {
                                cleanup_handle.cleanup_before_exit();
                                std::process::exit(1);
                            }).is_err() {
                                std::process::exit(1);
                            }
                        });
                    return Ok(());
                }
            };

            tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_config)?.build()?;

            // --- Database ---
            let db = match db::open(&app_data_dir) {
                Ok(d) => {
                    log::info!(
                        "[app] version={} sha={}",
                        env!("APP_BUILD_VERSION"),
                        env!("APP_BUILD_SHA")
                    );
                    log::info!(
                        "Grace v{} — data dir: {}",
                        env!("CARGO_PKG_VERSION"),
                        app_data_dir.display()
                    );
                    log::info!("Database opened successfully");
                    d
                }
                Err(e) => {
                    log::error!("Failed to open database: {e}");
                    panic!("failed to open database: {e}");
                }
            };
            {
                let conn = db.lock().unwrap();
                settings::seed_defaults(&conn).expect("failed to seed default settings");
            }
            app.manage(db.clone());

            // --- Tray state (always created; icon populated only when min_to_tray is on) ---
            let tray_state = tray::TrayState::new();
            app.manage(Arc::clone(&tray_state));

            // --- Load settings once (used by Timer, Audio, etc.) ---
            let initial_settings = {
                let conn = db.lock().unwrap();
                settings::load(&conn).expect("failed to load settings")
            };

            // Apply the persisted log level before any further setup.
            if initial_settings.verbose_logging {
                log::set_max_level(LevelFilter::Debug);
                log::info!("Verbose logging enabled — log level set to DEBUG");
            } else {
                log::set_max_level(LevelFilter::Info);
            }

            // Sync tray state from saved settings.
            *tray_state.countdown_mode.lock().unwrap() = initial_settings.dial_countdown;
            let tray_theme_name = match initial_settings.theme_mode.as_str() {
                "dark" => &initial_settings.theme_dark,
                _ => &initial_settings.theme_light,
            };
            if let Some(theme) = themes::find(&app_data_dir, tray_theme_name) {
                *tray_state.colors.lock().unwrap() = tray::TrayColors::from_colors_map(&theme.colors);
            }

            // --- Audio engine (optional — graceful if no audio device) ---
            if let Some(audio) = audio::AudioManager::new(&initial_settings) {
                // Restore any previously saved custom audio files.
                let audio_dir = app_data_dir.join("audio");
                if audio_dir.exists() {
                    let custom = audio::find_custom_files(&audio_dir);
                    *audio.custom_paths.lock().unwrap() = custom;
                }
                app.manage(audio);
            }

            // --- Browser Bridge & Focus controller ---
            app.manage(Arc::clone(&browser_bridge));

            let focus = Arc::new(focus::controller::FocusController::new(
                db.clone(),
                Some(browser_bridge),
            ));
            focus.set_app_handle(app.handle().clone());
            app.manage(Arc::clone(&focus));
            let window_view_state = Arc::new(window_view::WindowViewState::new());
            app.manage(Arc::clone(&window_view_state));


            // --- Timer controller (needs settings + AppHandle + TrayState + DB + Focus) ---
            let timer = timer::TimerController::new(
                app.handle().clone(),
                initial_settings.clone(),
                Arc::clone(&tray_state),
                db.clone(),
                Arc::clone(&focus),
            );
            app.manage(timer);

            // Create initial tray icon if tray_icon_enabled is on, or if an
            // existing user has min_to_tray enabled (backwards compatibility).
            //
            // On Linux, TrayIconBuilder::build() can block the main thread
            // indefinitely on KDE Plasma 6 / Wayland while waiting for the
            // StatusNotifierWatcher D-Bus service to respond.  Spawning on a
            // background thread lets setup() return so the event loop starts
            // and the window can appear while the tray registers asynchronously.
            if initial_settings.tray_icon_enabled || initial_settings.min_to_tray {
                #[cfg(target_os = "linux")]
                {
                    let app_handle = app.handle().clone();
                    let ts = Arc::clone(&tray_state);
                    std::thread::spawn(move || {
                        tray::create_tray(&app_handle, &ts);
                    });
                }
                #[cfg(not(target_os = "linux"))]
                tray::create_tray(app.handle(), &tray_state);
            }

            // --- Theme hot-reload watcher ---
            // The watcher must stay alive for the duration of the app.
            // Wrap in a Mutex so it satisfies Send + Sync for Tauri manage.
            if let Some(watcher) = themes::watcher::spawn_watcher(
                app_data_dir.clone(),
                app.handle().clone(),
            ) {
                app.manage(std::sync::Mutex::new(watcher));
            }

            // --- Global shortcuts ---
            shortcuts::register_all(app.handle(), &initial_settings);

            // --- WebSocket server (opt-in) ---
            let ws_state = websocket::WsState::new();
            app.manage(Arc::clone(&ws_state));

            if initial_settings.websocket_enabled {
                let port = initial_settings.websocket_port;
                let app_clone = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    websocket::start(port, app_clone, &ws_state).await;
                });
            }

            // --- Window event handlers ---
            let main_window = app
                .get_webview_window("main")
                .expect("main window not found");

            // The config sets decorations:true so macOS renders the window correctly
            // (decorations:false prevents event processing on macOS). On every other
            // platform, restore the decorations-free window immediately; the window is
            // still hidden at this point so there is no visible flash.
            #[cfg(not(target_os = "macos"))]
            let _ = main_window.set_decorations(false);

            // Enable macOS window tiling/arrangement.
            //
            // Two things are required for the full native experience:
            //
            // 1. NSWindowCollectionBehaviorManaged on the NSWindow — enables the
            //    tiling popup on the green traffic-light button AND tells macOS
            //    this window participates in Spaces / tiling.
            //
            // 2. NSApplication.setWindowsMenu: — registers the "Window" menu from
            //    the menu bar as the official windows menu. macOS then dynamically
            //    injects the standard window-management items (Fill, Center,
            //    Move & Resize with Halves/Quarters/Arrange, Full Screen Tile,
            //    Bring All to Front, etc.) when the menu is opened. Tauri may or
            //    may not wire this up, so we do it explicitly here.
            #[cfg(target_os = "macos")]
            {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject};
                use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                use objc2_foundation::NSString;

                unsafe {
                    if let Some(cls) = AnyClass::get(c"NSProcessInfo") {
                        let process_info: *mut AnyObject = msg_send![cls, processInfo];
                        if !process_info.is_null() {
                            let name = NSString::from_str("grace.");
                            let _: () = msg_send![process_info, setProcessName: &*name];
                        }
                    }
                }
                if let Ok(handle) = main_window.window_handle() {
                    if let RawWindowHandle::AppKit(h) = handle.as_raw() {
                        let ns_view = h.ns_view.as_ptr() as *mut AnyObject;
                        // SAFETY: ns_view is a valid NSView* supplied by Tauri/WRY.
                        let ns_window: *mut AnyObject =
                            unsafe { msg_send![ns_view, window] };

                        // NSWindowCollectionBehaviorManaged        = 1 << 2  (tiling)
                        // NSWindowCollectionBehaviorFullScreenPrimary = 1 << 10 (full-screen)
                        let behavior: u64 = (1 << 2) | (1 << 10);
                        unsafe {
                            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
                        }

                        // Walk the main menu bar looking for the "Window" menu and
                        // register it with NSApplication. This causes macOS to
                        // auto-populate it with all standard window-management items.
                        unsafe {
                            let ns_app_class = AnyClass::get(
                                c"NSApplication",
                            );
                            if let Some(cls) = ns_app_class {
                                let ns_app: *mut AnyObject =
                                    msg_send![cls, sharedApplication];
                                let main_menu: *mut AnyObject =
                                    msg_send![ns_app, mainMenu];
                                if !main_menu.is_null() {
                                    let count: isize =
                                        msg_send![main_menu, numberOfItems];
                                    for i in 0..count {
                                        let item: *mut AnyObject =
                                            msg_send![main_menu, itemAtIndex: i];
                                        let submenu: *mut AnyObject =
                                            msg_send![item, submenu];
                                        if submenu.is_null() {
                                            continue;
                                        }
                                        let title: *mut AnyObject =
                                            msg_send![item, title];
                                        let utf8: *const std::ffi::c_char =
                                            msg_send![title, UTF8String];
                                        if utf8.is_null() {
                                            continue;
                                        }
                                        let s = std::ffi::CStr::from_ptr(utf8)
                                            .to_str()
                                            .unwrap_or("");
                                        if s == "Window" {
                                            let _: () = msg_send![
                                                ns_app,
                                                setWindowsMenu: submenu
                                            ];
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Apply always-on-top from saved settings on startup.
            if initial_settings.always_on_top {
                let _ = main_window.set_always_on_top(true);
            }

            // Restore saved window position/size if all four values are present and
            // the saved rectangle still intersects at least one connected monitor.
            if let (Some(wx), Some(wy), Some(ww), Some(wh)) = (
                initial_settings.window_x,
                initial_settings.window_y,
                initial_settings.window_width,
                initial_settings.window_height,
            ) {
                let on_screen = app
                    .available_monitors()
                    .unwrap_or_default()
                    .into_iter()
                    .any(|m| {
                        let mp = m.position();
                        let ms = m.size();
                        let mx0 = mp.x as i64;
                        let my0 = mp.y as i64;
                        let mx1 = mx0 + ms.width as i64;
                        let my1 = my0 + ms.height as i64;
                        let wx0 = wx as i64;
                        let wy0 = wy as i64;
                        let wx1 = wx0 + ww as i64;
                        let wy1 = wy0 + wh as i64;
                        wx0 < mx1 && wx1 > mx0 && wy0 < my1 && wy1 > my0
                    });
                if on_screen {
                    let _ = main_window.set_position(tauri::PhysicalPosition::new(wx, wy));
                    let _ = main_window.set_size(tauri::PhysicalSize::new(ww, wh));
                }
            }

            #[cfg(target_os = "macos")]
            sync_macos_traffic_lights(&main_window);

            // Persist window position/size on move and resize, and close child windows
            // when the main window is truly closed (not hidden to tray).
            let db_for_close = db.clone();
            let win_for_close = main_window.clone();
            let app_for_close = app.handle().clone();
            let db_for_pos = db.clone();
            let win_for_pos = main_window.clone();
            let view_state_for_pos = Arc::clone(&window_view_state);
            main_window.on_window_event(move |event| {
                #[cfg(target_os = "macos")]
                if matches!(event, tauri::WindowEvent::Resized(_)) {
                    sync_macos_traffic_lights(&win_for_pos);
                }
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let min_to_tray = db_for_close
                            .lock()
                            .ok()
                            .and_then(|conn| settings::load(&conn).ok())
                            .map(|s| s.min_to_tray_on_close)
                            .unwrap_or(false);
                        let hide = app_for_close
                            .try_state::<std::sync::Arc<crate::focus::controller::FocusController>>()
                            .map(|f| f.should_hide_on_window_close(min_to_tray))
                            .unwrap_or(min_to_tray);
                        if hide {
                            api.prevent_close();
                            let _ = win_for_close.hide();
                        }
                    }
                    tauri::WindowEvent::Moved(pos) => {
                        if view_state_for_pos.is_timer_view() && !view_state_for_pos.is_transitioning() {
                            if let Ok(conn) = db_for_pos.lock() {
                                let _ = settings::save_setting(&conn, "window_x", &pos.x.to_string());
                                let _ = settings::save_setting(&conn, "window_y", &pos.y.to_string());
                            }
                        }
                    }
                    // Persist timer dimensions only; temporary panel sizes must not replace them.
                    tauri::WindowEvent::Resized(size)
                        if view_state_for_pos.is_timer_view() && !view_state_for_pos.is_transitioning() => {
                        if let Ok(conn) = db_for_pos.lock() {
                            let _ = settings::save_setting(&conn, "window_width", &size.width.to_string());
                            let _ = settings::save_setting(&conn, "window_height", &size.height.to_string());
                            if let Ok(pos) = win_for_pos.outer_position() {
                                let _ = settings::save_setting(&conn, "window_x", &pos.x.to_string());
                                let _ = settings::save_setting(&conn, "window_y", &pos.y.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Timer
            timer_toggle,
            timer_reset,
            timer_restart_round,
            timer_skip,
            timer_get_state,
            // Settings
            settings_get,
            settings_set,
            settings_reset_defaults,
            // Themes
            themes_list,
            appearance_publish,
            // Sessions
            sessions_clear,
            // Stats
            stats_get_detailed,
            stats_get_heatmap,
            // Window
            window_set_visibility,
            window_set_view_size,
            // Shortcuts
            shortcuts_reload,
            // Audio
            audio_set_custom,
            audio_clear_custom,
            audio_get_custom_info,
            // Notifications
            notification_show,
            // Diagnostics
            open_log_dir,
            get_log_dir,
            accessibility_trusted,
            accessibility_request,
            tray_supported,
            app_version,
            // Updater
            check_update,
            install_update,
            // Focus Sessions
            focus_apps_list,
            focus_app_icon,
            focus_snapshot_get,
            focus_profiles_get,
            focus_profile_save,
            focus_profile_delete,
            focus_profile_select,
            focus_preferences_set_unblock_breaks,
            focus_passphrase_set,
            focus_passphrase_clear,
            focus_escape_start_hold,
            focus_escape_pulse_hold,
            focus_escape_cancel_hold,
            focus_escape_submit_passphrase,
            focus_browser_setup_get,
            focus_browser_profile_require,
            focus_browsers_list,
            focus_native_host_register,
            focus_chrome_extension_install,
            focus_browser_extension_install,
            focus_browser_extension_remove,
            focus_enforcement_retry,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(focus) = app_handle.try_state::<std::sync::Arc<crate::focus::controller::FocusController>>() {
                    if focus.should_prevent_app_exit() {
                        api.prevent_exit();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    } else {
                        focus.shutdown_blocking();
                    }
                }
            }
        });
}

/// Keep native caption buttons on the 48px header's center line after AppKit layout.
#[cfg(target_os = "macos")]
pub(crate) fn sync_macos_traffic_lights(window: &tauri::WebviewWindow) {
    let native_window = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_foundation::{NSPoint, NSRect};

        let Ok(pointer) = native_window.ns_window() else { return; };
        let ns_window = pointer as *mut AnyObject;
        // SAFETY: Tauri owns this NSWindow and dispatches this closure on the AppKit thread.
        unsafe {
            let style: usize = msg_send![ns_window, styleMask];
            if style & (1 << 14) != 0 { return; } // Fullscreen uses native caption layout.
            let close: *mut AnyObject = msg_send![ns_window, standardWindowButton: 0usize];
            if close.is_null() { return; }
            let parent: *mut AnyObject = msg_send![close, superview];
            if parent.is_null() { return; }
            let container: *mut AnyObject = msg_send![parent, superview];
            if container.is_null() { return; }
            let bounds: NSRect = msg_send![close, bounds];
            let base: NSRect = msg_send![close, convertRect: bounds, toView: std::ptr::null::<AnyObject>()];
            let frame: NSRect = msg_send![ns_window, frame];
            let delta = frame.size.height - 24.0 - (base.origin.y + base.size.height / 2.0);
            if delta.abs() > 0.25 {
                let mut caption: NSRect = msg_send![container, frame];
                caption.origin.y += delta;
                caption.size.height -= delta;
                let _: () = msg_send![container, setFrame: caption];
            }
            let close_frame: NSRect = msg_send![close, frame];
            let minimize: *mut AnyObject = msg_send![ns_window, standardWindowButton: 1usize];
            if minimize.is_null() { return; }
            let minimize_frame: NSRect = msg_send![minimize, frame];
            let spacing = minimize_frame.origin.x - close_frame.origin.x;
            for index in 0..3usize {
                let button: *mut AnyObject = msg_send![ns_window, standardWindowButton: index];
                if button.is_null() { continue; }
                let rect: NSRect = msg_send![button, frame];
                let origin = NSPoint { x: 14.0 + index as f64 * spacing, y: rect.origin.y };
                let _: () = msg_send![button, setFrameOrigin: origin];
            }
        }
    }) {
        log::warn!("Could not align native caption buttons: {error}");
    }
}

pub fn matches_macos_application_menu_title(
    actual: &str,
    package_name: &str,
    product_name: Option<&str>,
) -> bool {
    let actual_trimmed = actual.trim();
    if actual_trimmed.eq_ignore_ascii_case(package_name.trim()) {
        return true;
    }
    if let Some(product) = product_name {
        if actual_trimmed.eq_ignore_ascii_case(product.trim()) {
            return true;
        }
        if actual_trimmed.trim_end_matches('.').eq_ignore_ascii_case(product.trim().trim_end_matches('.')) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_macos_application_menu_title() {
        assert!(matches_macos_application_menu_title("Grace", "pomotroid", Some("Grace")));
        assert!(matches_macos_application_menu_title("grace.", "pomotroid", Some("grace.")));
        assert!(matches_macos_application_menu_title("grace", "pomotroid", Some("grace.")));
        assert!(matches_macos_application_menu_title("pomotroid", "pomotroid", Some("Grace")));
        assert!(matches_macos_application_menu_title("Pomotroid", "pomotroid", Some("Grace")));
        assert!(!matches_macos_application_menu_title("File", "pomotroid", Some("Grace")));
        assert!(!matches_macos_application_menu_title("Edit", "pomotroid", Some("grace.")));
    }
}
