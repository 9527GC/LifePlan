use crate::db::{current_space_id, new_uuid, now_millis};
use crate::models::{
    NewReward, Reward, RewardCheckin, RewardCheckinBrief, RewardExchange, RewardsOverview, UpdateReward,
};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
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
    let mut stmt = conn.prepare("SELECT x.id, x.reward_id, r.name, x.points_used, x.exchanged_at, c.description, c.created_at, c.updated_at FROM reward_exchanges x JOIN rewards r ON r.id = x.reward_id LEFT JOIN reward_checkins c ON c.exchange_id = x.id WHERE x.space_id = ?1 ORDER BY x.exchanged_at DESC LIMIT 20")?;
    let exchanges = stmt
        .query_map([space], |row| {
            let checkin_created: Option<i64> = row.get(6)?;
            let checkin = checkin_created.map(|created_at| RewardCheckinBrief {
                description: row.get(5).ok().flatten(),
                created_at,
                updated_at: row.get(7).ok().unwrap_or(created_at),
            });
            Ok(RewardExchange {
                id: row.get(0)?,
                reward_id: row.get(1)?,
                reward_name: row.get(2)?,
                points_used: row.get(3)?,
                exchanged_at: row.get(4)?,
                checkin,
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


/// 打卡图片存放目录（与数据库同级的 checkins 文件夹）。
fn checkins_dir() -> Result<PathBuf, String> {
    let db = crate::db::db_path().map_err(|error| error.to_string())?;
    let dir = db
        .parent()
        .map(|parent| parent.join("checkins"))
        .ok_or_else(|| "无法定位应用数据目录".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建打卡目录失败：{error}"))?;
    Ok(dir)
}

/// 解析 dataURL，返回（图片扩展名, 二进制数据）。
fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (mime_part, b64_part) = match data_url.find("base64,") {
        Some(index) => (&data_url[..index], &data_url[index + "base64,".len()..]),
        None => ("", data_url),
    };
    let ext = if mime_part.contains("jpeg") || mime_part.contains("jpg") {
        "jpg"
    } else if mime_part.contains("webp") {
        "webp"
    } else if mime_part.contains("gif") {
        "gif"
    } else {
        "png"
    };
    let bytes = B64
        .decode(b64_part.trim())
        .map_err(|error| format!("图片数据解析失败：{error}"))?;
    Ok((ext.to_string(), bytes))
}

fn ext_to_mime(ext: &str) -> &str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

#[tauri::command]
pub fn save_reward_checkin(
    state: State<'_, AppState>,
    exchange_id: i64,
    image_base64: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM reward_exchanges WHERE id = ?1 AND space_id = ?2)",
            params![exchange_id, &space],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("兑换记录不存在".into());
    }
    let old_image: Option<String> = conn
        .query_row(
            "SELECT image_path FROM reward_checkins WHERE exchange_id = ?1",
            [exchange_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    let mut image_path = old_image.clone();
    let trimmed = description.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    if let Some(data_url) = image_base64.filter(|value| !value.trim().is_empty()) {
        let (ext, bytes) = decode_data_url(&data_url)?;
        let filename = format!("{}.{}", new_uuid(), ext);
        let dir = checkins_dir()?;
        std::fs::write(dir.join(&filename), &bytes).map_err(|error| format!("保存图片失败：{error}"))?;
        if let Some(old) = old_image.as_ref() {
            let _ = std::fs::remove_file(dir.join(old));
        }
        image_path = Some(filename);
    }
    let now = now_millis();
    conn.execute(
        "INSERT INTO reward_checkins (space_id, exchange_id, image_path, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(exchange_id) DO UPDATE SET image_path = ?3, description = ?4, updated_at = ?5",
        params![&space, exchange_id, image_path, trimmed, now],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_reward_checkin(state: State<'_, AppState>, exchange_id: i64) -> Result<RewardCheckin, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let space = current_space_id(&conn).map_err(|error| error.to_string())?;
    let row = conn
        .query_row(
            "SELECT x.id, r.name, r.icon, x.points_used, x.exchanged_at, c.description, c.image_path, c.created_at, c.updated_at FROM reward_checkins c JOIN reward_exchanges x ON x.id = c.exchange_id JOIN rewards r ON r.id = x.reward_id WHERE c.exchange_id = ?1 AND x.space_id = ?2",
            params![exchange_id, &space],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "打卡记录不存在".to_string())?;
    let image_base64 = match row.6.as_ref() {
        Some(filename) => {
            let path = checkins_dir()?.join(filename);
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let ext = path
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("png")
                        .to_ascii_lowercase();
                    Some(format!("data:{};base64,{}", ext_to_mime(&ext), B64.encode(&bytes)))
                }
                Err(_) => None,
            }
        }
        None => None,
    };
    Ok(RewardCheckin {
        exchange_id: row.0,
        reward_name: row.1,
        icon: row.2,
        points_used: row.3,
        exchanged_at: row.4,
        description: row.5,
        image_base64,
        created_at: row.7,
        updated_at: row.8,
    })
}

/// 将海报（dataURL）保存到系统下载目录，返回完整文件路径。
#[tauri::command]
pub fn save_reward_poster(image_base64: String) -> Result<String, String> {
    let (_ext, bytes) = decode_data_url(&image_base64)?;
    let dir = dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .or_else(|| crate::db::db_path().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())))
        .ok_or_else(|| "无法定位保存目录".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建保存目录失败：{error}"))?;
    let filename = format!("LifePlan打卡_{}.png", now_millis());
    let path = dir.join(&filename);
    std::fs::write(&path, &bytes).map_err(|error| format!("保存海报失败：{error}"))?;
    Ok(path.display().to_string())
}
