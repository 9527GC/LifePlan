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
        delay_from_status: row.get(8)?,
        abandon_reason: row.get(9)?,
        target: row.get(10)?,
        deadline: row.get(11)?,
        importance: row.get(12)?,
        urgency: row.get(13)?,
        action_count: row.get(14)?,
        pending_action_count: row.get(15)?,
        completed_action_count: row.get(16)?,
        is_quick_completed: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}

// 推迟日期按本地自然日解释，提前到前一天 17:00 恢复。
pub(crate) fn restore_due_delays(conn: &Connection) -> rusqlite::Result<usize> {
    restore_due_delays_at(
        conn,
        &chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    )
}

fn restore_due_delays_at(conn: &Connection, local_now: &str) -> rusqlite::Result<usize> {
    let space_id = current_space_id(conn).map_err(to_sql_error)?;
    conn.execute(
        "UPDATE events
         SET status = delay_from_status, delay_until = NULL, delay_note = NULL,
             delay_from_status = 0, updated_at = ?1
         WHERE space_id = ?2 AND deleted_at IS NULL AND status = 3
           AND delay_until IS NOT NULL
           AND datetime(delay_until, '-1 day', '+17 hours') <= datetime(?3)",
        params![now_millis(), space_id, local_now],
    )
}

#[tauri::command]
pub fn check_due_delays(state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    restore_due_delays(&conn)
        .map(|count| count > 0)
        .map_err(|error| error.to_string())
}

