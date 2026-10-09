use crate::db::{now_millis, AppState};
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, State};

const ANALYTICS_LOOKBACK_MILLIS: i64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_RECENT_ANALYTICS_EVENTS: i64 = 2_000;
const FALLBACK_ANALYTICS_EVENTS: i64 = 200;

#[derive(Debug, Serialize)]
pub struct AnalyticsLogEntry {
    pub id: i64,
    pub event_name: String,
    pub occurred_at: i64,
    pub app_version: String,
    pub platform: String,
    pub payload_json: String,
}

#[tauri::command]
pub fn record_analytics_event(
    app: AppHandle,
    state: State<'_, AppState>,
    event_name: String,
    payload_json: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO analytics_events (event_name, occurred_at, app_version, platform, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            event_name,
            now_millis(),
            app.package_info().version.to_string(),
            std::env::consts::OS,
            payload_json
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_analytics_events(
    conn: &rusqlite::Connection,
    query: &str,
    query_params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<AnalyticsLogEntry>, String> {
    let mut statement = conn.prepare(query).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(query_params, |row| {
            Ok(AnalyticsLogEntry {
                id: row.get(0)?,
                event_name: row.get(1)?,
                occurred_at: row.get(2)?,
                app_version: row.get(3)?,
                platform: row.get(4)?,
                payload_json: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_analytics_events(
    state: State<'_, AppState>,
) -> Result<Vec<AnalyticsLogEntry>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let cutoff = now_millis() - ANALYTICS_LOOKBACK_MILLIS;
    let recent_events = read_analytics_events(
        &conn,
        "SELECT id, event_name, occurred_at, app_version, platform, payload_json
         FROM analytics_events
         WHERE occurred_at >= ?1
         ORDER BY id ASC
         LIMIT ?2",
        &[&cutoff, &MAX_RECENT_ANALYTICS_EVENTS],
    )?;

    // 新安装或长时间未使用时，保留少量最近日志，避免反馈附件完全没有上下文。
    if recent_events.is_empty() {
        return read_analytics_events(
            &conn,
            "SELECT id, event_name, occurred_at, app_version, platform, payload_json
             FROM analytics_events
             ORDER BY id DESC
             LIMIT ?1",
            &[&FALLBACK_ANALYTICS_EVENTS],
        )
        .map(|mut events| {
            events.reverse();
            events
        });
    }

    Ok(recent_events)
}
