use crate::db::{current_space_id, now_millis};
use crate::models::{
    Action, DailySchedule, DailyScheduleSlot, DailyTemplateSlot, NewDailySlot, UpdateDailySlot,
    UpdateDailySlotReview,
};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

const DEFAULT_TEMPLATE: [(&str, &str); 9] = [
    ("08:30", "09:00"),
    ("09:00", "10:00"),
    ("10:00", "11:00"),
    ("11:00", "12:00"),
    ("13:30", "14:30"),
    ("14:30", "15:30"),
    ("15:30", "16:30"),
    ("16:30", "17:30"),
    ("17:30", "18:00"),
];

fn db_error(error: crate::db::DbError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}
fn valid_date(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
}
fn time_minutes(value: &str) -> Option<i32> {
    if value.len() != 5 || value.as_bytes().get(2) != Some(&b':') {
        return None;
    }
    let hour = value[0..2].parse::<i32>().ok()?;
    let minute = value[3..5].parse::<i32>().ok()?;
    if (0..24).contains(&hour) && [0, 30].contains(&minute) {
        Some(hour * 60 + minute)
    } else {
        None
    }
}
fn validate_range(start: &str, end: &str) -> Result<(), String> {
    let start_value = time_minutes(start).ok_or("时间格式必须为 HH:mm，且分钟为 00 或 30")?;
    let end_value = time_minutes(end).ok_or("时间格式必须为 HH:mm，且分钟为 00 或 30")?;
    if start_value >= end_value {
        Err("结束时间必须晚于开始时间".into())
    } else {
        Ok(())
    }
}
fn validate_date(value: &str) -> Result<(), String> {
    if valid_date(value) {
        Ok(())
    } else {
        Err("日期格式无效".into())
    }
}

