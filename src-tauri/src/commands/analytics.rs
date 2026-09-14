use crate::db::{now_millis, AppState};
use rusqlite::params;
use serde::Serialize;
use tauri::State;

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
    state: State<'_, AppState>,
    event_name: String,
    payload_json: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO analytics_events (event_name, occurred_at, app_version, platform, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![event_name, now_millis(), env!("CARGO_PKG_VERSION"), std::env::consts::OS, payload_json],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_analytics_events(
    state: State<'_, AppState>,
) -> Result<Vec<AnalyticsLogEntry>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let mut statement = conn.prepare(
        "SELECT id, event_name, occurred_at, app_version, platform, payload_json FROM analytics_events ORDER BY id ASC",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
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