fn validate_delay_date(value: Option<&str>, local_now: &str) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "重新处理日期格式无效".to_string())?;
    if date.format("%Y-%m-%d").to_string() != value {
        return Err("重新处理日期格式无效".into());
    }
    let restore_at = date
        .pred_opt()
        .and_then(|day| day.and_hms_opt(17, 0, 0))
        .ok_or_else(|| "重新处理日期超出支持范围".to_string())?;
    let now = chrono::NaiveDateTime::parse_from_str(local_now, "%Y-%m-%d %H:%M:%S")
        .map_err(|error| error.to_string())?;
    if restore_at <= now {
        return Err("事件将在重新处理日期的前一天 17:00 恢复，请选择恢复时间尚未到达的日期".into());
    }
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
    let award =
        (EVENT_COMPLETION_BASE_POINTS + completed_action_count).min(EVENT_COMPLETION_MAX_POINTS);
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
                e.follow_up_note, e.delay_until, e.delay_note, e.delay_from_status,
                e.abandon_reason, e.target, e.deadline,
                 e.importance, e.urgency, COUNT(a.id),
                COALESCE(SUM(CASE WHEN a.status = 0 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN a.status = 1 THEN 1 ELSE 0 END), 0),
                e.is_quick_completed, e.created_at, e.updated_at
         FROM events e
         LEFT JOIN actions a ON a.space_id = e.space_id AND a.deleted_at IS NULL
                              AND a.event_id = e.id
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
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&tx).map_err(|error| error.to_string())?;
    let status: Option<i32> = tx
        .query_row(
            "SELECT status FROM events WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![payload.id, space_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(status) = status else {
        return Err("事件不存在".into());
    };

    let timestamp = now_millis();
    if status == 5 {
        // 已完成事件只允许更正标题，避免改变已完成记录的原始属性。
        tx.execute(
            "UPDATE events SET title = ?1, updated_at = ?2 WHERE id = ?3 AND space_id = ?4 AND deleted_at IS NULL",
            params![title, timestamp, payload.id, space_id],
        )
        .map_err(|error| error.to_string())?;
    } else {
        let importance = payload.importance.unwrap_or(1);
        let urgency = payload.urgency.unwrap_or(1);
        if ![0, 1].contains(&importance) || ![0, 1].contains(&urgency) {
            return Err("重要程度和紧急程度无效".into());
        }
        let priority = calculate_priority(importance, urgency);
        tx.execute(
            "UPDATE events SET title = ?1, target = ?2, deadline = ?3, importance = ?4, urgency = ?5, priority = ?6, updated_at = ?7 WHERE id = ?8 AND space_id = ?9 AND deleted_at IS NULL",
            params![title, payload.target.as_deref(), payload.deadline.as_deref(), importance, urgency, priority, timestamp, payload.id, space_id],
        )
        .map_err(|error| error.to_string())?;
        // 事件属性同步到其全部行动，保证事件成为唯一的归属来源。
        tx.execute(
            "UPDATE actions SET importance = ?1, urgency = ?2, priority = ?3, updated_at = ?4 WHERE space_id = ?5 AND deleted_at IS NULL AND event_id = ?6",
            params![importance, urgency, priority, timestamp, space_id, payload.id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
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
    // 已开展行动的事件仍允许放弃；推迟也属于合法的状态流转。
    // 只有重新自我处理或委托时，才需要阻止重复创建/分派行动。
    if status == 1 && payload.decision != "delay" && payload.decision != "abandon" {
        return Err("已开展行动事件暂不支持该操作".into());
    }
    if status != 0 && status != 1 && status != 3 {
        return Err("当前事件不能重复处理".into());
    }

    let timestamp = now_millis();
    match payload.decision.as_str() {
        "self" => {
            let quick_complete = payload.quick_complete.unwrap_or(false);
            let action_steps = payload.action_steps.as_deref().unwrap_or(&[]);
            if !quick_complete && action_steps.is_empty() {
                return Err("至少需要填写一条行动".into());
            }
            if quick_complete && !action_steps.is_empty() {
                return Err("2分钟小事不能同时添加行动".into());
            }
            for step in action_steps {
                if step.title.trim().is_empty() {
                    return Err("行动标题不能为空".into());
                }
                if ![0.0, 0.5, 1.0, 1.5, 2.0].contains(&step.estimated_hours) {
                    return Err("行动耗时必须为空、30 分钟、1 小时、1.5 小时或 2 小时".into());
                }
                if step.start_date.is_some()
                    && payload.deadline.is_some()
                    && step.start_date > payload.deadline
                {
                    return Err("行动开始日期不能晚于事件截止日期".into());
                }
            }
            let importance = payload.importance.unwrap_or(1);
            let urgency = payload.urgency.unwrap_or(1);
            validate_dates(&payload.start_date, &payload.deadline)?;
            for step in action_steps {
                tx.execute("INSERT INTO actions (space_id, sync_id, event_id, title, estimated_hours, start_date, deadline, importance, urgency, priority, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)", params![space_id, new_uuid(), payload.event_id, step.title.trim(), step.estimated_hours, step.start_date.as_deref(), payload.deadline.as_deref(), importance, urgency, calculate_priority(importance, urgency), timestamp]).map_err(|error| error.to_string())?;
            }
            let event_status = if quick_complete { 5 } else { 1 };
            tx.execute("UPDATE events SET title = ?1, target = ?2, deadline = ?3, importance = ?4, urgency = ?5, priority = ?6, status = ?7, is_quick_completed = ?8, updated_at = ?9 WHERE id = ?10 AND space_id = ?11 AND deleted_at IS NULL", params![payload.title.as_deref().unwrap_or(""), payload.target.as_deref(), payload.deadline.as_deref(), importance, urgency, calculate_priority(importance, urgency), event_status, i32::from(quick_complete), timestamp, payload.event_id, space_id]).map_err(|error| error.to_string())?;
            if quick_complete {
                award_event_completion_tx(&tx, payload.event_id, &space_id, 0)?;
            }
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
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0, 0, 0, ?7, 1, ?8, ?8)",
                params![
                    space_id,
                    new_uuid(),
                    payload.event_id,
                    action_title,
                    Option::<&str>::None,
                    follow_up_date,
                    // 委托跟进行动同样根据自身的重要程度和紧急程度计算优先级。
                    // 当前默认值为“不重要、不紧急”（0、0），因此应为 P4，而不是硬编码为 P1。
                    calculate_priority(0, 0),
                    timestamp
                ],
            )
            .map_err(|error| error.to_string())?;
        }
        "delay" => {
            validate_delay_date(
                payload.delay_until.as_deref(),
                &chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            )?;
            tx.execute(
                "UPDATE events SET status = 3, delay_until = ?1, delay_note = ?2,
                 delay_from_status = CASE WHEN status = 3 THEN delay_from_status ELSE status END,
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
        "UPDATE actions SET status = 2, cascade_abandoned = 1, updated_at = ?1
         WHERE status = 0 AND space_id = ?3 AND deleted_at IS NULL
            AND event_id = ?2",
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
    let status: i32 = tx
        .query_row(
            "SELECT status FROM events WHERE id = ?1 AND space_id = ?2 AND deleted_at IS NULL",
            params![event_id, space_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if status != 1 {
        return Err("只有进行中的事件才能标记完成".into());
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
    // 没有拆解行动的事件可以通过“2分钟小事直接完成”快速完成；
    // 有行动时仍必须确保全部行动已完成。
    if completed != action_count {
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
        "UPDATE events SET status = 1,
         delegated_to = NULL, follow_up_date = NULL, follow_up_note = NULL,
         delay_until = NULL, delay_note = NULL, delay_from_status = 0, abandon_reason = NULL,
         updated_at = ?1
         WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE actions SET status = 0, cascade_abandoned = 0, updated_at = ?1
         WHERE status = 2 AND cascade_abandoned = 1 AND space_id = ?3
           AND deleted_at IS NULL AND event_id = ?2",
        params![timestamp, event_id, space_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_delayed_event(state: State<'_, AppState>, event_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE events SET status = delay_from_status, delay_until = NULL, delay_note = NULL,
         delay_from_status = 0, updated_at = ?1
         WHERE id = ?2 AND space_id = ?3 AND deleted_at IS NULL AND status = 3",
            params![now_millis(), event_id, space_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("只有推迟事件可以恢复".into());
    }
    Ok(())
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
        "UPDATE actions SET deleted_at = ?1, updated_at = ?1
         WHERE space_id = ?2 AND deleted_at IS NULL AND event_id = ?3",
        params![timestamp, space_id, id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod delay_tests {
    use super::*;

    fn database() -> (Connection, String) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::migrations::INIT_MIGRATION)
            .unwrap();
        let space = crate::db::ensure_current_space(&mut conn).unwrap();
        (conn, space)
    }

    fn insert(
        conn: &Connection,
        space: &str,
        id: i64,
        status: i32,
        previous: i32,
        date: Option<&str>,
        deleted: bool,
    ) {
        conn.execute(
            "INSERT INTO events (id, space_id, sync_id, title, status, delay_from_status, delay_until, delay_note, deleted_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, '测试事件', ?4, ?5, ?6, '推迟备注', ?7, 1, 1)",
            params![id, space, format!("test-{id}"), status, previous, date, if deleted { Some(1) } else { None }],
        ).unwrap();
    }

    #[test]
    fn 前一天十七点边界及恢复原状态() {
        let (conn, space) = database();
        insert(&conn, &space, 1, 3, 0, Some("2026-10-12"), false);
        insert(&conn, &space, 2, 3, 1, Some("2026-10-12"), false);
        assert_eq!(
            restore_due_delays_at(&conn, "2026-10-11 16:59:59").unwrap(),
            0
        );
        assert_eq!(
            restore_due_delays_at(&conn, "2026-10-11 17:00:00").unwrap(),
            2
        );
        for (id, expected) in [(1, 0), (2, 1)] {
            let actual: (i32, Option<String>, Option<String>, i32, i64) = conn.query_row(
                "SELECT status, delay_until, delay_note, delay_from_status, updated_at FROM events WHERE id = ?1",
                [id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).unwrap();
            assert_eq!(
                (actual.0, actual.1, actual.2, actual.3),
                (expected, None, None, 0)
            );
            assert!(actual.4 > 1);
        }
        assert_eq!(
            restore_due_delays_at(&conn, "2026-10-12 09:00:00").unwrap(),
            0
        );
    }

    #[test]
    fn 补恢复跨年跨月且不影响其他事件() {
        let (conn, space) = database();
        insert(&conn, &space, 1, 3, 0, Some("2027-01-01"), false);
        insert(&conn, &space, 2, 3, 1, Some("2027-02-01"), false);
        insert(&conn, &space, 3, 3, 0, None, false);
        insert(&conn, &space, 4, 3, 0, Some("2027-01-01"), true);
        insert(&conn, &space, 5, 5, 0, Some("2027-01-01"), false);
        conn.execute("INSERT INTO local_spaces VALUES ('other', NULL, 1, 1)", [])
            .unwrap();
        insert(&conn, "other", 6, 3, 0, Some("2027-01-01"), false);
        assert_eq!(
            restore_due_delays_at(&conn, "2026-12-31 17:00:00").unwrap(),
            1
        );
        assert_eq!(
            restore_due_delays_at(&conn, "2027-01-31 16:59:59").unwrap(),
            0
        );
        assert_eq!(
            restore_due_delays_at(&conn, "2027-02-03 09:00:00").unwrap(),
            1
        );
        for id in [3, 4, 6] {
            let status: i32 = conn
                .query_row("SELECT status FROM events WHERE id = ?1", [id], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(status, 3);
        }
        let status: i32 = conn
            .query_row("SELECT status FROM events WHERE id = 5", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(status, 5);
    }

    #[test]
    fn 日期校验拒绝已经到达恢复时刻及无效日期() {
        assert!(validate_delay_date(Some("2026-10-10"), "2026-10-09 16:59:59").is_ok());
        assert!(validate_delay_date(Some("2026-10-10"), "2026-10-09 17:00:00").is_err());
        assert!(validate_delay_date(Some("2026-10-10"), "2026-10-09 18:00:00").is_err());
        assert!(validate_delay_date(Some("2026-10-11"), "2026-10-09 18:00:00").is_ok());
        assert!(validate_delay_date(None, "2026-10-09 18:00:00").is_ok());
        for date in [
            "",
            "2026-02-30",
            "invalid",
            "2026-1-1",
            "2026-10-11 12:00:00",
        ] {
            assert!(validate_delay_date(Some(date), "2026-10-09 18:00:00").is_err());
        }
    }
}
