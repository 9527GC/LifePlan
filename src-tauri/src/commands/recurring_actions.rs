use crate::commands::calculate_priority;
use crate::db::{current_space_id, new_uuid, now_millis};
use crate::models::{
    Action, NewRecurringAction, RecurringAction, ReorderRecurringActions, UpdateRecurringAction,
};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use tauri::State;

fn row_to_recurring_action(row: &rusqlite::Row) -> rusqlite::Result<RecurringAction> {
    Ok(RecurringAction {
        id: row.get(0)?,
        title: row.get(1)?,
        estimated_hours: row.get(2)?,
        is_frog: row.get(3)?,
        importance: row.get(4)?,
        urgency: row.get(5)?,
        priority: row.get(6)?,
        frequency_unit: row.get(7)?,
        frequency_count: row.get(8)?,
        sort_order: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn list_recurring_actions(conn: &Connection) -> rusqlite::Result<Vec<RecurringAction>> {
    let space_id = current_space_id(conn)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut statement = conn.prepare(
        "SELECT id, title, estimated_hours, is_frog, importance, urgency, priority,
                frequency_unit, frequency_count, sort_order, created_at, updated_at
         FROM recurring_actions
         WHERE space_id = ?1 AND deleted_at IS NULL
         ORDER BY sort_order, id",
    )?;
    statement
        .query_map([space_id], row_to_recurring_action)
        .and_then(Iterator::collect)
}

fn valid_hours(hours: f64) -> bool {
    [0.5, 1.0, 1.5, 2.0].contains(&hours)
}

fn validate_payload(payload: &NewRecurringAction) -> Result<(), String> {
    if payload.title.trim().is_empty() {
        return Err("重复行动标题不能为空".into());
    }
    if !valid_hours(payload.estimated_hours) {
        return Err("单次耗时必须为 30 分钟、1 小时、1.5 小时或 2 小时".into());
    }
    if !matches!(
        payload.frequency_unit.as_str(),
        "daily" | "weekly" | "monthly"
    ) {
        return Err("频率类型无效".into());
    }
    if !(1..=99).contains(&payload.frequency_count) {
        return Err("频率次数必须为 1 到 99".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_recurring_actions(state: State<'_, AppState>) -> Result<Vec<RecurringAction>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    list_recurring_actions(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_recurring_action(
    state: State<'_, AppState>,
    payload: NewRecurringAction,
) -> Result<RecurringAction, String> {
    validate_payload(&payload)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM recurring_actions WHERE space_id = ?1 AND deleted_at IS NULL",
            params![space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let priority = calculate_priority(payload.importance, payload.urgency);
    conn.execute(
        "INSERT INTO recurring_actions (space_id, sync_id, title, estimated_hours, is_frog, importance, urgency, priority, frequency_unit, frequency_count, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            space_id,
            new_uuid(),
            payload.title.trim(),
            payload.estimated_hours,
            payload.is_frog,
            payload.importance,
            payload.urgency,
            priority,
            payload.frequency_unit,
            payload.frequency_count,
            sort_order,
            timestamp,
        ],
    )
    .map_err(|error| error.to_string())?;
    let id = conn.last_insert_rowid();
    list_recurring_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "创建重复行动后读取失败".into())
}

#[tauri::command]
pub fn update_recurring_action(
    state: State<'_, AppState>,
    payload: UpdateRecurringAction,
) -> Result<RecurringAction, String> {
    let values = NewRecurringAction {
        title: payload.title,
        estimated_hours: payload.estimated_hours,
        is_frog: payload.is_frog,
        importance: payload.importance,
        urgency: payload.urgency,
        frequency_unit: payload.frequency_unit,
        frequency_count: payload.frequency_count,
    };
    validate_payload(&values)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let priority = calculate_priority(values.importance, values.urgency);
    let changed = conn
        .execute(
            "UPDATE recurring_actions
             SET title = ?1, estimated_hours = ?2, is_frog = ?3, importance = ?4,
                 urgency = ?5, priority = ?6, frequency_unit = ?7, frequency_count = ?8,
                 updated_at = ?9
             WHERE id = ?10 AND space_id = ?11 AND deleted_at IS NULL",
            params![
                values.title.trim(),
                values.estimated_hours,
                values.is_frog,
                values.importance,
                values.urgency,
                priority,
                values.frequency_unit,
                values.frequency_count,
                timestamp,
                payload.id,
                space_id,
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("重复行动不存在".into());
    }
    list_recurring_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|item| item.id == payload.id)
        .ok_or_else(|| "更新重复行动后读取失败".into())
}

#[tauri::command]
pub fn delete_recurring_action(
    state: State<'_, AppState>,
    recurring_action_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE recurring_actions SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
            params![now_millis(), recurring_action_id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("重复行动不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_recurring_actions(
    state: State<'_, AppState>,
    payload: ReorderRecurringActions,
) -> Result<Vec<RecurringAction>, String> {
    let mut seen = HashSet::with_capacity(payload.action_ids.len());
    if payload.action_ids.iter().any(|id| !seen.insert(*id)) {
        return Err("重复行动排序列表包含重复项目".into());
    }
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let existing: Vec<i64> = {
        let mut statement = tx
            .prepare("SELECT id FROM recurring_actions WHERE space_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, id")
            .map_err(|error| error.to_string())?;
        let ids = statement
            .query_map([&space_id], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<i64>>>()
            .map_err(|error| error.to_string())?;
        ids
    };
    if existing.len() != payload.action_ids.len() || existing.iter().any(|id| !seen.contains(id)) {
        return Err("重复行动排序列表已发生变化，请刷新后重试".into());
    }
    let timestamp = now_millis();
    for (index, id) in payload.action_ids.iter().enumerate() {
        tx.execute(
            "UPDATE recurring_actions SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND space_id = ?4 AND deleted_at IS NULL",
            params![index as i64, timestamp, id, space_id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    list_recurring_actions(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_action_from_recurring(
    state: State<'_, AppState>,
    recurring_action_id: i64,
) -> Result<Action, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let template: (String, f64, i32, i32, i32) = conn
        .query_row(
            "SELECT title, estimated_hours, is_frog, importance, urgency FROM recurring_actions WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![recurring_action_id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "重复行动不存在".to_string())?;
    let timestamp = now_millis();
    conn.execute(
        "INSERT INTO actions (space_id, sync_id, title, estimated_hours, is_frog, importance, urgency, priority, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![space_id, new_uuid(), template.0, template.1, template.2, template.3, template.4, calculate_priority(template.3, template.4), timestamp],
    )
    .map_err(|error| error.to_string())?;
    let action_id = conn.last_insert_rowid();
    super::actions::list_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| "生成行动后读取失败".into())
}
