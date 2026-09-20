use crate::commands::{
    actions, analytics, daily_list, daily_schedule, events, pomodoro, projects, recurring_actions,
    rewards, system,
};
use crate::db::init_db;
pub use crate::db::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const OPEN_WINDOW_MENU_ID: &str = "open-window";
const QUIT_MENU_ID: &str = "quit";

pub mod commands;
pub mod db;
pub mod models;

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_minimized()? {
            window.unminimize()?;
        }
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

/// 发布页地址：当数据库版本比当前程序更新（程序版本过低）时引导用户去更新。
const RELEASE_PAGE_URL: &str = "https://github.com/9527GC/LifePlan/releases";

/// 使用系统默认浏览器打开 URL。
/// 此处数据库初始化已失败、尚未构建 AppHandle，无法使用 tauri-plugin-opener，
/// 因此直接调用系统命令跨平台打开。
fn open_in_default_browser(url: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 隐藏 cmd 控制台窗口，避免 GUI 程序闪出黑框。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

/// 数据库初始化失败时弹出原生提示框。
/// 若因数据库版本高于程序支持版本（旧版打不开新版数据）导致，则提示"当前版本过低"并提供
/// "去更新"按钮，点击后打开浏览器跳转到发布页；其余情况以错误框兜底。
fn handle_startup_db_error(error: &db::DbError) {
    eprintln!("数据库初始化失败：{error}");
    if matches!(error, db::DbError::SchemaTooNew { .. }) {
        // 单个自定义按钮"去更新"（Windows 依赖 rfd 的 common-controls-v6 特性）。
        let result = rfd::MessageDialog::new()
            .set_title("LifePlan")
            .set_description("当前版本过低，请更新到最新版本。")
            .set_buttons(rfd::MessageButtons::OkCustom("去更新".to_string()))
            .show();
        // 只有点击"去更新"（非关闭/取消）时才打开浏览器。
        if !matches!(result, rfd::MessageDialogResult::Cancel) {
            open_in_default_browser(RELEASE_PAGE_URL);
        }
    } else {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("LifePlan")
            .set_description(format!("数据库初始化失败：{error}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = match init_db() {
        Ok(state) => state,
        Err(error) => {
            // 数据库无法初始化（如数据库被更高版本程序前滚迁移）时，弹出原生提示框引导处理，
            // 避免旧版本因 user_version 过高而直接 panic 秒退。
            handle_startup_db_error(&error);
            std::process::exit(1);
        }
    };

    let app = tauri::Builder::default()
        // 单实例守卫：当用户重复点击快捷方式时，不再启动新进程，
        // 而是聚焦已有实例的主窗口（若处于隐藏/最小化状态则唤起），避免出现多窗口、多托盘。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = show_main_window(app) {
                eprintln!("唤起已有窗口失败：{error}");
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .manage(app_state)
        .setup(|app| {
            let open_window =
                MenuItem::with_id(app, OPEN_WINDOW_MENU_ID, "打开窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, QUIT_MENU_ID, "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_window, &quit])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("未找到应用图标".into()))?;

            TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon(icon)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    OPEN_WINDOW_MENU_ID => {
                        if let Err(error) = show_main_window(app) {
                            eprintln!("显示主窗口失败：{error}");
                        }
                    }
                    QUIT_MENU_ID => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Err(error) = show_main_window(tray.app_handle()) {
                            eprintln!("显示主窗口失败：{error}");
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let window_for_close_event = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Err(error) = window_for_close_event.hide() {
                            eprintln!("隐藏主窗口失败：{error}");
                        }
                    }
                });
            }

            show_main_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            analytics::record_analytics_event,
            analytics::export_analytics_events,
            events::get_events,
            events::create_event,
            events::update_event,
            events::delete_event,
            events::process_event,
            events::complete_event,
            events::restore_event,
            projects::get_projects,
            projects::update_project,
            projects::delete_project,
            projects::complete_project,
            projects::abandon_project,
            actions::get_actions,
            actions::create_action,
            actions::update_action,
            actions::complete_action,
            actions::reorder_project_actions,
            actions::restore_action,
            actions::delete_action,
            actions::complete_delegated_follow_up,
            daily_list::get_daily_list,
            daily_list::add_daily_list_item,
            daily_list::remove_daily_list_item,
            daily_list::reorder_daily_list,
            daily_schedule::get_daily_schedule,
            daily_schedule::initialize_daily_schedule,
            daily_schedule::create_daily_slot,
            daily_schedule::update_daily_slot,
            daily_schedule::split_daily_slot,
            daily_schedule::delete_daily_slot,
            daily_schedule::assign_daily_slot_action,
            daily_schedule::update_daily_slot_review,
            daily_schedule::get_daily_template,
            daily_schedule::save_daily_template,
            pomodoro::get_pomodoro_status,
            pomodoro::start_pomodoro,
            pomodoro::finish_pomodoro,
            pomodoro::award_pomodoro_points,
            pomodoro::get_pomodoro_records,
            rewards::get_rewards_overview,
            rewards::create_reward,
            rewards::update_reward,
            rewards::archive_reward,
            rewards::exchange_reward,
            rewards::save_reward_checkin,
            rewards::get_reward_checkin,
            rewards::save_reward_poster,
            recurring_actions::get_recurring_actions,
            recurring_actions::create_recurring_action,
            recurring_actions::update_recurring_action,
            recurring_actions::reorder_recurring_actions,
            recurring_actions::create_action_from_recurring,
            system::get_startup_notice,
            system::retry_startup_backup,
            system::save_download_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // macOS：主窗口被关闭（实际为隐藏）后，点击 Dock 图标会触发 Reopen 事件。
    // 若此时没有可见窗口，则重新唤起主窗口，修复"更新后点 Dock 图标窗口出不来、
    // 必须退出重开才能打开"的问题。
    app.run(|app_handle, event| {
        let _ = app_handle;
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
            if !has_visible_windows {
                if let Err(error) = show_main_window(app_handle) {
                    eprintln!("通过 Dock 唤起主窗口失败：{error}");
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = event;
    });
}