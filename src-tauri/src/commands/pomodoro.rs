use crate::db::{current_space_id, now_millis};
use crate::models::{PomodoroRecord, PomodoroStatus};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

const BLOCK_SECONDS: i64 = 30 * 60;

fn completed_blocks(actual_seconds: i64, planned_seconds: i64, include_current: bool) -> i32 {
    let rounds = (planned_seconds / BLOCK_SECONDS).max(1);
    let blocks = if include_current {
        ((actual_seconds.max(0) + BLOCK_SECONDS - 1) / BLOCK_SECONDS).max(1)
    } else {
        actual_seconds.max(0) / BLOCK_SECONDS
    };
    blocks.min(rounds) as i32
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<PomodoroRecord> {
    Ok(PomodoroRecord {
        id: row.get(0)?,
        action_id: row.get(1)?,
        action_title: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        planned_seconds: row.get(5)?,
        actual_seconds: row.get(6)?,
        status: row.get(7)?,
        interrupt_type: row.get(8)?,
        interrupt_reason: row.get(9)?,
        points_awarded: row.get(10)?,
    })
}

fn active_record(conn: &Connection, space_id: &str) -> rusqlite::Result<Option<PomodoroRecord>> {
    conn.query_row(
        "SELECT r.id, r.action_id, a.title, r.start_time, r.end_time, r.planned_seconds, r.actual_seconds, r.status, r.interrupt_type, r.interrupt_reason, r.points_awarded FROM pomodoro_records r LEFT JOIN actions a ON a.id = r.action_id AND a.space_id = r.space_id WHERE r.space_id = ?1 AND r.status = -1 ORDER BY r.id DESC LIMIT 1",
        [space_id], row_to_record,
    ).optional()
}

fn points(conn: &Connection, space_id: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(total_points, 0) FROM user_points WHERE space_id = ?1",
        [space_id],
        |row| row.get(0),
    )
    .optional()
    .map(|v| v.unwrap_or(0))
}

#[tauri::command]
pub fn get_pomodoro_status(state: State<'_, AppState>) -> Result<PomodoroStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    Ok(PomodoroStatus {
        active: active_record(&conn, &space).map_err(|e| e.to_string())?,
        total_points: points(&conn, &space).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn start_pomodoro(
    state: State<'_, AppState>,
    action_id: Option<i64>,
    planned_seconds: i64,
) -> Result<PomodoroRecord, String> {
    if ![1800, 3600, 5400, 7200, 9000, 10800].contains(&planned_seconds) {
        return Err("专注时长必须为 30、60、90、120、150 或 180 分钟".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    if active_record(&conn, &space)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("已有正在进行的番茄钟，请先结束当前计时".into());
    }
    if let Some(id) = action_id {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM actions WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL)", params![id, space], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !exists {
            return Err("关联行动不存在".into());
        }
    }
    let now = now_millis();
    conn.execute("INSERT INTO pomodoro_records (space_id, action_id, start_time, planned_seconds, status, created_at) VALUES (?1, ?2, ?3, ?4, -1, ?3)", params![space, action_id, now, planned_seconds]).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row("SELECT r.id, r.action_id, a.title, r.start_time, r.end_time, r.planned_seconds, r.actual_seconds, r.status, r.interrupt_type, r.interrupt_reason, r.points_awarded FROM pomodoro_records r LEFT JOIN actions a ON a.id = r.action_id AND a.space_id = r.space_id WHERE r.id = ?1", [id], row_to_record).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn award_pomodoro_points(
    state: State<'_, AppState>,
    record_id: i64,
) -> Result<PomodoroStatus, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let (start, planned, status, already_awarded): (i64, i64, i32, i32) = tx
        .query_row(
            "SELECT start_time, planned_seconds, status, points_awarded FROM pomodoro_records WHERE id = ?1 AND space_id = ?2",
            params![record_id, space],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    if status != -1 {
        return Ok(PomodoroStatus {
            active: active_record(&tx, &space).map_err(|e| e.to_string())?,
            total_points: points(&tx, &space).map_err(|e| e.to_string())?,
        });
    }
    let actual = ((now_millis() - start) / 1000).max(0);
    let target = completed_blocks(actual, planned, false);
    let award = (target - already_awarded).max(0);
    if award > 0 {
        tx.execute(
            "UPDATE pomodoro_records SET points_awarded = ?1 WHERE id = ?2 AND space_id = ?3",
            params![target, record_id, space],
        )
        .map_err(|e| e.to_string())?;
        let now = now_millis();
        tx.execute(
            "INSERT INTO user_points (space_id, total_points, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(space_id) DO UPDATE SET total_points = user_points.total_points + excluded.total_points, updated_at = excluded.updated_at",
            params![space, award, now],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(PomodoroStatus {
        active: active_record(&conn, &space).map_err(|e| e.to_string())?,
        total_points: points(&conn, &space).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn finish_pomodoro(
    state: State<'_, AppState>,
    record_id: i64,
    status: i32,
    interrupt_type: Option<i32>,
    interrupt_reason: Option<String>,
) -> Result<PomodoroStatus, String> {
    if ![0, 1, 2].contains(&status) {
        return Err("番茄状态无效".into());
    }
    if status == 2 && ![Some(0), Some(1), Some(2)].contains(&interrupt_type) {
        return Err("请选择打断类型".into());
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let (start, planned, old_status, already_awarded): (i64, i64, i32, i32) = tx
        .query_row(
            "SELECT start_time, planned_seconds, status, points_awarded FROM pomodoro_records WHERE id = ?1 AND space_id = ?2",
            params![record_id, space],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    if old_status != -1 {
        return Err("该番茄钟已经结束".into());
    }
    let end = now_millis();
    let actual = ((end - start) / 1000).max(0);
    let target = completed_blocks(actual, planned, status == 1);
    let award = (target - already_awarded).max(0);
    tx.execute("UPDATE pomodoro_records SET end_time = ?1, actual_seconds = ?2, status = ?3, interrupt_type = ?4, interrupt_reason = ?5, points_awarded = ?6 WHERE id = ?7 AND space_id = ?8", params![end, actual, status, interrupt_type, interrupt_reason, target, record_id, space]).map_err(|e| e.to_string())?;
    if award > 0 {
        tx.execute("INSERT INTO user_points (space_id, total_points, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(space_id) DO UPDATE SET total_points = user_points.total_points + excluded.total_points, updated_at = excluded.updated_at", params![space, award, end]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(PomodoroStatus {
        active: None,
        total_points: points(&conn, &space).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn get_pomodoro_records(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<PomodoroRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let mut stmt = conn.prepare("SELECT r.id, r.action_id, a.title, r.start_time, r.end_time, r.planned_seconds, r.actual_seconds, r.status, r.interrupt_type, r.interrupt_reason, r.points_awarded FROM pomodoro_records r LEFT JOIN actions a ON a.id = r.action_id AND a.space_id = r.space_id WHERE r.space_id = ?1 ORDER BY r.start_time DESC LIMIT ?2").map_err(|e| e.to_string())?;
    {
        let rows = stmt
            .query_map(params![space, limit], row_to_record)
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>();
        rows.map_err(|e| e.to_string())
    }
}
