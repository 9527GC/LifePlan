use crate::commands::calculate_priority;
use crate::db::{current_space_id, now_millis};
use crate::models::Project;
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct UpdateProjectPayload {
    pub id: i64,
    pub title: String,
    pub target: Option<String>,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub importance: i32,
    pub urgency: i32,
}

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        event_id: row.get(1)?,
        event_title: row.get(2)?,
        title: row.get(3)?,
        target: row.get(4)?,
        estimated_hours: row.get(5)?,
        start_date: row.get(6)?,
        deadline: row.get(7)?,
        importance: row.get(8)?,
        urgency: row.get(9)?,
        priority: row.get(10)?,
        status: row.get(11)?,
        action_count: row.get(12)?,
        completed_action_count: row.get(13)?,
        pending_action_count: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

pub fn list_projects(conn: &Connection) -> rusqlite::Result<Vec<Project>> {
    let space_id = current_space_id(conn).map_err(to_sql_error)?;
    let mut statement = conn.prepare(
        "SELECT p.id, p.event_id, e.title, p.title, p.target, p.estimated_hours, p.start_date, p.deadline, p.importance, p.urgency, p.priority, p.status, COUNT(a.id), COALESCE(SUM(CASE WHEN a.status = 1 THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN a.status = 0 THEN 1 ELSE 0 END), 0), p.created_at, p.updated_at
         FROM projects p
         JOIN events e ON e.id = p.event_id AND e.space_id = p.space_id AND e.deleted_at IS NULL
         LEFT JOIN actions a ON a.project_id = p.id AND a.space_id = p.space_id AND a.deleted_at IS NULL
         WHERE p.space_id = ?1 AND p.deleted_at IS NULL
         GROUP BY p.id
         ORDER BY p.status, p.priority ASC, p.updated_at DESC",
    )?;
    statement
        .query_map([space_id], row_to_project)
        .and_then(Iterator::collect)
}

fn to_sql_error(error: crate::db::DbError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

fn validate_project_payload(payload: &UpdateProjectPayload) -> Result<(), String> {
    if payload.title.trim().is_empty() {
        return Err("项目标题不能为空".into());
    }
    if payload.start_date.is_some()
        && payload.deadline.is_some()
        && payload.start_date > payload.deadline
    {
        return Err("截止日期不能早于开始日期".into());
    }
    Ok(())
}

pub fn recalc_project_estimated_hours(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET estimated_hours = COALESCE((SELECT SUM(estimated_hours) FROM actions WHERE project_id = ?1 AND deleted_at IS NULL), 0), updated_at = ?2 WHERE id = ?1",
        params![project_id, now_millis()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    list_projects(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_project(
    state: State<'_, AppState>,
    payload: UpdateProjectPayload,
) -> Result<Project, String> {
    validate_project_payload(&payload)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE projects SET title = ?1, target = ?2, start_date = ?3, deadline = ?4, importance = ?5, urgency = ?6, priority = ?7, updated_at = ?8 WHERE id = ?9 AND space_id = ?10 AND deleted_at IS NULL",
            params![payload.title.trim(), payload.target.as_deref(), payload.start_date.as_deref(), payload.deadline.as_deref(), payload.importance, payload.urgency, calculate_priority(payload.importance, payload.urgency), now_millis(), payload.id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("项目不存在".into());
    }
    conn.execute(
        "UPDATE actions SET importance = ?1, urgency = ?2, priority = ?3, updated_at = ?4 WHERE project_id = ?5 AND space_id = ?6 AND deleted_at IS NULL",
        params![payload.importance, payload.urgency, calculate_priority(payload.importance, payload.urgency), now_millis(), payload.id, space_id],
    )
    .map_err(|error| error.to_string())?;
    list_projects(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|project| project.id == payload.id)
        .ok_or_else(|| "项目不存在".into())
}

#[tauri::command]
pub fn complete_project(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let (status, event_id, count, completed): (i32, i64, i64, i64) = tx
        .query_row(
            "SELECT p.status, p.event_id, COUNT(a.id), COALESCE(SUM(CASE WHEN a.status = 1 THEN 1 ELSE 0 END), 0)
             FROM projects p
             LEFT JOIN actions a ON a.project_id = p.id AND a.space_id = p.space_id AND a.deleted_at IS NULL
             WHERE p.id = ?1 AND p.space_id = ?2 AND p.deleted_at IS NULL
             GROUP BY p.id",
            params![id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|error| error.to_string())?;
    if status != 0 {
        return Err("只有进行中的项目可以完成".into());
    }
    if count == 0 || completed != count {
        return Err("项目下所有行动完成后才能标记完成".into());
    }
    let timestamp = now_millis();
    tx.execute(
        "UPDATE projects SET status = 1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE events SET status = 5, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn abandon_project(state: State<'_, AppState>, id: i64, reason: String) -> Result<(), String> {
    if reason.trim().is_empty() {
        return Err("放弃原因不能为空".into());
    }
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let (status, event_id): (i32, i64) = tx
        .query_row(
            "SELECT status, event_id FROM projects WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if status != 0 {
        return Err("只有进行中的项目可以放弃".into());
    }
    let timestamp = now_millis();
    tx.execute(
        "UPDATE events SET status = 4, abandon_reason = ?1, updated_at = ?2 WHERE id = ?3 AND space_id = ?4 AND deleted_at IS NULL",
        params![reason.trim(), timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE projects SET status = 2, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE actions SET status = 2, cascade_abandoned = 1, updated_at = ?1 WHERE status = 0 AND project_id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let event_id: Option<i64> = tx
        .query_row(
            "SELECT event_id FROM projects WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(event_id) = event_id else {
        return Err("项目不存在".into());
    };
    let timestamp = now_millis();
    tx.execute(
        "UPDATE actions SET deleted_at = ?1, updated_at = ?1 WHERE project_id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE projects SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE events SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}



