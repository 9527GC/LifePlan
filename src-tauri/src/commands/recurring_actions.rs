use crate::commands::calculate_priority;
use crate::db::{current_space_id, new_uuid, now_millis};
use crate::models::{
    Action, NewRecurringAction, RecurringAction, ReorderRecurringActions, UpdateRecurringAction,
};
use crate::AppState;
use chrono::{Datelike, NaiveDate};
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
        auto_schedule: row.get(9)?,
        schedule_type: row.get(10)?,
        schedule_days: row.get(11)?,
        start_time: row.get(12)?,
        sort_order: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn list_recurring_actions(conn: &Connection) -> rusqlite::Result<Vec<RecurringAction>> {
    let space_id = current_space_id(conn)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut statement = conn.prepare(
        "SELECT id, title, estimated_hours, is_frog, importance, urgency, priority,
                frequency_unit, frequency_count, auto_schedule, schedule_type, schedule_days,
                start_time, sort_order, created_at, updated_at
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
    if ![0, 1].contains(&payload.auto_schedule) {
        return Err("自动安排设置无效".into());
    }
    if !matches!(
        payload.schedule_type.as_str(),
        "daily" | "workday" | "weekly" | "monthly"
    ) {
        return Err("重复规则无效".into());
    }
    if time_minutes(&payload.start_time).is_none() {
        return Err("开始时间必须为半小时刻度".into());
    }
    let days = parse_schedule_days(&payload.schedule_days);
    if payload.auto_schedule == 1
        && ((payload.schedule_type == "weekly"
            && (days.is_empty() || days.iter().any(|day| !(1..=7).contains(day))))
            || (payload.schedule_type == "monthly"
                && (days.is_empty() || days.iter().any(|day| !(1..=31).contains(day)))))
    {
        return Err("请选择有效的重复日期".into());
    }
    Ok(())
}

fn time_minutes(value: &str) -> Option<i32> {
    let (hour, minute) = value.split_once(':')?;
    let hour = hour.parse::<i32>().ok()?;
    let minute = minute.parse::<i32>().ok()?;
    if (0..24).contains(&hour) && [0, 30].contains(&minute) {
        Some(hour * 60 + minute)
    } else {
        None
    }
}

fn parse_schedule_days(value: &str) -> Vec<u32> {
    value
        .split(',')
        .filter_map(|item| item.trim().parse::<u32>().ok())
        .collect()
}

fn matches_date(schedule_type: &str, schedule_days: &str, date: NaiveDate) -> bool {
    match schedule_type {
        "daily" => true,
        "workday" => date.weekday().number_from_monday() <= 5,
        "weekly" => {
            parse_schedule_days(schedule_days).contains(&date.weekday().number_from_monday())
        }
        "monthly" => parse_schedule_days(schedule_days).contains(&date.day()),
        _ => false,
    }
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
    let priority = calculate_priority(0, 0);
    conn.execute(
        "INSERT INTO recurring_actions (space_id, sync_id, title, estimated_hours, is_frog, importance, urgency, priority, frequency_unit, frequency_count, auto_schedule, schedule_type, schedule_days, start_time, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
        params![
            space_id,
            new_uuid(),
            payload.title.trim(),
            payload.estimated_hours,
            payload.is_frog,
            0,
            0,
            priority,
            payload.frequency_unit,
            payload.frequency_count,
            payload.auto_schedule,
            payload.schedule_type,
            payload.schedule_days,
            payload.start_time,
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
        auto_schedule: payload.auto_schedule,
        schedule_type: payload.schedule_type,
        schedule_days: payload.schedule_days,
        start_time: payload.start_time,
    };
    validate_payload(&values)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let timestamp = now_millis();
    let priority = calculate_priority(0, 0);
    let changed = conn
        .execute(
            "UPDATE recurring_actions
             SET title = ?1, estimated_hours = ?2, is_frog = ?3, importance = ?4,
                 urgency = ?5, priority = ?6, frequency_unit = ?7, frequency_count = ?8,
                 auto_schedule = ?9, schedule_type = ?10, schedule_days = ?11, start_time = ?12,
                 updated_at = ?13
             WHERE id = ?14 AND space_id = ?15 AND deleted_at IS NULL",
            params![
                values.title.trim(),
                values.estimated_hours,
                values.is_frog,
                0,
                0,
                priority,
                values.frequency_unit,
                values.frequency_count,
                values.auto_schedule,
                values.schedule_type,
                values.schedule_days,
                values.start_time,
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

#[derive(Debug)]
struct AutoTemplate {
    title: String,
    estimated_hours: f64,
    is_frog: i32,
    schedule_type: String,
    schedule_days: String,
    start_time: String,
}

#[derive(Debug)]
struct AvailableSlot {
    id: i64,
    start_time: String,
    end_time: String,
    action_id: Option<i64>,
}

pub fn initialize_for_date(
    conn: &mut Connection,
    list_date: &str,
    trigger_source: &str,
) -> Result<(), String> {
    let date =
        NaiveDate::parse_from_str(list_date, "%Y-%m-%d").map_err(|_| "日期格式无效".to_string())?;
    crate::commands::daily_schedule::ensure_day(conn, list_date)?;
    let space_id = current_space_id(conn).map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let inserted = tx
        .execute(
            "INSERT OR IGNORE INTO daily_recurring_initializations (space_id, list_date, trigger_source, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![space_id, list_date, trigger_source, now_millis()],
        )
        .map_err(|error| error.to_string())?;
    if inserted == 0 {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let templates = {
        let mut statement = tx
            .prepare(
                "SELECT title, estimated_hours, is_frog,
                        schedule_type, schedule_days, start_time
                 FROM recurring_actions
                 WHERE space_id = ?1 AND deleted_at IS NULL AND auto_schedule = 1
                 ORDER BY sort_order, id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([&space_id], |row| {
                Ok(AutoTemplate {
                    title: row.get(0)?,
                    estimated_hours: row.get(1)?,
                    is_frog: row.get(2)?,
                    schedule_type: row.get(3)?,
                    schedule_days: row.get(4)?,
                    start_time: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        rows
    };

    for template in templates {
        if !matches_date(&template.schedule_type, &template.schedule_days, date) {
            continue;
        }
        let slots = {
            let mut statement = tx
                .prepare(
                    "SELECT id, start_time, end_time, action_id
                     FROM daily_schedule_slots
                     WHERE space_id = ?1 AND list_date = ?2
                     ORDER BY start_time, sort_order, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(params![space_id, list_date], |row| {
                    Ok(AvailableSlot {
                        id: row.get(0)?,
                        start_time: row.get(1)?,
                        end_time: row.get(2)?,
                        action_id: row.get(3)?,
                    })
                })
                .map_err(|error| error.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        let Some(start_index) = slots.iter().position(|slot| {
            slot.start_time.as_str() <= template.start_time.as_str()
                && template.start_time.as_str() < slot.end_time.as_str()
        }) else {
            continue;
        };
        if slots[start_index].action_id.is_some() {
            continue;
        }

        let required_minutes = (template.estimated_hours * 60.0).round() as i32;
        let mut selected_ids = Vec::new();
        let mut arranged_minutes = 0;
        let mut previous_end: Option<&str> = None;
        for slot in slots.iter().skip(start_index) {
            if slot.action_id.is_some()
                || previous_end.is_some_and(|end| end != slot.start_time.as_str())
            {
                break;
            }
            let Some(start) = time_minutes(&slot.start_time) else {
                break;
            };
            let Some(end) = time_minutes(&slot.end_time) else {
                break;
            };
            selected_ids.push(slot.id);
            arranged_minutes += end - start;
            previous_end = Some(&slot.end_time);
            if arranged_minutes >= required_minutes {
                break;
            }
        }
        if selected_ids.is_empty() {
            continue;
        }

        let timestamp = now_millis();
        tx.execute(
            "INSERT INTO actions (space_id, sync_id, title, estimated_hours, is_frog, importance, urgency, priority, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                space_id,
                new_uuid(),
                template.title,
                template.estimated_hours,
                template.is_frog,
                0,
                0,
                calculate_priority(0, 0),
                timestamp,
            ],
        )
        .map_err(|error| error.to_string())?;
        let action_id = tx.last_insert_rowid();
        for slot_id in selected_ids {
            tx.execute(
                "UPDATE daily_schedule_slots SET action_id = ?1, updated_at = ?2
                 WHERE id = ?3 AND space_id = ?4 AND action_id IS NULL",
                params![action_id, timestamp, slot_id, space_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn initialize_recurring_actions_for_date(
    state: State<'_, AppState>,
    list_date: String,
    trigger_source: String,
) -> Result<(), String> {
    if !matches!(trigger_source.as_str(), "app_start" | "daily_review") {
        return Err("自动安排触发来源无效".into());
    }
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    initialize_for_date(&mut conn, &list_date, &trigger_source)
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
        params![space_id, new_uuid(), template.0, template.1, template.2, 0, 0, calculate_priority(0, 0), timestamp],
    )
    .map_err(|error| error.to_string())?;
    let action_id = conn.last_insert_rowid();
    super::actions::list_actions(&conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| "生成行动后读取失败".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ensure_current_space, migrations};

    #[test]
    fn 重复规则能匹配工作日星期和每月日期() {
        let monday = NaiveDate::from_ymd_opt(2026, 10, 12).expect("日期有效");
        let sunday = NaiveDate::from_ymd_opt(2026, 10, 11).expect("日期有效");
        assert!(matches_date("daily", "", sunday));
        assert!(matches_date("workday", "", monday));
        assert!(!matches_date("workday", "", sunday));
        assert!(matches_date("weekly", "1,3,5", monday));
        assert!(!matches_date("weekly", "2,4", monday));
        assert!(matches_date("monthly", "1,12,31", monday));
    }

    #[test]
    fn 自动安排包含开始时间的整段并在后续冲突处停止() {
        let mut conn = Connection::open_in_memory().expect("创建内存数据库失败");
        conn.execute_batch(migrations::INIT_MIGRATION)
            .expect("初始化数据库失败");
        let space_id = ensure_current_space(&mut conn).expect("初始化空间失败");
        let timestamp = now_millis();
        conn.execute(
            "INSERT INTO daily_schedule_template_meta (space_id, updated_at) VALUES (?1, ?2)",
            params![space_id, timestamp],
        )
        .expect("初始化日程模板标记失败");
        for (index, (start, end)) in [("06:30", "07:30"), ("07:30", "08:00"), ("08:00", "08:30")]
            .iter()
            .enumerate()
        {
            conn.execute(
                "INSERT INTO daily_schedule_templates (space_id, start_time, end_time, sort_order, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![space_id, start, end, index as i64, timestamp],
            )
            .expect("创建日程模板失败");
        }
        conn.execute(
            "INSERT INTO actions (space_id, sync_id, title, estimated_hours, is_frog, importance, urgency, priority, created_at, updated_at) VALUES (?1, ?2, '已有行动', 0.5, 0, 1, 1, 1, ?3, ?3)",
            params![space_id, new_uuid(), timestamp],
        )
        .expect("创建占位行动失败");
        let blocker_id = conn.last_insert_rowid();
        crate::commands::daily_schedule::ensure_day(&conn, "2026-10-12")
            .expect("初始化当日日程失败");
        conn.execute(
            "UPDATE daily_schedule_slots SET action_id = ?1 WHERE space_id = ?2 AND list_date = '2026-10-12' AND start_time = '08:00'",
            params![blocker_id, space_id],
        )
        .expect("占用冲突时间段失败");
        conn.execute(
            "INSERT INTO recurring_actions (space_id, sync_id, title, estimated_hours, is_frog, importance, urgency, priority, frequency_unit, frequency_count, auto_schedule, schedule_type, schedule_days, start_time, sort_order, created_at, updated_at)
             VALUES (?1, ?2, '晨间行动', 2, 0, 1, 1, 1, 'daily', 1, 0, 'daily', '', '07:00', 0, ?3, ?3)",
            params![space_id, new_uuid(), timestamp],
        )
        .expect("创建重复行动失败");

        // 存量模板尚未确认新版规则，不应按迁移默认值自动生成。
        initialize_for_date(&mut conn, "2026-10-11", "app_start").expect("处理存量模板失败");
        let legacy_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM actions WHERE title = '晨间行动'",
                [],
                |row| row.get(0),
            )
            .expect("检查存量模板实例失败");
        assert_eq!(legacy_count, 0);
        // 模拟用户在新版表单中确认保存。
        conn.execute("UPDATE recurring_actions SET auto_schedule = 1", [])
            .expect("确认重复规则失败");

        initialize_for_date(&mut conn, "2026-10-11", "daily_review")
            .expect("再次处理已初始化日期失败");
        let same_day_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM actions WHERE title = '晨间行动'",
                [],
                |row| row.get(0),
            )
            .expect("检查当天补排失败");
        assert_eq!(same_day_count, 0, "旧模板确认后不应补排已处理日期");

        initialize_for_date(&mut conn, "2026-10-12", "app_start").expect("首次自动安排失败");
        initialize_for_date(&mut conn, "2026-10-12", "app_start").expect("重复自动安排失败");

        let generated_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM actions WHERE space_id = ?1 AND title = '晨间行动'",
                [&space_id],
                |row| row.get(0),
            )
            .expect("查询生成行动失败");
        assert_eq!(generated_count, 1);
        let classification: (i32, i32, i32) = conn
            .query_row(
                "SELECT importance, urgency, priority FROM actions WHERE title = '晨间行动'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("检查生成行动分类失败");
        assert_eq!(classification, (0, 0, calculate_priority(0, 0)));
        let assigned: Vec<(String, String)> = {
            let mut statement = conn
                .prepare(
                    "SELECT start_time, end_time FROM daily_schedule_slots
                     WHERE space_id = ?1 AND list_date = '2026-10-12'
                       AND action_id = (SELECT id FROM actions WHERE title = '晨间行动')
                     ORDER BY start_time",
                )
                .expect("准备查询失败");
            let rows = statement
                .query_map([&space_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("查询安排时间段失败")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("收集安排时间段失败");
            rows
        };
        assert_eq!(
            assigned,
            vec![
                ("06:30".to_string(), "07:30".to_string()),
                ("07:30".to_string(), "08:00".to_string()),
            ]
        );
    }
}
