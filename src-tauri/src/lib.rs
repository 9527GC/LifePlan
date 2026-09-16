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
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = init_db().expect("failed to initialize database");

    tauri::Builder::default()
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
            recurring_actions::get_recurring_actions,
            recurring_actions::create_recurring_action,
            recurring_actions::update_recurring_action,
            recurring_actions::reorder_recurring_actions,
            recurring_actions::create_action_from_recurring,
            system::get_startup_notice,
            system::retry_startup_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

