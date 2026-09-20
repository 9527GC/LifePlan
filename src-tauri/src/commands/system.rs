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

/// 将文本内容保存到系统下载目录，返回完整文件路径。
#[tauri::command]
pub fn save_download_text_file(filename: String, content: String) -> Result<String, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .or_else(|| crate::db::db_path().ok().and_then(|path| path.parent().map(|parent| parent.to_path_buf())))
        .ok_or_else(|| "无法定位保存目录".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建保存目录失败：{error}"))?;
    let safe_name = filename.replace(['/', '\\'], "_");
    let path = dir.join(safe_name);
    std::fs::write(&path, content.as_bytes()).map_err(|error| format!("保存文件失败：{error}"))?;
    Ok(path.display().to_string())
}