fn row_to_action(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<Action> {
    Ok(Action {
        id: row.get(offset)?,
        event_id: row.get(offset + 1)?,
        event_title: row.get(offset + 2)?,
        delegated_to: row.get(offset + 3)?,
        title: row.get(offset + 4)?,
        description: row.get(offset + 5)?,
        estimated_hours: row.get(offset + 6)?,
        start_date: row.get(offset + 7)?,
        deadline: row.get(offset + 8)?,
        is_frog: row.get(offset + 9)?,
        importance: row.get(offset + 10)?,
        urgency: row.get(offset + 11)?,
        priority: row.get(offset + 12)?,
        status: row.get(offset + 13)?,
        completed_at: row.get(offset + 14)?,
        is_delegated_follow_up: row.get(offset + 15)?,
        cascade_abandoned: row.get(offset + 16)?,
        sort_order: row.get(offset + 17)?,
        created_at: row.get(offset + 18)?,
        updated_at: row.get(offset + 19)?,
    })
}

fn slot_query(conn: &Connection, list_date: &str) -> rusqlite::Result<Vec<DailyScheduleSlot>> {
    let space_id = current_space_id(conn).map_err(db_error)?;
    let mut statement = conn.prepare("SELECT s.id, s.list_date, s.start_time, s.end_time, s.action_id, s.actual_notes, s.met_expectation, s.focused, s.sort_order, a.id, a.event_id, e.title, e.delegated_to, a.title, a.description, a.estimated_hours, a.start_date, a.deadline, a.is_frog, a.importance, a.urgency, a.priority, a.status, a.completed_at, a.is_delegated_follow_up, a.cascade_abandoned, COALESCE(a.sort_order, 0), a.created_at, a.updated_at FROM daily_schedule_slots s LEFT JOIN actions a ON a.id = s.action_id AND a.space_id = s.space_id AND a.deleted_at IS NULL LEFT JOIN events e ON e.id = a.event_id AND e.space_id = a.space_id AND e.deleted_at IS NULL WHERE s.space_id = ?1 AND s.list_date = ?2 ORDER BY s.start_time, s.id")?;
    let result = statement
        .query_map(params![space_id, list_date], |row| {
            Ok(DailyScheduleSlot {
                id: row.get(0)?,
                list_date: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                action_id: row.get(4)?,
                actual_notes: row.get(5)?,
                met_expectation: row.get(6)?,
                focused: row.get(7)?,
                sort_order: row.get(8)?,
                action: if row.get::<_, Option<i64>>(9)?.is_some() {
                    Some(row_to_action(row, 9)?)
                } else {
                    None
                },
            })
        })?
        .collect();
    result
}

fn ensure_template(conn: &Connection, space_id: &str) -> rusqlite::Result<Vec<DailyTemplateSlot>> {
    let mut statement = conn.prepare("SELECT start_time, end_time, sort_order FROM daily_schedule_templates WHERE space_id = ?1 ORDER BY sort_order, id")?;
    let mut slots: Vec<DailyTemplateSlot> = statement
        .query_map([space_id], |row| {
            Ok(DailyTemplateSlot {
                start_time: row.get(0)?,
                end_time: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let template_initialized: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM daily_schedule_template_meta WHERE space_id = ?1)",
        [space_id],
        |row| row.get(0),
    )?;
    if slots.is_empty() && !template_initialized {
        slots = DEFAULT_TEMPLATE
            .iter()
            .enumerate()
            .map(|(index, (start_time, end_time))| DailyTemplateSlot {
                start_time: (*start_time).into(),
                end_time: (*end_time).into(),
                sort_order: index as i64,
            })
            .collect();
    }
    Ok(slots)
}

fn schedule(conn: &Connection, list_date: &str) -> rusqlite::Result<DailySchedule> {
    Ok(DailySchedule {
        list_date: list_date.into(),
        slots: slot_query(conn, list_date)?,
    })
}
fn overlap_exists(
    conn: &Connection,
    space_id: &str,
    list_date: &str,
    start: &str,
    end: &str,
    exclude_id: Option<i64>,
) -> rusqlite::Result<Option<(String, String)>> {
    let excluded = exclude_id.unwrap_or(-1);
    conn.query_row("SELECT start_time, end_time FROM daily_schedule_slots WHERE space_id = ?1 AND list_date = ?2 AND id != ?3 AND start_time < ?5 AND end_time > ?4 ORDER BY start_time LIMIT 1", params![space_id, list_date, excluded, start, end], |row| Ok((row.get(0)?, row.get(1)?))).optional()
}
fn ensure_day(conn: &Connection, list_date: &str) -> Result<(), String> {
    validate_date(list_date)?;
    let space_id = current_space_id(conn).map_err(|error| error.to_string())?;
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM daily_schedule_days WHERE space_id = ?1 AND list_date = ?2)", params![space_id, list_date], |row| row.get(0)).map_err(|error| error.to_string())?;
    if exists {
        return Ok(());
    }
    let template = ensure_template(conn, &space_id).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO daily_schedule_days (space_id, list_date, created_at) VALUES (?1, ?2, ?3)",
        params![space_id, list_date, timestamp],
    )
    .map_err(|error| error.to_string())?;
    for slot in template {
        tx.execute("INSERT INTO daily_schedule_slots (space_id, list_date, start_time, end_time, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)", params![space_id, list_date, slot.start_time, slot.end_time, slot.sort_order, timestamp]).map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_daily_schedule(
    state: State<'_, AppState>,
    list_date: String,
) -> Result<DailySchedule, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    ensure_day(&conn, &list_date)?;
    schedule(&conn, &list_date).map_err(|error| error.to_string())
}
#[tauri::command]
pub fn initialize_daily_schedule(
    state: State<'_, AppState>,
    list_date: String,
) -> Result<DailySchedule, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    ensure_day(&conn, &list_date)?;
    schedule(&conn, &list_date).map_err(|error| error.to_string())
}
#[tauri::command]
pub fn create_daily_slot(
    state: State<'_, AppState>,
    payload: NewDailySlot,
) -> Result<DailyScheduleSlot, String> {
    validate_date(&payload.list_date)?;
    validate_range(&payload.start_time, &payload.end_time)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    ensure_day(&conn, &payload.list_date)?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    if let Some((start, end)) = overlap_exists(
        &conn,
        &space_id,
        &payload.list_date,
        &payload.start_time,
        &payload.end_time,
        None,
    )
    .map_err(|error| error.to_string())?
    {
        return Err(format!("时间段与 {start}-{end} 重叠"));
    }
    let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM daily_schedule_slots WHERE space_id = ?1 AND list_date = ?2", params![space_id, payload.list_date], |row| row.get(0)).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    conn.execute("INSERT INTO daily_schedule_slots (space_id, list_date, start_time, end_time, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)", params![space_id, payload.list_date, payload.start_time, payload.end_time, max_order, timestamp]).map_err(|error| error.to_string())?;
    let id = conn.last_insert_rowid();
    slot_query(&conn, &payload.list_date)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|slot| slot.id == id)
        .ok_or_else(|| "创建时间段后读取失败".into())
}
#[tauri::command]
pub fn update_daily_slot(
    state: State<'_, AppState>,
    payload: UpdateDailySlot,
) -> Result<DailyScheduleSlot, String> {
    validate_range(&payload.start_time, &payload.end_time)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let list_date: String = conn
        .query_row(
            "SELECT list_date FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2",
            params![payload.id, space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if let Some((start, end)) = overlap_exists(
        &conn,
        &space_id,
        &list_date,
        &payload.start_time,
        &payload.end_time,
        Some(payload.id),
    )
    .map_err(|error| error.to_string())?
    {
        return Err(format!("时间段与 {start}-{end} 重叠"));
    }
    let changed = conn.execute("UPDATE daily_schedule_slots SET start_time = ?1, end_time = ?2, updated_at = ?3 WHERE id = ?4 AND space_id = ?5", params![payload.start_time, payload.end_time, now_millis(), payload.id, space_id]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("时间段不存在".into());
    }
    slot_query(&conn, &list_date)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|slot| slot.id == payload.id)
        .ok_or_else(|| "更新时间段后读取失败".into())
}
#[tauri::command]
pub fn split_daily_slot(
    state: State<'_, AppState>,
    list_date: String,
    slot_id: i64,
) -> Result<Vec<DailyScheduleSlot>, String> {
    validate_date(&list_date)?;
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let (start_time, end_time, sort_order): (String, String, i64) = conn
        .query_row(
            "SELECT start_time, end_time, sort_order FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2 AND list_date = ?3",
            params![slot_id, space_id, list_date],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "时间段不存在".to_string())?;
    let start = time_minutes(&start_time).ok_or("时间格式无效")?;
    let end = time_minutes(&end_time).ok_or("时间格式无效")?;
    if end - start <= 30 {
        return Err("时间段必须超过 30 分钟才能拆分".into());
    }
    let split_minutes = start + 30;
    let split_time = format!("{:02}:{:02}", split_minutes / 60, split_minutes % 60);
    let timestamp = now_millis();
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let changed = tx.execute(
        "UPDATE daily_schedule_slots SET end_time = ?1, updated_at = ?2 WHERE id = ?3 AND space_id = ?4 AND list_date = ?5",
        params![split_time, timestamp, slot_id, space_id, list_date],
    ).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("时间段不存在".into());
    }
    tx.execute(
        "INSERT INTO daily_schedule_slots (space_id, list_date, start_time, end_time, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![space_id, list_date, split_time, end_time, sort_order + 1, timestamp],
    ).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    slot_query(&conn, &list_date)
        .map_err(|error| error.to_string())
        .map(|slots| {
            slots
                .into_iter()
                .filter(|slot| {
                    slot.id == slot_id
                        || (slot.start_time == split_time && slot.end_time == end_time)
                })
                .collect()
        })
}
#[tauri::command]
pub fn delete_daily_slot(
    state: State<'_, AppState>,
    list_date: String,
    slot_id: i64,
) -> Result<(), String> {
    validate_date(&list_date)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let action_id: Option<i64> = conn.query_row("SELECT action_id FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2 AND list_date = ?3", params![slot_id, space_id, list_date], |row| row.get(0)).optional().map_err(|error| error.to_string())?.flatten();
    if action_id.is_some() {
        return Err("时间段已安排行动，请先移除行动后再删除".into());
    }
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2 AND list_date = ?3)", params![slot_id, space_id, list_date], |row| row.get(0)).map_err(|error| error.to_string())?;
    if !exists {
        return Err("时间段不存在".into());
    }
    let changed = conn
        .execute(
            "DELETE FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2 AND list_date = ?3",
            params![slot_id, space_id, list_date],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("时间段不存在".into());
    }
    Ok(())
}
#[tauri::command]
pub fn assign_daily_slot_action(
    state: State<'_, AppState>,
    slot_id: i64,
    action_id: Option<i64>,
) -> Result<DailyScheduleSlot, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let list_date: String = conn
        .query_row(
            "SELECT list_date FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2",
            params![slot_id, space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if let Some(action_id) = action_id {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM actions WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL)", params![action_id, space_id], |row| row.get(0)).map_err(|error| error.to_string())?;
        if !exists {
            return Err("行动不存在".into());
        }
    }
    let changed = conn.execute("UPDATE daily_schedule_slots SET action_id = ?1, updated_at = ?2 WHERE id = ?3 AND space_id = ?4", params![action_id, now_millis(), slot_id, space_id]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("时间段不存在".into());
    }
    slot_query(&conn, &list_date)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|slot| slot.id == slot_id)
        .ok_or_else(|| "更新行动后读取失败".into())
}
#[tauri::command]
pub fn update_daily_slot_review(
    state: State<'_, AppState>,
    payload: UpdateDailySlotReview,
) -> Result<DailyScheduleSlot, String> {
    if payload.actual_notes.trim().is_empty() {
        return Err("实际工作情况不能为空".into());
    }
    if ![0, 1].contains(&payload.met_expectation) || ![0, 1].contains(&payload.focused) {
        return Err("复盘选项无效".into());
    }
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let list_date: String = conn
        .query_row(
            "SELECT list_date FROM daily_schedule_slots WHERE id = ?1 AND space_id = ?2",
            params![payload.id, space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let changed = conn.execute("UPDATE daily_schedule_slots SET actual_notes = ?1, met_expectation = ?2, focused = ?3, updated_at = ?4 WHERE id = ?5 AND space_id = ?6", params![payload.actual_notes.trim(), payload.met_expectation, payload.focused, now_millis(), payload.id, space_id]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("时间段不存在".into());
    }
    slot_query(&conn, &list_date)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|slot| slot.id == payload.id)
        .ok_or_else(|| "保存复盘后读取失败".into())
}
#[tauri::command]
pub fn get_daily_template(state: State<'_, AppState>) -> Result<Vec<DailyTemplateSlot>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    ensure_template(&conn, &space_id).map_err(|error| error.to_string())
}
#[tauri::command]
pub fn save_daily_template(
    state: State<'_, AppState>,
    slots: Vec<DailyTemplateSlot>,
) -> Result<Vec<DailyTemplateSlot>, String> {
    for slot in &slots {
        validate_range(&slot.start_time, &slot.end_time)?;
    }
    for pair in slots.windows(2) {
        if pair[0].end_time > pair[1].start_time {
            return Err("模板时间段不能重叠".into());
        }
    }
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "DELETE FROM daily_schedule_templates WHERE space_id = ?1",
        params![space_id],
    )
    .map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    tx.execute("INSERT INTO daily_schedule_template_meta (space_id, updated_at) VALUES (?1, ?2) ON CONFLICT(space_id) DO UPDATE SET updated_at = excluded.updated_at", params![space_id, timestamp]).map_err(|error| error.to_string())?;
    for (index, slot) in slots.iter().enumerate() {
        tx.execute("INSERT INTO daily_schedule_templates (space_id, start_time, end_time, sort_order, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![space_id, slot.start_time, slot.end_time, index as i64, timestamp]).map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(slots
        .into_iter()
        .enumerate()
        .map(|(index, mut slot)| {
            slot.sort_order = index as i64;
            slot
        })
        .collect())
}
