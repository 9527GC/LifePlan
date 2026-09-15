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
        let needs_migration = requires_legacy_migration(&conn)?;
        if needs_migration {
            backup::create_migration_backup(&db_path)?;
        }

        match run_migrations(&mut conn) {
            Ok(value) => value,
            Err(error) if needs_migration => {
                let failure_copy = backup::preserve_failed_database(&db_path, now_millis());
                drop(conn);
                if let Err(restore_error) = backup::restore_backup(&db_path) {
                    let failure_path = failure_copy
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|copy_error| copy_error.to_string());
                    return Err(DbError::MigrationFailed(format!(
                        "{error}; restore failed: {restore_error}; failed database copy: {failure_path}"
                    )));
                }
                startup_notice = Some(crate::models::StartupNotice {
                    kind: "migration_restored".into(),
                    message: "数据库迁移失败，已恢复迁移前数据。原数据库副本已保留。".into(),
                });
                conn = Connection::open(&db_path)?;
                false
            }
            Err(error) => return Err(error),
        };

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

pub fn db_path() -> Result<PathBuf, DbError> {
    let dirs = dirs::data_dir()
        .ok_or_else(|| DbError::PathFailed("unable to resolve system data directory".into()))?;
    Ok(dirs.join("LifePlanTodolist").join("data.db"))
}

pub fn run_migrations(conn: &mut Connection) -> Result<bool, DbError> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let has_events = table_exists(conn, "events")?;
    let has_projects = table_exists(conn, "projects")?;
    let has_actions = table_exists(conn, "actions")?;

    if version == 0 && !has_events && !has_projects && !has_actions {
        conn.execute_batch(migrations::INIT_MIGRATION)
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        conn.pragma_update(None, "user_version", migrations::CURRENT_SCHEMA_VERSION)
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        return Ok(true);
    }
    if version == 10 {
        migrate_priority_levels(conn)?;
        return Ok(false);
    }
    if version == migrations::CURRENT_SCHEMA_VERSION {
        validate_current_schema(conn)?;
        remove_obsolete_daily_schedule_slot(conn)?;
        return Ok(false);
    }
    if version == 8 {
        migrate_recurring_actions(conn)?;
        return Ok(false);
    }
    if version == 7 {
        migrate_reward_metadata(conn)?;
        return Ok(false);
    }
    if version == 6 {
        migrate_pomodoro_rewards(conn)?;
        return Ok(false);
    }
    if version == 5 {
        migrate_daily_schedule(conn)?;
        remove_obsolete_daily_schedule_slot(conn)?;
        return Ok(false);
    }
    if version == 4 {
        migrate_daily_list(conn)?;
        return Ok(false);
    }
    if version == 2 || version == 3 {
        migrate_sort_order(conn)?;
        return Ok(false);
    }
    if version == 0 && has_events && has_projects && has_actions {
        migrate_legacy(conn)?;
        return Ok(false);
    }

    Err(DbError::MigrationFailed(format!(
        "unsupported or incomplete database schema version {version}"
    )))
}

fn migrate_priority_levels(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "UPDATE projects SET priority = 4 - (importance * 2 + urgency);
         UPDATE actions SET priority = 4 - (importance * 2 + urgency);
         UPDATE recurring_actions SET priority = 4 - (importance * 2 + urgency);",
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    conn.pragma_update(None, "user_version", migrations::CURRENT_SCHEMA_VERSION)
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    validate_current_schema(conn)
}

fn create_pomodoro_reward_tables(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pomodoro_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            action_id INTEGER REFERENCES actions(id) ON DELETE SET NULL,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            planned_seconds INTEGER NOT NULL DEFAULT 1500,
            actual_seconds INTEGER,
            status INTEGER NOT NULL DEFAULT -1,
            interrupt_type INTEGER,
            interrupt_reason TEXT,
            points_awarded INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pomodoro_records_space_time ON pomodoro_records(space_id, start_time DESC);
        CREATE TABLE IF NOT EXISTS rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            name TEXT NOT NULL,
            description TEXT,
            points_required INTEGER NOT NULL,
            category TEXT NOT NULL DEFAULT '其他',
            icon TEXT NOT NULL DEFAULT '🎁',
            status INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rewards_space_status ON rewards(space_id, status, created_at);
        CREATE TABLE IF NOT EXISTS reward_exchanges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            reward_id INTEGER NOT NULL REFERENCES rewards(id),
            points_used INTEGER NOT NULL,
            exchanged_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reward_exchanges_space_time ON reward_exchanges(space_id, exchanged_at DESC);
        CREATE TABLE IF NOT EXISTS user_points (
            space_id TEXT PRIMARY KEY REFERENCES local_spaces(space_id),
            total_points INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );"
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))
}

