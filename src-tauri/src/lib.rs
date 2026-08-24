use crate::commands::{actions, events, projects, system};
use crate::db::init_db;
pub use crate::db::AppState;
use tauri::Manager;

pub mod commands;
pub mod db;
pub mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = init_db().expect("failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                window.set_focus()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            system::get_startup_notice,
            system::retry_startup_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
