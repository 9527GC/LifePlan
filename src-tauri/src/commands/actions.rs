use crate::commands::calculate_priority;
use crate::db::{current_space_id, new_uuid, now_millis};
use crate::models::{
    Action, DelegatedFollowUpResolution, NewAction, ReorderEventActions, UpdateAction,
};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use tauri::State;

fn row_to_action(row: &rusqlite::Row) -> rusqlite::Result<Action> {
    Ok(Action {
        id: row.get(0)?,
        event_id: row.get(1)?,
        event_title: row.get(2)?,
        delegated_to: row.get(3)?,
        title: row.get(4)?,
        description: row.get(5)?,
        estimated_hours: row.get(6)?,
        start_date: row.get(7)?,
        deadline: row.get(8)?,
        is_frog: row.get(9)?,
        importance: row.get(10)?,
        urgency: row.get(11)?,
        priority: row.get(12)?,
        status: row.get(13)?,
        completed_at: row.get(14)?,
        is_delegated_follow_up: row.get(15)?,
        cascade_abandoned: row.get(16)?,
        sort_order: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}
fn to_sql_error(e: crate::db::DbError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(e))
}
pub fn list_actions(conn: &Connection) -> rusqlite::Result<Vec<Action>> {
    let space = current_space_id(conn).map_err(to_sql_error)?;
    let mut q=conn.prepare("SELECT a.id,a.event_id,e.title,e.delegated_to,a.title,a.description,a.estimated_hours,a.start_date,a.deadline,a.is_frog,a.importance,a.urgency,a.priority,a.status,a.completed_at,a.is_delegated_follow_up,a.cascade_abandoned,a.sort_order,a.created_at,a.updated_at FROM actions a LEFT JOIN events e ON e.id=a.event_id AND e.space_id=a.space_id AND e.deleted_at IS NULL WHERE a.space_id=?1 AND a.deleted_at IS NULL ORDER BY CASE WHEN a.event_id IS NULL THEN 1 ELSE 0 END,a.start_date IS NULL,a.start_date,a.sort_order,a.id")?;
    let result = q.query_map([space], row_to_action)?.collect();
    result
}
fn valid_hours(h: f64) -> bool {
    [0.0, 0.5, 1.0, 1.5, 2.0].contains(&h)
}
fn validate(p: &NewAction) -> Result<(), String> {
    if p.title.trim().is_empty() {
        return Err("行动标题不能为空".into());
    }
    if !valid_hours(p.estimated_hours) {
        return Err("行动耗时必须为空、30 分钟、1 小时、1.5 小时或 2 小时".into());
    }
    if p.start_date > p.deadline {
        return Err("截止日期不能早于开始日期".into());
    }
    Ok(())
}
#[tauri::command]
pub fn get_actions(state: State<'_, AppState>) -> Result<Vec<Action>, String> {
    let c = state.db.lock().map_err(|e| e.to_string())?;
    list_actions(&c).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn create_action(state: State<'_, AppState>, payload: NewAction) -> Result<Action, String> {
    validate(&payload)?;
    let c = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&c).map_err(|e| e.to_string())?;
    if let Some(event) = payload.event_id {
        let status: i32 = c
            .query_row(
                "SELECT status FROM events WHERE id=?1 AND space_id=?2 AND deleted_at IS NULL",
                params![event, space],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if status != 1 {
            return Err("只有进行中的事件可以新增行动".into());
        }
    }
    let now = now_millis();
    let order: i64 = if let Some(event) = payload.event_id {
        c.query_row("SELECT COALESCE(MAX(sort_order),0)+1 FROM actions WHERE event_id=?1 AND space_id=?2 AND deleted_at IS NULL",params![event,space],|r|r.get(0)).map_err(|e|e.to_string())?
    } else {
        0
    };
    c.execute("INSERT INTO actions (space_id,sync_id,event_id,title,description,estimated_hours,start_date,deadline,is_frog,importance,urgency,priority,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)",params![space,new_uuid(),payload.event_id,payload.title.trim(),payload.description,payload.estimated_hours,payload.start_date,payload.deadline,payload.is_frog,payload.importance,payload.urgency,calculate_priority(payload.importance,payload.urgency),order,now]).map_err(|e|e.to_string())?;
    let id = c.last_insert_rowid();
    list_actions(&c)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "创建行动后读取失败".into())
}
#[tauri::command]
pub fn update_action(state: State<'_, AppState>, payload: UpdateAction) -> Result<Action, String> {
    let base = NewAction {
        event_id: None,
        title: payload.title.clone(),
        description: payload.description.clone(),
        estimated_hours: payload.estimated_hours,
        start_date: payload.start_date.clone(),
        deadline: payload.deadline.clone(),
        is_frog: payload.is_frog,
        importance: payload.importance,
        urgency: payload.urgency,
    };
    validate(&base)?;
    let c = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&c).map_err(|e| e.to_string())?;
    let event_status: Option<i32> = c.query_row("SELECT e.status FROM actions a LEFT JOIN events e ON e.id = a.event_id AND e.space_id = a.space_id AND e.deleted_at IS NULL WHERE a.id = ?1 AND a.space_id = ?2 AND a.deleted_at IS NULL", params![payload.id, space], |r| r.get(0)).optional().map_err(|e| e.to_string())?.flatten();
    if event_status == Some(5) {
        return Err("已完成事件的行动不能编辑".into());
    }
    let n = c.execute("UPDATE actions SET title=?1,description=?2,estimated_hours=?3,start_date=?4,deadline=?5,is_frog=?6,importance=?7,urgency=?8,priority=?9,updated_at=?10 WHERE id=?11 AND space_id=?12 AND deleted_at IS NULL", params![payload.title.trim(), payload.description, payload.estimated_hours, payload.start_date, payload.deadline, payload.is_frog, payload.importance, payload.urgency, calculate_priority(payload.importance, payload.urgency), now_millis(), payload.id, space]).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("行动不存在".into());
    }
    list_actions(&c)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|a| a.id == payload.id)
        .ok_or_else(|| "行动不存在".into())
}

