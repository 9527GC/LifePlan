use crate::db::backup::create_startup_backup;
use crate::models::StartupNotice;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_startup_notice(state: State<'_, AppState>) -> Result<Option<StartupNotice>, String> {
    let notice = state
        .startup_notice
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(notice.clone())
}

#[tauri::command]
pub fn retry_startup_backup(state: State<'_, AppState>) -> Result<(), String> {
    create_startup_backup(&state.db_path).map_err(|error| error.to_string())?;
    let mut notice = state
        .startup_notice
        .lock()
        .map_err(|error| error.to_string())?;
    if notice
        .as_ref()
        .is_some_and(|item| item.kind == "backup_warning")
    {
        *notice = None;
    }
    Ok(())
}
