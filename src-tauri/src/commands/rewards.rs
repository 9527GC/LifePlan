use crate::db::{current_space_id, now_millis};
use crate::models::{NewReward, Reward, RewardExchange, RewardsOverview, UpdateReward};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

fn row_reward(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reward> {
    Ok(Reward {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        points_required: row.get(3)?,
        category: row.get(4)?,
        icon: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn list_rewards(conn: &Connection, space: &str) -> rusqlite::Result<Vec<Reward>> {
    let mut stmt = conn.prepare("SELECT id, name, description, points_required, category, icon, status, created_at, updated_at FROM rewards WHERE space_id = ?1 AND status = 0 ORDER BY points_required, created_at DESC")?;
    let rows = stmt.query_map([space], row_reward)?.collect();
    rows
}

fn overview(conn: &Connection, space: &str) -> rusqlite::Result<RewardsOverview> {
    let total = conn
        .query_row(
            "SELECT COALESCE(total_points, 0) FROM user_points WHERE space_id = ?1",
            [space],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let mut stmt = conn.prepare("SELECT x.id, x.reward_id, r.name, x.points_used, x.exchanged_at FROM reward_exchanges x JOIN rewards r ON r.id = x.reward_id WHERE x.space_id = ?1 ORDER BY x.exchanged_at DESC LIMIT 20")?;
    let exchanges = stmt
        .query_map([space], |row| {
            Ok(RewardExchange {
                id: row.get(0)?,
                reward_id: row.get(1)?,
                reward_name: row.get(2)?,
                points_used: row.get(3)?,
                exchanged_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(RewardsOverview {
        total_points: total,
        rewards: list_rewards(conn, space)?,
        exchanges,
    })
}

fn validate(payload: &NewReward) -> Result<(), String> {
    if payload.name.trim().is_empty() {
        return Err("请输入奖励名称".into());
    }
    if payload.points_required <= 0 {
        return Err("所需积分必须大于 0".into());
    }
    if payload.category.trim().is_empty() {
        return Err("请选择奖励分类".into());
    }
    if payload.icon.trim().is_empty() {
        return Err("请选择奖励图标".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_rewards_overview(state: State<'_, AppState>) -> Result<RewardsOverview, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    overview(&conn, &space).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_reward(state: State<'_, AppState>, payload: NewReward) -> Result<Reward, String> {
    validate(&payload)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO rewards (space_id, name, description, points_required, category, icon, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
        params![space, payload.name.trim(), payload.description, payload.points_required, payload.category.trim(), payload.icon.trim(), now],
    )
    .map_err(|error| error.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, name, description, points_required, category, icon, status, created_at, updated_at FROM rewards WHERE id = ?1",
        [id],
        row_reward,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_reward(state: State<'_, AppState>, payload: UpdateReward) -> Result<Reward, String> {
    let new_payload = NewReward {
        name: payload.name,
        description: payload.description,
        points_required: payload.points_required,
        category: payload.category,
        icon: payload.icon,
    };
    validate(&new_payload)?;
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE rewards SET name = ?1, description = ?2, points_required = ?3, category = ?4, icon = ?5, updated_at = ?6 WHERE id = ?7 AND space_id = ?8 AND status = 0",
            params![new_payload.name.trim(), new_payload.description, new_payload.points_required, new_payload.category.trim(), new_payload.icon.trim(), now_millis(), payload.id, space],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("奖励不存在或已归档".into());
    }
    conn.query_row(
        "SELECT id, name, description, points_required, category, icon, status, created_at, updated_at FROM rewards WHERE id = ?1",
        [payload.id],
        row_reward,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn archive_reward(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE rewards SET status = 1, updated_at = ?1 WHERE id = ?2 AND space_id = ?3",
        params![now_millis(), id, space],
    )
    .map_err(|error| error.to_string())
    .map(|_| ())
}

#[tauri::command]
pub fn exchange_reward(
    state: State<'_, AppState>,
    reward_id: i64,
) -> Result<RewardsOverview, String> {
    let mut conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let cost: i64 = tx
        .query_row(
            "SELECT points_required FROM rewards WHERE id = ?1 AND space_id = ?2 AND status = 0",
            params![reward_id, &space],
            |row| row.get(0),
        )
        .map_err(|_| "奖励不存在或已归档".to_string())?;
    let balance: i64 = tx
        .query_row(
            "SELECT COALESCE(total_points, 0) FROM user_points WHERE space_id = ?1",
            [&space],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0);
    if balance < cost {
        return Err(format!("积分不足，还需要 {} 积分", cost - balance));
    }
    let now = now_millis();
    tx.execute("UPDATE user_points SET total_points = total_points - ?1, updated_at = ?2 WHERE space_id = ?3", params![cost, now, &space]).map_err(|error| error.to_string())?;
    tx.execute("INSERT INTO reward_exchanges (space_id, reward_id, points_used, exchanged_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![&space, reward_id, cost, now]).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    overview(&conn, &space).map_err(|error| error.to_string())
}
