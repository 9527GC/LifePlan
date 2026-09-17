use crate::commands::projects::recalc_project_estimated_hours;
use crate::commands::calculate_priority;
use crate::db::{current_space_id, new_uuid, now_millis};
use crate::models::{
    Action, DelegatedFollowUpResolution, NewAction, ReorderProjectActions, UpdateAction,
};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use tauri::State;

fn row_to_action(row: &rusqlite::Row) -> rusqlite::Result<Action> {
    Ok(Action {
        id: row.get(0)?,
        event_id: row.get(1)?,
        project_id: row.get(2)?,
        event_title: row.get(3)?,
        project_title: row.get(4)?,
        delegated_to: row.get(5)?,
        title: row.get(6)?,
        description: row.get(7)?,
        estimated_hours: row.get(8)?,
        start_date: row.get(9)?,
        deadline: row.get(10)?,
        is_frog: row.get(11)?,
        importance: row.get(12)?,
        urgency: row.get(13)?,
        priority: row.get(14)?,
        status: row.get(15)?,
        completed_at: row.get(16)?,
        is_delegated_follow_up: row.get(17)?,
        cascade_abandoned: row.get(18)?,
        sort_order: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
    })
}

fn to_sql_error(error: crate::db::DbError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

pub fn list_actions(conn: &Connection) -> rusqlite::Result<Vec<Action>> {
    let space_id = current_space_id(conn).map_err(to_sql_error)?;
    let mut statement = conn.prepare(
        "SELECT a.id, a.event_id, a.project_id, COALESCE(e.title, pe.title), p.title, COALESCE(e.delegated_to, pe.delegated_to), a.title, a.description, a.estimated_hours, a.start_date, a.deadline, a.is_frog, COALESCE(p.importance, a.importance), COALESCE(p.urgency, a.urgency), COALESCE(p.priority, a.priority), a.status, a.completed_at, a.is_delegated_follow_up, a.cascade_abandoned, COALESCE(a.sort_order, 0), a.created_at, a.updated_at
         FROM actions a
         LEFT JOIN events e ON e.id = a.event_id AND e.space_id = a.space_id AND e.deleted_at IS NULL
         LEFT JOIN projects p ON p.id = a.project_id AND p.space_id = a.space_id AND p.deleted_at IS NULL
         LEFT JOIN events pe ON pe.id = p.event_id AND pe.space_id = p.space_id AND pe.deleted_at IS NULL
         WHERE a.space_id = ?1 AND a.deleted_at IS NULL
           AND (a.event_id IS NULL OR e.id IS NOT NULL)
           AND (a.project_id IS NULL OR p.id IS NOT NULL)
         -- Keep the global action list predictable: pending actions first, then
         -- priority, dated actions, nearest deadline, and creation order.
         -- The id tie-breaker prevents rows created in the same millisecond from
         -- changing position between refreshes.
         ORDER BY a.status,
                  COALESCE(p.priority, a.priority) ASC,
                  CASE WHEN a.deadline IS NULL OR a.deadline = '' THEN 1 ELSE 0 END,
                  a.deadline,
                  CASE WHEN a.project_id IS NULL THEN 1 ELSE 0 END,
                  CASE WHEN a.project_id IS NOT NULL AND (a.start_date IS NULL OR a.start_date = '') THEN 1 ELSE 0 END,
                  a.start_date,
                  CASE WHEN a.project_id IS NOT NULL AND COALESCE(a.sort_order, 0) <= 0 THEN 1 ELSE 0 END,
                  CASE WHEN a.project_id IS NOT NULL THEN COALESCE(a.sort_order, 0) END,
                  a.created_at,
                  a.id",
    )?;
    statement
        .query_map([space_id], row_to_action)
        .and_then(Iterator::collect)
}

fn valid_hours(hours: f64) -> bool {
    [0.0, 0.5, 1.0, 1.5, 2.0].contains(&hours)
}

fn validate_dates(start: &Option<String>, deadline: &Option<String>) -> Result<(), String> {
    if start.is_some() && deadline.is_some() && start > deadline {
        Err("截止日期不能早于开始日期".into())
    } else {
        Ok(())
    }
}

fn validate_action_payload(payload: &NewAction) -> Result<(), String> {
    if payload.title.trim().is_empty() {
        return Err("行动标题不能为空".into());
    }
    if !valid_hours(payload.estimated_hours) {
        return Err("耗时可留空，或选择 30 分钟、1 小时、1.5 小时、2 小时".into());
    }
    validate_dates(&payload.start_date, &payload.deadline)
}

fn next_project_sort_order(
    conn: &Connection,
    project_id: i64,
    space_id: &str,
) -> rusqlite::Result<i64> {
    let max_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) FROM actions WHERE project_id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
        params![project_id, space_id],
        |row| row.get(0),
    )?;
    Ok(if max_order > 0 { max_order + 1 } else { 0 })
}

