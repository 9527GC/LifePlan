use crate::db::{current_space_id, now_millis};
use crate::AppState;
use chrono::NaiveDate;
use rusqlite::{params, OptionalExtension};
use tauri::State;

#[tauri::command]
pub fn get_work_log(state: State<'_, AppState>, date: String) -> Result<Option<String>, String> {
    if NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err() {
        return Err("日期格式无效".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT content FROM work_logs WHERE space_id=?1 AND log_date=?2",
        params![space, date],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_work_log(
    state: State<'_, AppState>,
    date: String,
    content: String,
    import_only: bool,
) -> Result<(), String> {
    if NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err() {
        return Err("日期格式无效".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    write_log(&conn, &space, &date, &content, import_only)
}

fn write_log(
    conn: &rusqlite::Connection,
    space: &str,
    date: &str,
    content: &str,
    import_only: bool,
) -> Result<(), String> {
    let sql = if import_only {
        "INSERT INTO work_logs(space_id,log_date,content,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(space_id,log_date) DO NOTHING"
    } else {
        "INSERT INTO work_logs(space_id,log_date,content,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(space_id,log_date) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at"
    };
    conn.execute(sql, params![space, date, content, now_millis()])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn 日志按日期空间隔离且旧记录不覆盖新内容() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE work_logs(space_id TEXT, log_date TEXT, content TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY(space_id,log_date));").unwrap();
        write_log(&conn, "空间一", "2026-10-12", "原日志", false).unwrap();
        write_log(&conn, "空间一", "2026-10-12", "新日志", false).unwrap();
        write_log(&conn, "空间一", "2026-10-12", "旧缓存", true).unwrap();
        write_log(&conn, "空间一", "2026-10-11", "历史日志", true).unwrap();
        write_log(&conn, "空间二", "2026-10-12", "其他空间", false).unwrap();
        let text: String = conn
            .query_row(
                "SELECT content FROM work_logs WHERE space_id='空间一' AND log_date='2026-10-12'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(text, "新日志");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM work_logs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
        write_log(&conn, "空间一", "2026-10-12", "", false).unwrap();
        write_log(&conn, "空间一", "2026-10-12", "旧缓存", true).unwrap();
        let text: String = conn
            .query_row(
                "SELECT content FROM work_logs WHERE space_id='空间一' AND log_date='2026-10-12'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(text, "");
    }
}
