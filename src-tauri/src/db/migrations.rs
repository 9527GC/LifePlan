pub const CURRENT_SCHEMA_VERSION: i32 = 11;

pub const INIT_MIGRATION: &str = r#"
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS analytics_events ( id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL, occurred_at INTEGER NOT NULL, app_version TEXT NOT NULL, platform TEXT NOT NULL, payload_json TEXT NOT NULL ); CREATE INDEX IF NOT EXISTS idx_analytics_events_time ON analytics_events(occurred_at); CREATE TABLE IF NOT EXISTS local_spaces (
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
CREATE TABLE IF NOT EXISTS daily_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
    action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    list_date TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(space_id, action_id, list_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_list_space_date ON daily_list_items(space_id, list_date, sort_order, id);
CREATE TABLE IF NOT EXISTS daily_schedule_days (
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
CREATE INDEX IF NOT EXISTS idx_daily_schedule_templates_space ON daily_schedule_templates(space_id, sort_order); CREATE TABLE IF NOT EXISTS daily_schedule_template_meta ( space_id TEXT PRIMARY KEY REFERENCES local_spaces(space_id), updated_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS pomodoro_records (
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
);
CREATE TABLE IF NOT EXISTS recurring_actions (
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
CREATE INDEX IF NOT EXISTS idx_recurring_actions_space_order ON recurring_actions(space_id, deleted_at, sort_order, id);
PRAGMA foreign_keys = ON;
"#;
