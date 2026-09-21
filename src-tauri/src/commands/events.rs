use crate::commands::calculate_priority;
use crate::db::{current_space_id, new_uuid, now_millis};
use crate::models::{Event, EventCompletionCheck, NewEvent, ProcessEvent, UpdateEvent};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        delegated_to: row.get(3)?,
        follow_up_date: row.get(4)?,
        follow_up_note: row.get(5)?,
        delay_until: row.get(6)?,
        delay_note: row.get(7)?,
        abandon_reason: row.get(8)?,
        project_id: row.get(9)?,
        project_title: row.get(10)?,
        action_count: row.get(11)?,
        pending_action_count: row.get(12)?,
        completed_action_count: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn restore_due_delays(conn: &Connection) -> rusqlite::Result<()> {
    let space_id = current_space_id(conn).map_err(to_sql_error)?;
    conn.execute(
        "UPDATE events
         SET status = 0, delay_until = NULL, updated_at = ?1
         WHERE space_id = ?2 AND deleted_at IS NULL AND status = 3
           AND delay_until IS NOT NULL AND date(delay_until) <= date('now')",
        params![now_millis(), space_id],
    )?;
    Ok(())
}

fn to_sql_error(error: crate::db::DbError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

/// 事件"全部搞定"里程碑积分参数（方案A）：
/// 奖励 = BASE + 已完成行动数，封顶 MAX，避免大小事件一刀切。
const EVENT_COMPLETION_BASE_POINTS: i64 = 5;
const EVENT_COMPLETION_MAX_POINTS: i64 = 30;

/// 事件从"未完成"进入"已完成"时发放一次性里程碑积分。
/// 幂等：若该事件已发放过则返回 0，不重复计分；与番茄专注分相互独立。
pub(crate) fn award_event_completion_tx(
    tx: &rusqlite::Transaction<'_>,
    event_id: i64,
    space_id: &str,
    completed_action_count: i64,
) -> Result<i64, String> {
    let already: i64 = tx
        .query_row(
            "SELECT completion_points_awarded FROM events WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![event_id, space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if already > 0 {
        return Ok(0);
    }
    let award = (EVENT_COMPLETION_BASE_POINTS + completed_action_count).min(EVENT_COMPLETION_MAX_POINTS);
    if award <= 0 {
        return Ok(0);
    }
    let now = now_millis();
    tx.execute(
        "INSERT INTO user_points (space_id, total_points, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(space_id) DO UPDATE SET total_points = user_points.total_points + excluded.total_points, updated_at = excluded.updated_at",
        params![space_id, award, now],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE events SET completion_points_awarded = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![award, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(award)
}

/// 事件从"已完成"回退时扣回里程碑积分，防止反复勾选刷分。
/// 幂等：仅当存在已发放积分时扣减，且结果不为负。
pub(crate) fn revoke_event_completion_tx(
    tx: &rusqlite::Transaction<'_>,
    event_id: i64,
    space_id: &str,
) -> Result<i64, String> {
    let already: i64 = tx
        .query_row(
            "SELECT completion_points_awarded FROM events WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![event_id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0);
    if already <= 0 {
        return Ok(0);
    }
    let now = now_millis();
    tx.execute(
        "INSERT INTO user_points (space_id, total_points, updated_at) VALUES (?1, 0, ?2) ON CONFLICT(space_id) DO UPDATE SET total_points = MAX(user_points.total_points - ?3, 0), updated_at = excluded.updated_at",
        params![space_id, now, already],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE events SET completion_points_awarded = 0 WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
        params![event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(already)
}

pub fn list_events(conn: &Connection) -> rusqlite::Result<Vec<Event>> {
    restore_due_delays(conn)?;
    let space_id = current_space_id(conn).map_err(to_sql_error)?;
    let mut statement = conn.prepare(
        "SELECT e.id, e.title, e.status, e.delegated_to, e.follow_up_date,
                e.follow_up_note, e.delay_until, e.delay_note, e.abandon_reason,
                p.id, p.title, COUNT(a.id),
                COALESCE(SUM(CASE WHEN a.status = 0 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN a.status = 1 THEN 1 ELSE 0 END), 0),
                e.created_at, e.updated_at
         FROM events e
         LEFT JOIN projects p ON p.event_id = e.id AND p.space_id = e.space_id
                              AND p.deleted_at IS NULL
         LEFT JOIN actions a ON a.space_id = e.space_id AND a.deleted_at IS NULL
                             AND (a.event_id = e.id OR a.project_id = p.id)
         WHERE e.space_id = ?1 AND e.deleted_at IS NULL
         GROUP BY e.id
         ORDER BY CASE WHEN e.status IN (0, 3) THEN 0 ELSE 1 END,
                  CASE WHEN e.status = 3 THEN 1 ELSE 0 END,
                  e.updated_at DESC",
    )?;
    statement
        .query_map([space_id], row_to_event)
        .and_then(Iterator::collect)
}

#[tauri::command]
pub fn get_events(state: State<'_, AppState>) -> Result<Vec<Event>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    list_events(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_event(state: State<'_, AppState>, payload: NewEvent) -> Result<Event, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("事件标题不能为空".into());
    }
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    conn.execute(
        "INSERT INTO events (space_id, sync_id, title, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        params![space_id, new_uuid(), title, timestamp],
    )
    .map_err(|error| error.to_string())?;
    let id = conn.last_insert_rowid();
    list_events(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| event.id == id)
        .ok_or_else(|| "创建事件后读取失败".into())
}

#[tauri::command]
pub fn update_event(state: State<'_, AppState>, payload: UpdateEvent) -> Result<Event, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("事件标题不能为空".into());
    }
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE events SET title = ?1, updated_at = ?2
             WHERE id = ?3 AND space_id = ?4 AND deleted_at IS NULL",
            params![title, now_millis(), payload.id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("事件不存在".into());
    }
    list_events(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| event.id == payload.id)
        .ok_or_else(|| "事件不存在".into())
}

#[tauri::command]
pub fn process_event(state: State<'_, AppState>, payload: ProcessEvent) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let status: Option<i32> = tx
        .query_row(
            "SELECT status FROM events
             WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![payload.event_id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(status) = status else {
        return Err("事件不存在".into());
    };
    if status != 0 && status != 3 {
        return Err("当前事件不能重复处理".into());
    }

    let timestamp = now_millis();
    match payload.decision.as_str() {
        "self" => {
            let action_steps = payload.action_steps.as_ref().ok_or_else(|| "至少需要填写一条行动".to_string())?;
            if action_steps.is_empty() { return Err("至少需要填写一条行动".into()); }
            for step in action_steps {
                if step.title.trim().is_empty() { return Err("行动标题不能为空".into()); }
                if ![0.0, 0.5, 1.0, 1.5, 2.0].contains(&step.estimated_hours) { return Err("行动耗时必须为空、30 分钟、1 小时、1.5 小时或 2 小时".into()); }
                if step.start_date.is_some() && payload.deadline.is_some() && step.start_date > payload.deadline { return Err("行动开始日期不能晚于事件截止日期".into()); }
            }
            let importance = payload.importance.unwrap_or(1); let urgency = payload.urgency.unwrap_or(1);
            validate_dates(&payload.start_date, &payload.deadline)?;
            for step in action_steps {
                tx.execute("INSERT INTO actions (space_id, sync_id, event_id, title, estimated_hours, start_date, deadline, importance, urgency, priority, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)", params![space_id, new_uuid(), payload.event_id, step.title.trim(), step.estimated_hours, step.start_date.as_deref(), payload.deadline.as_deref(), importance, urgency, calculate_priority(importance, urgency), timestamp]).map_err(|error| error.to_string())?;
            }
            tx.execute("UPDATE events SET status = 1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL", params![timestamp, payload.event_id, space_id]).map_err(|error| error.to_string())?;
        }
        "delegate" => {
            let delegated_to = payload.delegated_to.as_deref().unwrap_or("").trim();
            let follow_up_date = payload.follow_up_date.as_deref().unwrap_or("").trim();
            if delegated_to.is_empty() || follow_up_date.is_empty() {
                return Err("委托对象和跟进日期不能为空".into());
            }
            let event_title: String = tx
                .query_row(
                    "SELECT title FROM events WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
                    params![payload.event_id, space_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            let action_title = format!("跟进委托{}-{}", delegated_to, event_title.trim());
            tx.execute(
                "UPDATE events SET status = 2, delegated_to = ?1, follow_up_date = ?2,
                 follow_up_note = ?3, updated_at = ?4
                 WHERE id = ?5 AND space_id = ?6 AND deleted_at IS NULL",
                params![
                    delegated_to,
                    follow_up_date,
                    Option::<&str>::None,
                    timestamp,
                    payload.event_id,
                    space_id
                ],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT INTO actions
                 (space_id, sync_id, event_id, title, description, estimated_hours,
                  start_date, is_frog, importance, urgency, priority,
                  is_delegated_follow_up, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0, 0, 0, 1, 1, ?7, ?7)",
                params![
                    space_id,
                    new_uuid(),
                    payload.event_id,
                    action_title,
                    Option::<&str>::None,
                    follow_up_date,
                    timestamp
                ],
            )
            .map_err(|error| error.to_string())?;
        }
        "delay" => {
            tx.execute(
                "UPDATE events SET status = 3, delay_until = ?1, delay_note = ?2,
                 updated_at = ?3
                 WHERE id = ?4 AND space_id = ?5 AND deleted_at IS NULL",
                params![
                    payload.delay_until.as_deref(),
                    payload.delay_note.as_deref(),
                    timestamp,
                    payload.event_id,
                    space_id
                ],
            )
            .map_err(|error| error.to_string())?;
        }
        "abandon" => abandon_event_tx(
            &tx,
            payload.event_id,
            payload.abandon_reason.as_deref().unwrap_or(""),
            timestamp,
        )?,
        _ => return Err("不支持的事件处理方式".into()),
    }
    tx.commit().map_err(|error| error.to_string())
}

fn validate_dates(start: &Option<String>, deadline: &Option<String>) -> Result<(), String> {
    if start.is_some() && deadline.is_some() && start > deadline {
        Err("截止日期不能早于开始日期".into())
    } else {
        Ok(())
    }
}

pub(crate) fn abandon_event_tx(
    tx: &rusqlite::Transaction<'_>,
    event_id: i64,
    reason: &str,
    timestamp: i64,
) -> Result<(), String> {
    if reason.trim().is_empty() {
        return Err("放弃原因不能为空".into());
    }
    let space_id = current_space_id(tx).map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE events SET status = 4, abandon_reason = ?1, updated_at = ?2
         WHERE id = ?3 AND space_id = ?4 AND deleted_at IS NULL",
        params![reason.trim(), timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE projects SET status = 2, updated_at = ?1
         WHERE event_id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE actions SET status = 2, cascade_abandoned = 1, updated_at = ?1
         WHERE status = 0 AND space_id = ?3 AND deleted_at IS NULL
           AND (event_id = ?2 OR project_id IN (
               SELECT id FROM projects
               WHERE event_id = ?2 AND space_id = ?3 AND deleted_at IS NULL
           ))",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn complete_event(
    state: State<'_, AppState>,
    event_id: i64,
) -> Result<EventCompletionCheck, String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let (status, has_project): (i32, i64) = tx
        .query_row(
            "SELECT e.status,
                    EXISTS(SELECT 1 FROM projects p
                           WHERE p.event_id = e.id AND p.space_id = ?2
                             AND p.deleted_at IS NULL)
             FROM events e
             WHERE e.id = ?1 AND e.space_id = ?2 AND e.deleted_at IS NULL",
            params![event_id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if status != 0 || has_project != 0 {
        return Err("只有未转项目的未处理事件才能直接完成".into());
    }
    let (action_count, completed): (i64, i64) = tx
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0)
             FROM actions
             WHERE event_id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![event_id, space_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if action_count == 0 || completed != action_count {
        return Err("事件下所有行动完成后才能标记完成".into());
    }
    tx.execute(
        "UPDATE events SET status = 5, updated_at = ?1
         WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![now_millis(), event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    let points_awarded = award_event_completion_tx(&tx, event_id, &space_id, completed)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(EventCompletionCheck {
        action_count,
        completed_count: completed,
        abandoned_count: 0,
        points_awarded,
    })
}

#[tauri::command]
pub fn restore_event(state: State<'_, AppState>, event_id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let status: i32 = tx
        .query_row(
            "SELECT status FROM events
             WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![event_id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "事件不存在".to_string())?;
    if status != 4 {
        return Err("只有已放弃事件可以恢复".into());
    }
    tx.execute(
        "UPDATE events SET status = CASE WHEN EXISTS (
             SELECT 1 FROM projects WHERE event_id = events.id AND space_id = ?3
               AND deleted_at IS NULL
         ) THEN 1 ELSE 0 END,
         delegated_to = NULL, follow_up_date = NULL, follow_up_note = NULL,
         delay_until = NULL, delay_note = NULL, abandon_reason = NULL,
         updated_at = ?1
         WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE projects SET status = 0, updated_at = ?1
         WHERE event_id = ?2 AND status = 2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE actions SET status = 0, cascade_abandoned = 0, updated_at = ?1
         WHERE status = 2 AND cascade_abandoned = 1 AND space_id = ?3
           AND deleted_at IS NULL AND (event_id = ?2 OR project_id IN (
               SELECT id FROM projects
               WHERE event_id = ?2 AND space_id = ?3 AND deleted_at IS NULL
           ))",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_event(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let changed = tx
        .execute(
            "UPDATE events SET deleted_at = ?1, updated_at = ?1
             WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
            params![timestamp, id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("事件不存在或已删除".into());
    }
    tx.execute(
        "UPDATE projects SET deleted_at = ?1, updated_at = ?1
         WHERE event_id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE actions SET deleted_at = ?1, updated_at = ?1
         WHERE space_id = ?2 AND deleted_at IS NULL AND (event_id = ?3 OR project_id IN (
             SELECT id FROM projects WHERE event_id = ?3 AND space_id = ?2
         ))",
        params![timestamp, space_id, id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}


