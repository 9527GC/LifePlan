use crate::db::{current_space_id, now_millis};
use crate::models::{
    DailyReview, DailyReviewDraft, DailyReviewSuggestion, DailyReviewSummary, DailyReviewView,
};
use crate::AppState;
use chrono::NaiveDate;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use tauri::State;

const REVIEW_REASONS: [&str; 7] = [
    "plan",
    "priority",
    "interrupt",
    "dependency",
    "clarity",
    "energy",
    "other",
];
fn valid_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

#[tauri::command]
pub fn get_daily_review(
    state: State<'_, AppState>,
    review_date: String,
) -> Result<DailyReviewView, String> {
    if !valid_date(&review_date) {
        return Err("日期格式无效".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let space_id = current_space_id(&conn).map_err(|e| e.to_string())?;
    let review = conn.query_row("SELECT overall_status, reflection_text FROM daily_reviews WHERE space_id = ?1 AND review_date = ?2", params![space_id, review_date], |row| Ok(DailyReview { review_date: review_date.clone(), overall_status: row.get(0)?, reflection_text: row.get(1)? }))
        .optional().map_err(|e| e.to_string())?.unwrap_or(DailyReview { review_date: review_date.clone(), overall_status: None, reflection_text: None });
    let summary = calculate_summary(&conn, &space_id, &review_date).map_err(|e| e.to_string())?;
    Ok(DailyReviewView { review, summary })
}

#[tauri::command]
pub fn save_daily_review_draft(
    state: State<'_, AppState>,
    payload: DailyReviewDraft,
) -> Result<DailyReview, String> {
    if !valid_date(&payload.review_date) {
        return Err("日期格式无效".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let space_id = current_space_id(&conn).map_err(|e| e.to_string())?;
    let now = now_millis();
    conn.execute("INSERT INTO daily_reviews (space_id, review_date, overall_status, reflection_text, updated_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(space_id, review_date) DO UPDATE SET overall_status=excluded.overall_status, reflection_text=excluded.reflection_text, updated_at=excluded.updated_at", params![space_id, payload.review_date, payload.overall_status, payload.reflection_text, now]).map_err(|e| e.to_string())?;
    drop(conn);
    get_daily_review(state, payload.review_date).map(|view| view.review)
}

#[tauri::command]
pub fn get_daily_review_suggestions(
    state: State<'_, AppState>,
    plan_date: String,
) -> Result<Vec<DailyReviewSuggestion>, String> {
    let plan_date_value = NaiveDate::parse_from_str(&plan_date, "%Y-%m-%d")
        .map_err(|_| "日期格式无效".to_string())?;
    let window_start = plan_date_value
        .pred_opt()
        .and_then(|date| date.checked_sub_signed(chrono::Duration::days(6)))
        .ok_or_else(|| "日期范围无效".to_string())?;
    let window_end = plan_date_value
        .pred_opt()
        .ok_or_else(|| "日期范围无效".to_string())?;
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let space_id = current_space_id(&conn).map_err(|error| error.to_string())?;
    let mut statement = conn.prepare("SELECT list_date, primary_review_reason FROM daily_schedule_slots WHERE space_id = ?1 AND list_date >= ?2 AND list_date <= ?3 AND primary_review_reason IS NOT NULL AND (met_expectation = 0 OR focused = 0)").map_err(|error| error.to_string())?;
    let records = statement
        .query_map(
            params![
                space_id,
                window_start.format("%Y-%m-%d").to_string(),
                window_end.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(build_review_suggestions(records))
}

fn build_review_suggestions(
    records: impl IntoIterator<Item = (String, String)>,
) -> Vec<DailyReviewSuggestion> {
    let mut occurrence_dates: HashMap<String, HashSet<String>> = HashMap::new();
    for (review_date, reason) in records {
        if REVIEW_REASONS.contains(&reason.as_str()) && reason != "other" {
            occurrence_dates
                .entry(reason)
                .or_default()
                .insert(review_date);
        }
    }
    let mut suggestions: Vec<DailyReviewSuggestion> = occurrence_dates
        .into_iter()
        .filter_map(|(reason, dates)| {
            let occurrence_days = dates.len() as i64;
            if occurrence_days < 3 {
                return None;
            }
            let suggestion = match reason.as_str() {
                "plan" => "减少安排量，为同类任务预留缓冲。",
                "priority" => "明确明日最重要事项，避免临时切换。",
                "interrupt" => "预留缓冲时间，集中处理临时事项。",
                "dependency" => "提前确认前置条件，并准备替代任务。",
                "clarity" => "安排前先明确下一步和完成标准。",
                "energy" => "将高认知任务安排在精力较好的时段。",
                _ => return None,
            };
            Some(DailyReviewSuggestion {
                reason,
                occurrence_days,
                suggestion: suggestion.into(),
            })
        })
        .collect();
    suggestions.sort_by(|left, right| {
        right
            .occurrence_days
            .cmp(&left.occurrence_days)
            .then_with(|| left.reason.cmp(&right.reason))
    });
    suggestions
}

fn calculate_summary(
    conn: &rusqlite::Connection,
    space_id: &str,
    date: &str,
) -> rusqlite::Result<DailyReviewSummary> {
    let (planned_event_count, completed_event_count, incomplete_event_count, involved_event_count): (i64, i64, i64, i64) = conn.query_row("SELECT COUNT(DISTINCT d.action_id), COUNT(DISTINCT CASE WHEN a.status = 1 THEN d.action_id END), COUNT(DISTINCT CASE WHEN a.status != 1 THEN d.action_id END), COUNT(DISTINCT CASE WHEN a.event_id IS NOT NULL THEN a.event_id END) FROM daily_schedule_slots d LEFT JOIN actions a ON a.id = d.action_id AND a.space_id = d.space_id AND a.deleted_at IS NULL WHERE d.space_id = ?1 AND d.list_date = ?2 AND d.action_id IS NOT NULL", params![space_id, date], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?;
    let mut quadrants = serde_json::Map::new();
    let mut statement = conn.prepare("SELECT a.importance, a.urgency, COUNT(DISTINCT d.action_id), COUNT(DISTINCT CASE WHEN a.status = 1 THEN d.action_id END), COALESCE(SUM((CAST(substr(d.end_time, 1, 2) AS INTEGER) * 60 + CAST(substr(d.end_time, 4, 2) AS INTEGER)) - (CAST(substr(d.start_time, 1, 2) AS INTEGER) * 60 + CAST(substr(d.start_time, 4, 2) AS INTEGER))), 0) FROM daily_schedule_slots d JOIN actions a ON a.id = d.action_id AND a.space_id = d.space_id AND a.deleted_at IS NULL WHERE d.space_id = ?1 AND d.list_date = ?2 GROUP BY a.importance, a.urgency")?;
    let rows = statement.query_map(params![space_id, date], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    for row in rows {
        let (importance, urgency, count, completed_count, planned_minutes) = row?;
        quadrants.insert(format!("{}{}", importance, urgency), serde_json::json!({ "count": count, "completed_count": completed_count, "planned_minutes": planned_minutes }));
    }
    Ok(DailyReviewSummary {
        planned_event_count,
        completed_event_count,
        incomplete_event_count,
        involved_event_count,
        quadrants_json: serde_json::Value::Object(quadrants).to_string(),
    })
}
