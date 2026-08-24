pub const CURRENT_SCHEMA_VERSION: i32 = 4;

pub const INIT_MIGRATION: &str = r#"
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS local_spaces (
    space_id TEXT PRIMARY KEY,
    cloud_user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
    sync_id TEXT NOT NULL UNIQUE,
    deleted_at INTEGER,
    title TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    delegated_to TEXT,
    follow_up_date TEXT,
    follow_up_note TEXT,
    delay_until TEXT,
    delay_note TEXT,
    abandon_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
    sync_id TEXT NOT NULL UNIQUE,
    deleted_at INTEGER,
    event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    target TEXT,
    estimated_hours REAL NOT NULL DEFAULT 1,
    start_date TEXT,
    deadline TEXT,
    importance INTEGER NOT NULL DEFAULT 1,
    urgency INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 4,
    status INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
    sync_id TEXT NOT NULL UNIQUE,
    deleted_at INTEGER,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_events_space_deleted ON events(space_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_projects_space_deleted ON projects(space_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_actions_space_deleted ON actions(space_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id);
PRAGMA foreign_keys = ON;
"#;