#[tauri::command]
pub fn complete_action(state: State<'_, AppState>, id: i64) -> Result<Action, String> {
    let c = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&c).map_err(|e| e.to_string())?;
    if c.execute("UPDATE actions SET status=1,completed_at=?1,updated_at=?1 WHERE id=?2 AND space_id=?3 AND status=0 AND deleted_at IS NULL",params![now_millis(),id,space]).map_err(|e|e.to_string())?==0{return Err("只有待办行动可以完成".into())}
    list_actions(&c)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "行动不存在".into())
}
#[tauri::command]
pub fn restore_action(state: State<'_, AppState>, id: i64) -> Result<Action, String> {
    let mut c = state.db.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let space = current_space_id(&tx).map_err(|e| e.to_string())?;
    let event: Option<i64> = tx.query_row("SELECT event_id FROM actions WHERE id=?1 AND space_id=?2 AND status=1 AND deleted_at IS NULL", params![id, space], |r| r.get(0)).optional().map_err(|e| e.to_string())?.flatten();
    let Some(event_id) = event else {
        return Err("只有已完成行动可以恢复".into());
    };
    let event_status: Option<i32> = tx
        .query_row(
            "SELECT status FROM events WHERE id=?1 AND space_id=?2 AND deleted_at IS NULL",
            params![event_id, space],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if event_status == Some(5) {
        return Err("已完成事件的行动不能恢复".into());
    }
    let now = now_millis();
    tx.execute(
        "UPDATE actions SET status=0,completed_at=NULL,updated_at=?1 WHERE id=?2 AND space_id=?3",
        params![now, id, space],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("UPDATE events SET status=1,updated_at=?1 WHERE id=?2 AND space_id=?3 AND status=5 AND deleted_at IS NULL", params![now, event_id, space]).map_err(|e| e.to_string())?;
    super::events::revoke_event_completion_tx(&tx, event_id, &space)?;
    tx.commit().map_err(|e| e.to_string())?;
    list_actions(&c)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "行动不存在".into())
}

#[tauri::command]
pub fn delete_action(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut c = state.db.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let space = current_space_id(&tx).map_err(|e| e.to_string())?;
    let relation: Option<(Option<i64>, i32, Option<i32>)> = tx.query_row("SELECT a.event_id,a.is_delegated_follow_up,e.status FROM actions a LEFT JOIN events e ON e.id=a.event_id AND e.space_id=a.space_id AND e.deleted_at IS NULL WHERE a.id=?1 AND a.space_id=?2 AND a.deleted_at IS NULL", params![id, space], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().map_err(|e| e.to_string())?;
    let Some((event, delegated, event_status)) = relation else {
        return Err("行动不存在".into());
    };
    if event_status == Some(5) {
        return Err("已完成事件的行动不能删除".into());
    }
    let now = now_millis();
    tx.execute(
        "UPDATE actions SET deleted_at=?1,updated_at=?1 WHERE id=?2 AND space_id=?3",
        params![now, id, space],
    )
    .map_err(|e| e.to_string())?;
    if delegated == 1 {
        if let Some(event) = event {
            tx.execute("UPDATE events SET status=0,delegated_to=NULL,follow_up_date=NULL,follow_up_note=NULL,updated_at=?1 WHERE id=?2 AND space_id=?3", params![now, event, space]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn complete_delegated_follow_up(
    state: State<'_, AppState>,
    payload: DelegatedFollowUpResolution,
) -> Result<(), String> {
    let mut c = state.db.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let space = current_space_id(&tx).map_err(|e| e.to_string())?;
    let(event,status):(i64,i32)=tx.query_row("SELECT event_id,status FROM actions WHERE id=?1 AND space_id=?2 AND is_delegated_follow_up=1 AND deleted_at IS NULL",params![payload.action_id,space],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
    if status != 1 {
        return Err("委托跟进行动完成后才能处理事件结果".into());
    }
    let now = now_millis();
    match payload.resolution.as_str() {
        "complete" => {
            tx.execute(
                "UPDATE events SET status=5,updated_at=?1 WHERE id=?2 AND space_id=?3",
                params![now, event, space],
            )
            .map_err(|e| e.to_string())?;
            super::events::award_event_completion_tx(&tx, event, &space, 1)?;
        }
        "abandon" => super::events::abandon_event_tx(
            &tx,
            event,
            payload.abandon_reason.as_deref().unwrap_or(""),
            now,
        )?,
        _ => return Err("不支持的委托处理结果".into()),
    };
    tx.commit().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn reorder_event_actions(
    state: State<'_, AppState>,
    payload: ReorderEventActions,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    if payload.action_ids.iter().any(|id| !seen.insert(*id)) {
        return Err("行动排序列表包含重复行动".into());
    }
    let mut c = state.db.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let space = current_space_id(&tx).map_err(|e| e.to_string())?;
    let event_status: Option<i32> = tx
        .query_row(
            "SELECT status FROM events WHERE id=?1 AND space_id=?2 AND deleted_at IS NULL",
            params![payload.event_id, space],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if event_status != Some(1) {
        return Err("只有进行中的事件可以调整行动顺序".into());
    }
    for (i, id) in payload.action_ids.iter().enumerate() {
        if tx.execute("UPDATE actions SET sort_order=?1,updated_at=?2 WHERE id=?3 AND event_id=?4 AND space_id=?5 AND deleted_at IS NULL", params![i as i64 + 1, now_millis(), id, payload.event_id, space]).map_err(|e| e.to_string())? == 0 { return Err("行动不属于当前事件".into()); }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
