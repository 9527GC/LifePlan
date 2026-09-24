use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

pub mod backup;
pub mod migrations;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("database connection failed: {0}")]
    ConnectionFailed(#[from] rusqlite::Error),
    #[error("database path failed: {0}")]
    PathFailed(String),
    #[error("migration failed: {0}")]
    MigrationFailed(String),
    #[error("unknown database error: {0}")]
    Other(String),
    #[error("数据库版本 v{version} 高于当前程序支持的最高版本 v{max}")]
    SchemaTooNew { version: i32, max: i32 },
}

#[derive(Debug)]
pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: PathBuf,
    pub startup_notice: Mutex<Option<crate::models::StartupNotice>>,
}

pub fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

impl AppState {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self, DbError> {
        let db_path = db_path.as_ref().to_path_buf();
        let existed = db_path.exists();
        let mut startup_notice = None;

        if existed {
            if let Err(error) = backup::create_startup_backup(&db_path) {
                startup_notice = Some(crate::models::StartupNotice {
                    kind: "backup_warning".into(),
                    message: format!("启动备份失败，应用仍可使用：{error}"),
                });
            }
        }

        let mut conn = Connection::open(&db_path)?;
        let schema_version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        if existed
            && schema_version > 0
            && schema_version < migrations::CURRENT_SCHEMA_VERSION
        {
            backup::create_migration_backup(&db_path).map_err(|error| {
                DbError::MigrationFailed(format!("创建迁移前备份失败，已取消升级以保护数据：{error}"))
            })?;
        }
        run_migrations(&mut conn)?;
        ensure_current_space(&mut conn)?;

        Ok(Self {
            db: Mutex::new(conn),
            db_path,
            startup_notice: Mutex::new(startup_notice),
        })
    }
}

pub fn init_db() -> Result<AppState, DbError> {
    let path = db_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| DbError::PathFailed("unable to resolve database directory".into()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| DbError::PathFailed(format!("create database directory: {error}")))?;
    AppState::new(path)
}

/// 解析当前渠道的应用数据根目录。
/// 生产构建保持既有目录名 `LifePlanTodolist`（不影响老用户）；
/// 通过 `LIFEPLAN_ENV`（运行时优先，其次编译期 `LIFEPLAN_BUILD_ENV`）区分内测/预发渠道，
/// 本地 debug 构建自动落到 `-dev` 目录，避免非生产构建迁移正式数据库导致旧版本打不开。
pub fn app_data_dir() -> Result<PathBuf, DbError> {
    let base = dirs::data_dir()
        .ok_or_else(|| DbError::PathFailed("unable to resolve system data directory".into()))?;
    Ok(base.join(channel_data_folder()))
}

fn channel_data_folder() -> String {
    match channel_suffix().as_deref() {
        Some(suffix) => format!("LifePlanTodolist-{suffix}"),
        None => "LifePlanTodolist".to_string(),
    }
}

fn channel_suffix() -> Option<String> {
    let raw = std::env::var("LIFEPLAN_ENV")
        .ok()
        .or_else(|| option_env!("LIFEPLAN_BUILD_ENV").map(|value| value.to_string()))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value != "production" && value != "prod");
    if raw.is_some() {
        return raw;
    }
    #[cfg(debug_assertions)]
    {
        return Some("dev".to_string());
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

pub fn db_path() -> Result<PathBuf, DbError> {
    Ok(app_data_dir()?.join("data.db"))
}

pub fn run_migrations(conn: &mut Connection) -> Result<bool, DbError> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    if version > migrations::CURRENT_SCHEMA_VERSION {
        return Err(DbError::SchemaTooNew {
            version,
            max: migrations::CURRENT_SCHEMA_VERSION,
        });
    }
    if version == 0
        && !table_exists(conn, "events")?
        && !table_exists(conn, "actions")?
        && !table_exists(conn, "projects")?
    {
        conn.execute_batch(migrations::INIT_MIGRATION)
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        conn.pragma_update(None, "user_version", migrations::CURRENT_SCHEMA_VERSION)
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        return Ok(true);
    }
    if version == 15 {
        migrate_add_quick_completion_marker(conn)?;
        return Ok(false);
    }
    if version == 13 {
        migrate_remove_projects(conn, true)?;
        return Ok(false);
    }
    if version == 14 {
        migrate_remove_projects(conn, false)?;
        return Ok(false);
    }
    if version == migrations::CURRENT_SCHEMA_VERSION {
        validate_current_schema(conn)?;
        return Ok(false);
    }
    Err(DbError::MigrationFailed(format!(
        "不支持从数据库版本 v{version} 升级；项目概念及其历史数据兼容已移除，请使用 v15 数据库或重新初始化。"
    )))
}