fn migrate_reward_metadata(conn: &mut Connection) -> Result<(), DbError> {
    if !column_exists(conn, "rewards", "category")? {
        conn.execute(
            "ALTER TABLE rewards ADD COLUMN category TEXT NOT NULL DEFAULT '其他'",
            [],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    if !column_exists(conn, "rewards", "icon")? {
        conn.execute(
            "ALTER TABLE rewards ADD COLUMN icon TEXT NOT NULL DEFAULT '🎁'",
            [],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    migrate_recurring_actions(conn)?;
    Ok(())
}

fn migrate_recurring_actions(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS recurring_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            sync_id TEXT NOT NULL UNIQUE,
            deleted_at INTEGER,
            title TEXT NOT NULL,
            estimated_hours REAL NOT NULL DEFAULT 1,
            is_frog INTEGER NOT NULL DEFAULT 0,
            importance INTEGER NOT NULL DEFAULT 1,
            urgency INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 4,
            frequency_unit TEXT NOT NULL DEFAULT 'daily',
            frequency_count INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recurring_actions_space_order ON recurring_actions(space_id, deleted_at, sort_order, id);"
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    conn.pragma_update(None, "user_version", migrations::CURRENT_SCHEMA_VERSION)
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    validate_current_schema(conn)
}

fn migrate_pomodoro_rewards(conn: &mut Connection) -> Result<(), DbError> {
    create_pomodoro_reward_tables(conn)?;
    migrate_reward_metadata(conn)
}

fn remove_obsolete_daily_schedule_slot(conn: &mut Connection) -> Result<(), DbError> {
    let tx = conn
        .transaction()
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    tx.execute(
        "DELETE FROM daily_schedule_templates WHERE start_time = '12:00' AND end_time = '13:30'",
        [],
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    tx.execute(
        "DELETE FROM daily_schedule_slots WHERE start_time = '12:00' AND end_time = '13:30'",
        [],
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    tx.commit()
        .map_err(|error| DbError::MigrationFailed(error.to_string()))
}

fn migrate_sort_order(conn: &mut Connection) -> Result<(), DbError> {
    if !column_exists(conn, "actions", "sort_order")? {
        conn.execute(
            "ALTER TABLE actions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    conn.execute(
        "UPDATE actions SET sort_order = 0 WHERE sort_order IS NULL",
        [],
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    migrate_daily_list(conn)
}

fn migrate_daily_list(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS daily_list_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
            list_date TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(space_id, action_id, list_date)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_list_space_date ON daily_list_items(space_id, list_date, sort_order, id);"
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    migrate_daily_schedule(conn)
}

fn migrate_daily_schedule(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS daily_schedule_days (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            list_date TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(space_id, list_date)
        );
        CREATE TABLE IF NOT EXISTS daily_schedule_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            list_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            action_id INTEGER REFERENCES actions(id) ON DELETE SET NULL,
            actual_notes TEXT,
            met_expectation INTEGER,
            focused INTEGER,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_schedule_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_daily_schedule_days_space_date ON daily_schedule_days(space_id, list_date);
        CREATE INDEX IF NOT EXISTS idx_daily_schedule_slots_space_date ON daily_schedule_slots(space_id, list_date, sort_order, start_time);
        CREATE INDEX IF NOT EXISTS idx_daily_schedule_templates_space ON daily_schedule_templates(space_id, sort_order);"
    )
    .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    create_pomodoro_reward_tables(conn)?;
    migrate_recurring_actions(conn)?;
    Ok(())
}

fn requires_legacy_migration(conn: &Connection) -> Result<bool, DbError> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    if version != 0 {
        return Ok(false);
    }
    let events = table_exists(conn, "events")?;
    let projects = table_exists(conn, "projects")?;
    let actions = table_exists(conn, "actions")?;
    if events || projects || actions {
        if events && projects && actions {
            return Ok(true);
        }
        return Err(DbError::MigrationFailed(
            "database contains only part of the legacy business schema".into(),
        ));
    }
    Ok(false)
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
    conn.execute_batch("CREATE TABLE IF NOT EXISTS daily_schedule_template_meta (space_id TEXT PRIMARY KEY REFERENCES local_spaces(space_id), updated_at INTEGER NOT NULL);")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    for (table, columns) in [
        (
            "local_spaces",
            &["space_id", "created_at", "updated_at"][..],
        ),
        ("settings", &["key", "value", "updated_at"][..]),
        ("events", &["space_id", "sync_id", "deleted_at"][..]),
        ("projects", &["space_id", "sync_id", "deleted_at"][..]),
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

fn migrate_legacy(conn: &mut Connection) -> Result<(), DbError> {
    validate_legacy_relations(conn)?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;

    let result = (|| {
        let tx = conn
            .transaction()
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        let space_id = new_uuid();
        let now = now_millis();

        tx.execute_batch(
            "CREATE TABLE local_spaces (space_id TEXT PRIMARY KEY, cloud_user_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute(
            "INSERT INTO local_spaces (space_id, created_at, updated_at) VALUES (?1, ?2, ?2)",
            params![space_id, now],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute_batch(
            "ALTER TABLE events RENAME TO events_legacy;
             ALTER TABLE projects RENAME TO projects_legacy;
             ALTER TABLE actions RENAME TO actions_legacy;",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute_batch(migrations::INIT_MIGRATION)
            .map_err(|error| DbError::MigrationFailed(error.to_string()))?;

        copy_legacy_events(&tx, &space_id)?;
        copy_legacy_projects(&tx, &space_id)?;
        copy_legacy_actions(&tx, &space_id)?;

        tx.execute_batch(
            "DROP TABLE events_legacy; DROP TABLE projects_legacy; DROP TABLE actions_legacy;",
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('current_space_id', ?1, ?2)",
            params![space_id, now],
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
    validate_database(conn)
}

fn copy_legacy_events(tx: &rusqlite::Transaction<'_>, space_id: &str) -> Result<(), DbError> {
    let mut statement = tx
        .prepare("SELECT id, title, status, delegated_to, follow_up_date, follow_up_note, delay_until, delay_note, abandon_reason, created_at, updated_at FROM events_legacy ORDER BY id")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    for row in rows {
        let (
            id,
            title,
            status,
            delegated_to,
            follow_up_date,
            follow_up_note,
            delay_until,
            delay_note,
            abandon_reason,
            created_at,
            updated_at,
        ) = row.map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute(
            "INSERT INTO events (id, space_id, sync_id, title, status, delegated_to, follow_up_date, follow_up_note, delay_until, delay_note, abandon_reason, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![id, space_id, new_uuid(), title, status, delegated_to, follow_up_date, follow_up_note, delay_until, delay_note, abandon_reason, created_at * 1000, updated_at * 1000],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    Ok(())
}

fn copy_legacy_projects(tx: &rusqlite::Transaction<'_>, space_id: &str) -> Result<(), DbError> {
    let mut statement = tx
        .prepare("SELECT id, event_id, title, target, estimated_hours, start_date, deadline, importance, urgency, priority, status, created_at, updated_at FROM projects_legacy ORDER BY id")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, i32>(7)?,
                row.get::<_, i32>(8)?,
                row.get::<_, i32>(9)?,
                row.get::<_, i32>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
            ))
        })
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    for row in rows {
        let (
            id,
            event_id,
            title,
            target,
            estimated_hours,
            start_date,
            deadline,
            importance,
            urgency,
            priority,
            status,
            created_at,
            updated_at,
        ) = row.map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute(
            "INSERT INTO projects (id, space_id, sync_id, event_id, title, target, estimated_hours, start_date, deadline, importance, urgency, priority, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![id, space_id, new_uuid(), event_id, title, target, estimated_hours, start_date, deadline, importance, urgency, priority, status, created_at * 1000, updated_at * 1000],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    Ok(())
}

fn copy_legacy_actions(tx: &rusqlite::Transaction<'_>, space_id: &str) -> Result<(), DbError> {
    let mut statement = tx
        .prepare("SELECT id, event_id, project_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, status, completed_at, is_delegated_follow_up, cascade_abandoned, created_at, updated_at FROM actions_legacy ORDER BY id")
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, i32>(8)?,
                row.get::<_, i32>(9)?,
                row.get::<_, i32>(10)?,
                row.get::<_, i32>(11)?,
                row.get::<_, i32>(12)?,
                row.get::<_, Option<i64>>(13)?,
                row.get::<_, i32>(14)?,
                row.get::<_, i32>(15)?,
                row.get::<_, i64>(16)?,
                row.get::<_, i64>(17)?,
            ))
        })
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    for row in rows {
        let (
            id,
            event_id,
            project_id,
            title,
            description,
            estimated_hours,
            start_date,
            deadline,
            is_frog,
            importance,
            urgency,
            priority,
            status,
            completed_at,
            is_delegated_follow_up,
            cascade_abandoned,
            created_at,
            updated_at,
        ) = row.map_err(|error| DbError::MigrationFailed(error.to_string()))?;
        tx.execute(
            "INSERT INTO actions (id, space_id, sync_id, event_id, project_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, status, completed_at, is_delegated_follow_up, cascade_abandoned, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![id, space_id, new_uuid(), event_id, project_id, title, description, estimated_hours, start_date, deadline, is_frog, importance, urgency, priority, status, completed_at.map(|value| value * 1000), is_delegated_follow_up, cascade_abandoned, created_at * 1000, updated_at * 1000],
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    }
    Ok(())
}

fn validate_legacy_relations(conn: &Connection) -> Result<(), DbError> {
    let invalid_projects: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE event_id IS NULL OR event_id NOT IN (SELECT id FROM events)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let invalid_actions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM actions WHERE (event_id IS NOT NULL AND event_id NOT IN (SELECT id FROM events)) OR (project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)) OR (event_id IS NOT NULL AND project_id IS NOT NULL)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    if invalid_projects > 0 || invalid_actions > 0 {
        return Err(DbError::MigrationFailed(
            "legacy relationship validation failed".into(),
        ));
    }
    Ok(())
}

fn validate_database(conn: &Connection) -> Result<(), DbError> {
    let foreign_key_errors: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| DbError::MigrationFailed(error.to_string()))?;
    if foreign_key_errors > 0 || integrity != "ok" {
        return Err(DbError::MigrationFailed(format!(
            "database validation failed: foreign keys={foreign_key_errors}, integrity={integrity}"
        )));
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