fn next_project_date_sort_order(
    conn: &Connection,
    project_id: i64,
    space_id: &str,
    start_date: Option<&str>,
) -> rusqlite::Result<i64> {
    let max_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) FROM actions WHERE project_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ((start_date = ?3) OR (start_date IS NULL AND ?3 IS NULL))",
        params![project_id, space_id, start_date],
        |row| row.get(0),
    )?;
    Ok(max_order + 1)
}

#[tauri::command]
pub fn get_actions(state: State<'_, AppState>) -> Result<Vec<Action>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    list_actions(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_action(state: State<'_, AppState>, payload: NewAction) -> Result<Action, String> {
    validate_action_payload(&payload)?;
    if payload.event_id.is_some() && payload.project_id.is_some() {
        return Err("行动不能同时关联事件和项目".into());
    }
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let priority = calculate_priority(payload.importance, payload.urgency);

    if let Some(event_id) = payload.event_id {
        let (status, project_id, importance, urgency): (i32, Option<i64>, i32, i32) = conn
            .query_row(
                "SELECT e.status, (SELECT p.id FROM projects p WHERE p.event_id = e.id AND p.space_id = e.space_id AND p.deleted_at IS NULL), COALESCE((SELECT p.importance FROM projects p WHERE p.event_id = e.id AND p.space_id = e.space_id AND p.deleted_at IS NULL), 1), COALESCE((SELECT p.urgency FROM projects p WHERE p.event_id = e.id AND p.space_id = e.space_id AND p.deleted_at IS NULL), 1) FROM events e WHERE e.id = ?1 AND e.space_id = ?2 AND e.deleted_at IS NULL",
                params![event_id, space_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|error| error.to_string())?;
        if project_id.is_some() || status != 0 {
            return Err("只有未转项目且未处理的事件可以直接关联行动".into());
        }
        conn.execute(
            "INSERT INTO actions (space_id, sync_id, event_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
            params![space_id, new_uuid(), event_id, payload.title.trim(), payload.description.as_deref(), payload.estimated_hours, payload.start_date.as_deref(), payload.deadline.as_deref(), payload.is_frog, importance, urgency, calculate_priority(importance, urgency), timestamp],
        )
        .map_err(|error| error.to_string())?;
    } else if let Some(project_id) = payload.project_id {
        let (project_status, importance, urgency): (i32, i32, i32) = conn
            .query_row(
                "SELECT status, importance, urgency FROM projects WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
                params![project_id, space_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|error| error.to_string())?;
        if project_status != 0 {
            return Err("已完成或已放弃项目不能新增行动".into());
        }
        let priority = calculate_priority(importance, urgency);
        let sort_order = next_project_sort_order(&conn, project_id, &space_id)
            .map_err(|error| error.to_string())?;
        conn.execute(
            "INSERT INTO actions (space_id, sync_id, project_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
            params![space_id, new_uuid(), project_id, payload.title.trim(), payload.description.as_deref(), payload.estimated_hours, payload.start_date.as_deref(), payload.deadline.as_deref(), payload.is_frog, importance, urgency, priority, sort_order, timestamp],
        )
        .map_err(|error| error.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO actions (space_id, sync_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![space_id, new_uuid(), payload.title.trim(), payload.description.as_deref(), payload.estimated_hours, payload.start_date.as_deref(), payload.deadline.as_deref(), payload.is_frog, payload.importance, payload.urgency, priority, timestamp],
        )
        .map_err(|error| error.to_string())?;
    }

    let id = conn.last_insert_rowid();
    if let Some(project_id) = payload.project_id {
        recalc_project_estimated_hours(&conn, project_id).map_err(|error| error.to_string())?;
    }
    list_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|action| action.id == id)
        .ok_or_else(|| "创建行动后读取失败".into())
}

#[tauri::command]
pub fn update_action(state: State<'_, AppState>, payload: UpdateAction) -> Result<Action, String> {
    if payload.title.trim().is_empty() || !valid_hours(payload.estimated_hours) {
        return Err("行动标题或耗时无效".into());
    }
    validate_dates(&payload.start_date, &payload.deadline)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let action_context: Option<(Option<i64>, Option<String>, i32, i32)> = conn
        .query_row(
            "SELECT project_id, start_date, importance, urgency FROM actions WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![payload.id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let project_id = action_context
        .as_ref()
        .and_then(|(project_id, _, _, _)| *project_id);
    let previous_start_date = action_context
        .as_ref()
        .and_then(|(_, start_date, _, _)| start_date.as_deref());
    let (importance, urgency) = if let Some(project_id) = project_id {
        conn.query_row(
            "SELECT importance, urgency FROM projects WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![project_id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|error| error.to_string())?
    } else {
        action_context
            .as_ref()
            .map(|(_, _, importance, urgency)| (*importance, *urgency))
            .unwrap_or((payload.importance, payload.urgency))
    };
    let sort_order = if let Some(project_id) = project_id {
        if previous_start_date != payload.start_date.as_deref() {
            // 补充开始日期时，只有日期破坏了当前相邻行动的时间顺序才重新定位。
            // 日期位于当前顺序允许的区间内时，保留原 sort_order，避免行动被无谓挪动。
            let current_sort_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(sort_order, 0) FROM actions WHERE id = ?1 AND project_id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
                    params![payload.id, project_id, space_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            let previous_date: Option<String> = conn
                .query_row(
                    "SELECT start_date FROM actions WHERE project_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND id <> ?3 AND sort_order < ?4 ORDER BY sort_order DESC, id DESC LIMIT 1",
                    params![project_id, space_id, payload.id, current_sort_order],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let next_date: Option<String> = conn
                .query_row(
                    "SELECT start_date FROM actions WHERE project_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND id <> ?3 AND sort_order > ?4 ORDER BY sort_order, id LIMIT 1",
                    params![project_id, space_id, payload.id, current_sort_order],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let new_date = payload.start_date.as_deref();
            let fits_previous = previous_date
                .as_deref()
                .is_none_or(|date| new_date.is_none_or(|value| date <= value));
            let fits_next = next_date
                .as_deref()
                .is_none_or(|date| new_date.is_none_or(|value| value <= date));
            if fits_previous && fits_next {
                None
            } else {
                Some(
                    next_project_date_sort_order(&conn, project_id, &space_id, new_date)
                        .map_err(|error| error.to_string())?,
                )
            }
        } else {
            None
        }
    } else {
        None
    };
    let changed = conn
        .execute(
            "UPDATE actions SET title = ?1, description = ?2, estimated_hours = ?3, start_date = ?4, deadline = ?5, is_frog = ?6, importance = ?7, urgency = ?8, priority = ?9, sort_order = COALESCE(?10, sort_order), updated_at = ?11 WHERE id = ?12 AND space_id = ?13 AND deleted_at IS NULL",
            params![payload.title.trim(), payload.description.as_deref(), payload.estimated_hours, payload.start_date.as_deref(), payload.deadline.as_deref(), payload.is_frog, importance, urgency, calculate_priority(importance, urgency), sort_order, now_millis(), payload.id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("行动不存在".into());
    }
    if let Some(project_id) = project_id {
        recalc_project_estimated_hours(&conn, project_id).map_err(|error| error.to_string())?;
    }
    list_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|action| action.id == payload.id)
        .ok_or_else(|| "行动不存在".into())
}

#[tauri::command]
pub fn reorder_project_actions(
    state: State<'_, AppState>,
    payload: ReorderProjectActions,
) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(payload.action_ids.len());
    if payload
        .action_ids
        .iter()
        .any(|action_id| !seen.insert(*action_id))
    {
        return Err("行动排序列表包含重复行动".into());
    }

    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let project_status: i32 = tx
        .query_row(
            "SELECT status FROM projects WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![payload.project_id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "项目不存在".to_string())?;
    if project_status != 0 {
        return Err("只有进行中的项目可以调整行动顺序".into());
    }

    let expected_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM actions WHERE project_id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![payload.project_id, space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if expected_count as usize != payload.action_ids.len() {
        return Err("行动排序列表与项目内容不一致".into());
    }

    let mut action_dates = Vec::with_capacity(payload.action_ids.len());
    for action_id in &payload.action_ids {
        let start_date: Option<String> = tx
            .query_row(
                "SELECT start_date FROM actions WHERE id = ?1 AND project_id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
                params![action_id, payload.project_id, space_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "行动不属于当前项目".to_string())?;
        action_dates.push(start_date.unwrap_or_else(|| "9999-12-31".into()));
    }
    if action_dates.windows(2).any(|dates| dates[0] > dates[1]) {
        return Err("行动顺序必须按开始日期从早到晚排列，只能调整同一天的行动顺序".into());
    }

    for (index, action_id) in payload.action_ids.iter().enumerate() {
        let changed = tx
            .execute(
                "UPDATE actions SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND project_id = ?4 AND space_id = ?5 AND deleted_at IS NULL",
                params![index as i64 + 1, now_millis(), action_id, payload.project_id, space_id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("行动不属于当前项目".into());
        }
    }
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_action(state: State<'_, AppState>, id: i64) -> Result<Action, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let changed = conn
        .execute(
            "UPDATE actions SET status = 1, completed_at = ?1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND status = 0 AND deleted_at IS NULL",
            params![timestamp, id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("只有待办行动可以完成".into());
    }
    list_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|action| action.id == id)
        .ok_or_else(|| "行动不存在".into())
}

#[tauri::command]
pub fn restore_action(state: State<'_, AppState>, id: i64) -> Result<Action, String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let relation: Option<(Option<i64>, Option<i64>)> = tx
        .query_row(
            "SELECT event_id, project_id FROM actions WHERE id = ?1 AND space_id = ?2 AND status = 1 AND deleted_at IS NULL",
            params![id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((event_id, project_id)) = relation else {
        return Err("只有已完成行动可以恢复".into());
    };
    let timestamp = now_millis();
    tx.execute(
        "UPDATE actions SET status = 0, completed_at = NULL, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    if let Some(project_id) = project_id {
        let source_event_id: i64 = tx
            .query_row(
                "SELECT event_id FROM projects WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
                params![project_id, space_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE projects SET status = 0, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND status = 1 AND deleted_at IS NULL",
            params![timestamp, project_id, space_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE events SET status = 1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND status = 5 AND deleted_at IS NULL",
            params![timestamp, source_event_id, space_id],
        )
        .map_err(|error| error.to_string())?;
    } else if let Some(event_id) = event_id {
        tx.execute(
            "UPDATE events SET status = 0, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND status = 5 AND deleted_at IS NULL",
            params![timestamp, event_id, space_id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    list_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|action| action.id == id)
        .ok_or_else(|| "行动不存在".into())
}

#[tauri::command]
pub fn delete_action(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let relation: Option<(Option<i64>, Option<i64>, i32)> = tx
        .query_row(
            "SELECT event_id, project_id, is_delegated_follow_up FROM actions WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((event_id, project_id, delegated)) = relation else {
        return Err("行动不存在".into());
    };
    if let Some(project_id) = project_id {
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM actions WHERE project_id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
                params![project_id, space_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if count <= 1 {
            return Err("项目至少保留一条行动".into());
        }
    }
    let timestamp = now_millis();
    tx.execute(
        "UPDATE actions SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    if delegated == 1 {
        if let Some(event_id) = event_id {
            tx.execute(
                "UPDATE events SET status = 0, delegated_to = NULL, follow_up_date = NULL, follow_up_note = NULL, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
                params![timestamp, event_id, space_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    if let Some(project_id) = project_id {
        recalc_project_estimated_hours(&tx, project_id).map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_delegated_follow_up(
    state: State<'_, AppState>,
    payload: DelegatedFollowUpResolution,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let (event_id, status): (i64, i32) = tx
        .query_row(
            "SELECT event_id, status FROM actions WHERE id = ?1 AND space_id = ?2 AND is_delegated_follow_up = 1 AND deleted_at IS NULL",
            params![payload.action_id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if status != 1 {
        return Err("委托跟进行动完成后才能处理事件结果".into());
    }
    let timestamp = now_millis();
    match payload.resolution.as_str() {
        "keep" => {}
        "complete" => {
            let incomplete: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM actions WHERE event_id = ?1 AND space_id = ?2 AND status != 1 AND deleted_at IS NULL",
                    params![event_id, space_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if incomplete > 0 {
                return Err("事件下所有行动完成后才能标记事件完成".into());
            }
            tx.execute(
                "UPDATE events SET status = 5, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
                params![timestamp, event_id, space_id],
            )
            .map_err(|error| error.to_string())?;
        }
        "abandon" => super::events::abandon_event_tx(
            &tx,
            event_id,
            payload.abandon_reason.as_deref().unwrap_or(""),
            timestamp,
        )?,
        _ => return Err("不支持的跟进处理方式".into()),
    }
    tx.commit().map_err(|error| error.to_string())
}