fn migrate_add_quick_completion_marker(conn: &mut Connection) -> Result<(), DbError> {
    if !column_exists(conn, "events", "is_quick_completed")? {
        conn.execute_batch(
            "ALTER TABLE events ADD COLUMN is_quick_completed INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    // 旧版快速完成会留下“已完成、无行动、获得基础 5 积分”的稳定特征，迁移时补齐标记。
    conn.execute_batch(
        "UPDATE events SET is_quick_completed = 1
         WHERE status = 5 AND completion_points_awarded = 5
           AND NOT EXISTS (SELECT 1 FROM actions WHERE actions.event_id = events.id AND actions.deleted_at IS NULL);",
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    conn.pragma_update(None, "user_version", migrations::CURRENT_SCHEMA_VERSION)
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    Ok(())
}

fn migrate_remove_projects(conn: &mut Connection, add_event_columns: bool) -> Result<(), DbError> {
    let mut event_column_migration = String::new();
    if add_event_columns {
        for (column, definition) in [
            ("target", "TEXT"),
            ("estimated_hours", "REAL NOT NULL DEFAULT 1"),
            ("start_date", "TEXT"),
            ("deadline", "TEXT"),
            ("importance", "INTEGER NOT NULL DEFAULT 1"),
            ("urgency", "INTEGER NOT NULL DEFAULT 1"),
            ("priority", "INTEGER NOT NULL DEFAULT 4"),
            ("completion_points_awarded", "INTEGER NOT NULL DEFAULT 0"),
            ("is_quick_completed", "INTEGER NOT NULL DEFAULT 0"),
        ] {
            if !column_exists(conn, "events", column)? {
                event_column_migration.push_str(&format!(
                    "ALTER TABLE events ADD COLUMN {column} {definition};"
                ));
            }
        }
    }
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let result = (|| {
        let tx = conn
            .transaction()
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        if !event_column_migration.is_empty() {
            tx.execute_batch(&event_column_migration)
                .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        }
        // 项目被移除前，先将其行动关联到原项目所属事件；
        // 临时行动与重复行动生成的实例没有 event_id / project_id，必须原样保留。
        tx.execute_batch(
            "UPDATE actions
             SET event_id = (
                 SELECT p.event_id FROM projects p
                 WHERE p.id = actions.project_id AND p.space_id = actions.space_id
             )
             WHERE event_id IS NULL AND project_id IS NOT NULL;
             CREATE TABLE actions_new (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
                 sync_id TEXT NOT NULL UNIQUE,
                 deleted_at INTEGER,
                 event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
                 title TEXT NOT NULL,
                 description TEXT,
                 estimated_hours REAL NOT NULL DEFAULT 1,
                 start_date TEXT,
                 deadline TEXT,
                 is_frog INTEGER NOT NULL DEFAULT 0,
                 importance INTEGER NOT NULL DEFAULT 1,
                 urgency INTEGER NOT NULL DEFAULT 1,
                 priority INTEGER NOT NULL DEFAULT 4,
                 status INTEGER NOT NULL DEFAULT 0,
                 completed_at INTEGER,
                 is_delegated_follow_up INTEGER NOT NULL DEFAULT 0,
                 cascade_abandoned INTEGER NOT NULL DEFAULT 0,
                 sort_order INTEGER NOT NULL DEFAULT 0,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             INSERT INTO actions_new (id, space_id, sync_id, deleted_at, event_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, status, completed_at, is_delegated_follow_up, cascade_abandoned, sort_order, created_at, updated_at)
             SELECT id, space_id, sync_id, deleted_at, event_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, status, completed_at, is_delegated_follow_up, cascade_abandoned, sort_order, created_at, updated_at FROM actions;
             DROP TABLE actions;
             ALTER TABLE actions_new RENAME TO actions;
             DROP TABLE projects;
             CREATE INDEX IF NOT EXISTS idx_actions_space_deleted ON actions(space_id, deleted_at);",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.pragma_update(None, "user_version", migrations::CURRENT_SCHEMA_VERSION)
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.commit()
            .map_err(|error| DbError::MigrationFailed(error.to_string()))
    })();
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    result?;
    validate_current_schema(conn)
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, DbError> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [name],
        |row| row.get(0),
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, DbError> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    for name in names {
        if name.map_err(|error| DbError::MigrationFailed(error.to_string()))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn validate_current_schema(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS daily_schedule_template_meta (space_id TEXT PRIMARY KEY REFERENCES local_spaces(space_id), updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS reward_checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, space_id TEXT NOT NULL REFERENCES local_spaces(space_id), exchange_id INTEGER NOT NULL UNIQUE REFERENCES reward_exchanges(id) ON DELETE CASCADE, image_path TEXT, description TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_reward_checkins_space ON reward_checkins(space_id);")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    if !column_exists(conn, "events", "is_quick_completed")? {
        conn.execute_batch(
            "ALTER TABLE events ADD COLUMN is_quick_completed INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    // 自愈：无论经由哪条迁移路径（全新安装、11→13、12→13 等），都确保事件完成积分标记列存在，避免版本跳级时遗漏。
    if !column_exists(conn, "events", "completion_points_awarded")? {
        conn.execute_batch(
            "ALTER TABLE events ADD COLUMN completion_points_awarded INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    // 所有旧版迁移路径均可识别此前的快速完成记录，避免 v13/v14 直接升级时漏标。
    conn.execute_batch(
        "UPDATE events SET is_quick_completed = 1
         WHERE status = 5 AND completion_points_awarded = 5
           AND NOT EXISTS (SELECT 1 FROM actions WHERE actions.event_id = events.id AND actions.deleted_at IS NULL);",
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    for (table, columns) in [
        (
            "local_spaces",
            &["space_id", "created_at", "updated_at"][..],
        ),
        ("settings", &["key", "value", "updated_at"][..]),
        ("events", &["space_id", "sync_id", "deleted_at"][..]),
        (
            "actions",
            &["space_id", "sync_id", "deleted_at", "sort_order"][..],
        ),
        (
            "recurring_actions",
            &[
                "space_id",
                "sync_id",
                "deleted_at",
                "title",
                "estimated_hours",
                "is_frog",
                "importance",
                "urgency",
                "priority",
                "frequency_unit",
                "frequency_count",
                "sort_order",
            ][..],
        ),
        (
            "daily_list_items",
            &["space_id", "action_id", "list_date", "sort_order"][..],
        ),
        (
            "daily_schedule_days",
            &["space_id", "list_date", "created_at"][..],
        ),
        (
            "daily_schedule_slots",
            &[
                "space_id",
                "list_date",
                "start_time",
                "end_time",
                "action_id",
                "actual_notes",
                "met_expectation",
                "focused",
                "sort_order",
            ][..],
        ),
        (
            "daily_schedule_templates",
            &["space_id", "start_time", "end_time", "sort_order"][..],
        ),
        (
            "pomodoro_records",
            &[
                "space_id",
                "action_id",
                "start_time",
                "end_time",
                "planned_seconds",
                "actual_seconds",
                "status",
                "points_awarded",
            ][..],
        ),
        (
            "rewards",
            &[
                "space_id",
                "name",
                "description",
                "points_required",
                "category",
                "icon",
                "status",
            ][..],
        ),
        (
            "reward_exchanges",
            &["space_id", "reward_id", "points_used", "exchanged_at"][..],
        ),
        (
            "reward_checkins",
            &["space_id", "exchange_id", "image_path", "description"][..],
        ),
        (
            "user_points",
            &["space_id", "total_points", "updated_at"][..],
        ),
    ] {
        if !table_exists(conn, table)? {
            return Err(DbError::MigrationFailed(format!("missing table {table}")));
        }
        for column in columns {
            if !column_exists(conn, table, column)? {
                return Err(DbError::MigrationFailed(format!(
                    "missing column {table}.{column}"
                )));
            }
        }
    }
    Ok(())
}

pub fn current_space_id(conn: &Connection) -> Result<String, DbError> {
    let space_id: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'current_space_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| DbError::MigrationFailed(format!("current space is missing: {error}")))?;
    let space_id =
        space_id.ok_or_else(|| DbError::MigrationFailed("current space is missing".into()))?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM local_spaces WHERE space_id = ?1)",
            [&space_id],
            |row| row.get(0),
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    if !exists {
        return Err(DbError::MigrationFailed(
            "current space does not exist".into(),
        ));
    }
    Ok(space_id)
}

pub fn ensure_current_space(conn: &mut Connection) -> Result<String, DbError> {
    match current_space_id(conn) {
        Ok(space_id) => return Ok(space_id),
        Err(DbError::MigrationFailed(message)) if message == "current space is missing" => {}
        Err(error) => return Err(error),
    }
    let tx = conn
        .transaction()
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let space_id = new_uuid();
    let now = now_millis();
    tx.execute(
        "INSERT INTO local_spaces (space_id, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![space_id, now],
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    tx.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('current_space_id', ?1, ?2)",
        params![space_id, now],
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    tx.commit()
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    Ok(space_id)
}

pub fn with_conn<F, T>(state: &AppState, f: F) -> Result<T, DbError>
where
    F: FnOnce(&Connection) -> SqlResult<T>,
{
    let conn = state
        .db
        .lock()
        .map_err(|_| DbError::Other("database lock poisoned".into()))?;
    f(&conn).map_err(DbError::ConnectionFailed)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 移除项目迁移会保留临时行动和重复行动实例() {
        let mut conn = Connection::open_in_memory().expect("创建内存数据库失败");
        conn.execute_batch(migrations::INIT_MIGRATION)
            .expect("初始化当前数据库结构失败");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                space_id TEXT NOT NULL,
                event_id INTEGER NOT NULL
            );
            ALTER TABLE actions ADD COLUMN project_id INTEGER;",
        )
        .expect("构造旧项目结构失败");

        conn.execute(
            "INSERT INTO local_spaces (space_id, created_at, updated_at) VALUES ('space-1', 1, 1)",
            [],
        )
        .expect("创建空间失败");
        conn.execute(
            "INSERT INTO events (id, space_id, sync_id, title, created_at, updated_at)
             VALUES (1, 'space-1', 'event-1', '测试事件', 1, 1)",
            [],
        )
        .expect("创建事件失败");
        conn.execute(
            "INSERT INTO projects (id, space_id, event_id) VALUES (1, 'space-1', 1)",
            [],
        )
        .expect("创建旧项目失败");
        conn.execute(
            "INSERT INTO actions (id, space_id, sync_id, event_id, project_id, title, created_at, updated_at)
             VALUES (1, 'space-1', 'action-project', NULL, 1, '项目行动', 1, 1),
                    (2, 'space-1', 'action-temporary', NULL, NULL, '临时行动', 1, 1),
                    (3, 'space-1', 'action-recurring', NULL, NULL, '重复行动实例', 1, 1)",
            [],
        )
        .expect("创建旧行动失败");

        migrate_remove_projects(&mut conn, false).expect("执行项目迁移失败");

        let relations: Vec<(i64, Option<i64>)> = conn
            .prepare("SELECT id, event_id FROM actions ORDER BY id")
            .expect("查询行动失败")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("映射行动失败")
            .collect::<Result<_, _>>()
            .expect("收集行动失败");
        assert_eq!(relations, vec![(1, Some(1)), (2, None), (3, None)]);
        assert!(!table_exists(&conn, "projects").expect("检查项目表失败"));
    }
}
