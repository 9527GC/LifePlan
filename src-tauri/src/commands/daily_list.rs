use crate::db::{current_space_id, now_millis};
use crate::models::{Action, AddDailyListItem, DailyListItem, ReorderDailyList};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use tauri::State;

fn row_to_action(row: &rusqlite::Row, offset: usize) -> rusqlite::Result<Action> {
    Ok(Action {
        id: row.get(offset)?,
        event_id: row.get(offset + 1)?,
        project_id: row.get(offset + 2)?,
        event_title: row.get(offset + 3)?,
        project_title: row.get(offset + 4)?,
        delegated_to: row.get(offset + 5)?,
        title: row.get(offset + 6)?,
        description: row.get(offset + 7)?,
        estimated_hours: row.get(offset + 8)?,
        start_date: row.get(offset + 9)?,
        deadline: row.get(offset + 10)?,
        is_frog: row.get(offset + 11)?,
        importance: row.get(offset + 12)?,
        urgency: row.get(offset + 13)?,
        priority: row.get(offset + 14)?,
        status: row.get(offset + 15)?,
        completed_at: row.get(offset + 16)?,
        is_delegated_follow_up: row.get(offset + 17)?,
        cascade_abandoned: row.get(offset + 18)?,
        sort_order: row.get(offset + 19)?,
        created_at: row.get(offset + 20)?,
        updated_at: row.get(offset + 21)?,
    })
}

fn list_items(conn: &Connection, list_date: &str) -> rusqlite::Result<Vec<DailyListItem>> {
    let space_id = current_space_id(conn)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut statement = conn.prepare(
        "SELECT d.id, d.action_id, d.list_date, d.sort_order,
                a.id, a.event_id, a.project_id, e.title, p.title, e.delegated_to,
                a.title, a.description, a.estimated_hours, a.start_date, a.deadline,
                a.is_frog, COALESCE(p.importance, a.importance), COALESCE(p.urgency, a.urgency),
                COALESCE(p.priority, a.priority), a.status, a.completed_at,
                a.is_delegated_follow_up, a.cascade_abandoned, COALESCE(a.sort_order, 0),
                a.created_at, a.updated_at
         FROM daily_list_items d
         JOIN actions a ON a.id = d.action_id AND a.space_id = d.space_id AND a.deleted_at IS NULL
         LEFT JOIN events e ON e.id = a.event_id AND e.space_id = a.space_id AND e.deleted_at IS NULL
         LEFT JOIN projects p ON p.id = a.project_id AND p.space_id = a.space_id AND p.deleted_at IS NULL
         WHERE d.space_id = ?1 AND d.list_date = ?2
         ORDER BY d.sort_order, d.id"
    )?;
    let result = statement
        .query_map(params![space_id, list_date], |row| {
            Ok(DailyListItem {
                id: row.get(0)?,
                action_id: row.get(1)?,
                list_date: row.get(2)?,
                sort_order: row.get(3)?,
                action: row_to_action(row, 4)?,
            })
        })?
        .collect();
    result
}

fn valid_date(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
}

#[tauri::command]
pub fn get_daily_list(
    state: State<'_, AppState>,
    list_date: String,
) -> Result<Vec<DailyListItem>, String> {
    if !valid_date(&list_date) {
        return Err("日期格式无效".into());
    }
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    list_items(&conn, &list_date).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_daily_list_item(
    state: State<'_, AppState>,
    payload: AddDailyListItem,
) -> Result<Vec<DailyListItem>, String> {
    if !valid_date(&payload.list_date) {
        return Err("日期格式无效".into());
    }
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM actions WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![payload.action_id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if exists.is_none() {
        return Err("行动不存在".into());
    }
    let next_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM daily_list_items WHERE space_id = ?1 AND list_date = ?2", params![space_id, payload.list_date], |row| row.get(0)).map_err(|error| error.to_string())?;
    conn.execute("INSERT OR IGNORE INTO daily_list_items (space_id, action_id, list_date, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![space_id, payload.action_id, payload.list_date, next_order, now_millis()]).map_err(|error| error.to_string())?;
    list_items(&conn, &payload.list_date).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remove_daily_list_item(
    state: State<'_, AppState>,
    list_date: String,
    action_id: i64,
) -> Result<Vec<DailyListItem>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM daily_list_items WHERE space_id = ?1 AND list_date = ?2 AND action_id = ?3",
        params![space_id, list_date, action_id],
    )
    .map_err(|error| error.to_string())?;
    list_items(&conn, &list_date).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reorder_daily_list(
    state: State<'_, AppState>,
    payload: ReorderDailyList,
) -> Result<Vec<DailyListItem>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let mut seen = HashSet::new();
    if payload.action_ids.iter().any(|id| !seen.insert(*id)) {
        return Err("清单顺序包含重复行动".into());
    }
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM daily_list_items WHERE space_id = ?1 AND list_date = ?2",
            params![space_id, payload.list_date],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if count as usize != payload.action_ids.len() {
        return Err("清单内容已发生变化，请刷新后重试".into());
    }
    for (index, action_id) in payload.action_ids.iter().enumerate() {
        let changed = conn.execute("UPDATE daily_list_items SET sort_order = ?1 WHERE space_id = ?2 AND list_date = ?3 AND action_id = ?4", params![index as i64, space_id, payload.list_date, action_id]).map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("行动不在当前清单中".into());
        }
    }
    list_items(&conn, &payload.list_date).map_err(|error| error.to_string())
}
