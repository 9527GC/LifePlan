# 本地空间隔离与数据库迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Tauri + React + SQLite 应用中实现本地空间隔离、软删除、旧数据库安全迁移和自动备份，为未来登录同步保留数据基础。

**Architecture:** Rust 数据库层维护 `local_spaces` 和当前空间，所有命令在后端解析当前空间并在 SQL 中强制过滤。SQLite 迁移使用 `PRAGMA user_version`、事务和迁移前备份；业务删除改为软删除并在同一事务内级联。前端不接收或提交 `space_id`，仅通过启动状态命令显示备份/迁移提示。

**Tech Stack:** Tauri 2、Rust 2021、rusqlite 0.32 bundled SQLite、UUID v4、chrono、React 19、TypeScript、Vite。

## Global Constraints

- 当前阶段不实现登录页面、邮箱/密码登录、微信登录、云端接口、后台同步、本地空间管理界面或手动 JSON 导入导出。
- 当前只有一个默认本地空间；前端不展示空间 UUID，也不允许前端传入 `space_id`。
- `space_id` 使用标准 UUID v4 字符串；`sync_id` 使用全局唯一 UUID v4。
- `updated_at` 和 `deleted_at` 使用 Unix 毫秒时间戳；旧秒级时间戳迁移时乘以 1000。
- 所有业务列表、统计、计数和完成判断只处理当前空间且 `deleted_at IS NULL` 的记录。
- 迁移发现结构、关系或数据异常时必须失败，不自动修复、不跳过记录。
- 全新数据库生成示例数据；已有旧数据的数据库只迁移，不生成示例数据。
- 删除使用软删除；删除事件、项目、行动的级联规则必须在 Rust SQLite 事务中执行。
- 不添加与本功能无关的重构、依赖或 UI 页面。
- 当前目录不是 Git 仓库；计划中的提交步骤改为保留工作区变更并通过构建/检查验证。

---

## 文件结构

### 修改文件

- `E:\项目\LifePlanTodolist\src-tauri\Cargo.toml`：增加 UUID v4 依赖。
- `E:\项目\LifePlanTodolist\src-tauri\src\db\mod.rs`：数据库路径、连接初始化、当前空间解析、时间戳、备份调用和启动状态。
- `E:\项目\LifePlanTodolist\src-tauri\src\db\migrations.rs`：最新 schema、`user_version` 迁移和旧数据重建。
- `E:\项目\LifePlanTodolist\src-tauri\src\models.rs`：启动通知与必要的后端响应类型。
- `E:\项目\LifePlanTodolist\src-tauri\src\commands\events.rs`：事件查询、写入、关联校验、软删除和级联过滤。
- `E:\项目\LifePlanTodolist\src-tauri\src\commands\projects.rs`：项目查询、状态操作和软删除级联。
- `E:\项目\LifePlanTodolist\src-tauri\src\commands\actions.rs`：行动查询、写入、状态操作和软删除。
- `E:\项目\LifePlanTodolist\src-tauri\src\commands\mod.rs`：启动状态命令的模块导出（如现有模块结构需要）。
- `E:\项目\LifePlanTodolist\src-tauri\src\lib.rs`：注册启动状态命令，并将初始化错误转换为可显示的启动错误。
- `E:\项目\LifePlanTodolist\src\lib\api.ts`：增加启动状态 API，不增加业务 API 的 `space_id` 参数。
- `E:\项目\LifePlanTodolist\src\App.tsx`：启动时读取通知并显示备份/迁移提示及重试备份操作。

### 新增文件

- `E:\项目\LifePlanTodolist\src-tauri\src\db\backup.rs`：备份路径、SQLite 一致性备份、失败副本和恢复逻辑。
- `E:\项目\LifePlanTodolist\src-tauri\src\commands\system.rs`：启动通知和手动重试备份的 Tauri commands。

### 测试位置

- `E:\项目\LifePlanTodolist\src-tauri\src\db\migrations.rs` 内的 Rust 单元测试：最新 schema、旧数据迁移、异常回滚。
- `E:\项目\LifePlanTodolist\src-tauri\src\db\backup.rs` 内的 Rust 单元测试：备份目录、覆盖策略、失败副本和恢复。
- `E:\项目\LifePlanTodolist\src-tauri\src\commands\events.rs`、`projects.rs`、`actions.rs` 内的 Rust 单元测试：空间过滤与软删除级联。

---

## Task 1: 建立数据库公共基础与最新 schema

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src-tauri\Cargo.toml`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\db\mod.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\db\migrations.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\models.rs`
- Create: `E:\项目\LifePlanTodolist\src-tauri\src\db\backup.rs`

**Interfaces:**
- Produces `CURRENT_SCHEMA_VERSION`, `now_millis()`, `new_uuid()`, `current_space_id(conn)`, `ensure_current_space(conn)` and a latest schema containing `local_spaces`, `settings.current_space_id`, and the public sync fields.
- Produces backup helpers used by the migration task: `backup_path(db_path)`, `create_backup(db_path)`, `restore_backup(backup_path, db_path)` and `preserve_failed_database(db_path)`.

- [ ] **Step 1: Add the UUID dependency and compile the empty helper boundary**

Add the following dependency to `src-tauri/Cargo.toml`:

```toml
uuid = { version = "1", features = ["v4"] }
```

Declare `pub mod backup;` in `src-tauri/src/db/mod.rs` and add `pub mod system;` in the command module only when Task 5 introduces that file. Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
```

Expected: formatting succeeds.

- [ ] **Step 2: Define the latest schema without destructive drops**

Replace `INIT_MIGRATION` with a latest-schema script that creates, in order, `local_spaces`, `settings`, `events`, `projects`, and `actions`, enables foreign keys after creation, and includes:

```sql
space_id TEXT NOT NULL REFERENCES local_spaces(space_id),
sync_id TEXT NOT NULL UNIQUE,
deleted_at INTEGER
```

Use `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)` and keep the existing business columns and integer IDs. Add indexes on `(space_id, deleted_at)` for each business table and on `projects(event_id)`. Do not use `DROP TABLE` in the normal latest-schema path.

- [ ] **Step 3: Add millisecond and UUID helpers**

Implement:

```rust
pub fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}
```

Make `current_space_id` read `settings.current_space_id`, return a database error if the setting is missing, and verify the referenced row exists in `local_spaces`. Make `ensure_current_space` create exactly one default UUID on a new database and write the setting in one transaction.

- [ ] **Step 4: Implement deterministic backup file helpers**

Create `db/backup.rs` with a database-directory `backups` subdirectory and three filenames:

```text
startup.db
migration-before.db
migration-failed-<timestamp>.db
```

Use SQLite’s online backup API if available through rusqlite; otherwise close the connection before copying and use a temporary file plus atomic rename. A backup operation must first copy to `*.tmp`, flush/close it, validate it with `PRAGMA integrity_check`, then replace the target. Never delete the only existing backup before the replacement validates.

- [ ] **Step 5: Add focused unit tests for helpers**

Use a temporary directory and in-memory SQLite where possible. Verify UUID strings parse as UUIDs, timestamps are millisecond values, a new database receives one current space, and a second `ensure_current_space` call reuses the existing space rather than creating another.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml db::
```

Expected: the new helper tests pass; if the environment cannot link Rust tests because `link.exe` is unavailable, record that exact environment limitation and continue with frontend validation.

---

## Task 2: Implement versioned migration and safe startup recovery

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\db\mod.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\db\migrations.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\db\backup.rs`

**Interfaces:**
- Consumes the Task 1 latest schema and backup helpers.
- Produces `run_migrations(conn, db_path) -> Result<MigrationOutcome, DbError>` and a startup path that distinguishes a new database, a successful migration, a backup warning, and a restored migration failure.

- [ ] **Step 1: Detect schema state using `PRAGMA user_version` and table inspection**

Use explicit states instead of the current `delegated_to` probe. Treat `user_version = 0` with no business tables as new; treat the existing schema without `local_spaces`, `space_id`, `sync_id`, or `deleted_at` as legacy; reject partially upgraded schemas unless they exactly match a supported intermediate version.

- [ ] **Step 2: Write the legacy migration transaction**

Before altering tables, validate that legacy event, project, and action relationships are legal. Create a default local space and rebuild each affected table into a temporary table with the latest columns. Copy records while preserving integer IDs and relation IDs, assign one `space_id` and a new `sync_id` per record, set `deleted_at = NULL`, and convert non-null old timestamps with `timestamp * 1000`.

Preserve the existing `settings` rows, then insert or replace `current_space_id`. Use `PRAGMA foreign_keys = OFF` only around the controlled table-rebuild section, restore it before commit, and run `PRAGMA foreign_key_check` plus `PRAGMA integrity_check` before setting `PRAGMA user_version = CURRENT_SCHEMA_VERSION`.

- [ ] **Step 3: Separate example initialization from legacy migration**

Return an explicit `is_new_database` or equivalent outcome from initialization. Generate the existing example event/project/action chain only when the database had no prior business tables and the new default space is empty. Never call example initialization merely because a migrated database has zero rows.

- [ ] **Step 4: Add backup-before-migration and rollback behavior**

In `init_db`, create the startup backup first. If the schema requires migration, create `migration-before.db`, run the migration transaction, and on any error copy the failed database to a timestamped failure file before restoring `migration-before.db`. Return a startup notice when recovery succeeds. If restoration fails, return a fatal `DbError` that includes the database, backup, and failure-copy paths.

- [ ] **Step 5: Add migration tests for data preservation and failure**

Create a legacy in-memory/file database with one event, one project, and two actions. Verify after migration that integer IDs, event/project/action relations, titles, statuses, and action counts remain unchanged, all records share the default `space_id`, and each `sync_id` is unique. Add a malformed relation test that expects migration failure and verifies `user_version` is not advanced.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml db::migrations
```

Expected: migration preservation and rollback tests pass, or the environment reports the known missing MSVC `link.exe` blocker.

---

## Task 3: Add backend current-space query helpers and scope all reads/writes

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\db\mod.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\events.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\projects.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\actions.rs`

**Interfaces:**
- Consumes `current_space_id(conn)` from Task 1.
- Produces command-layer SQL that binds `space_id` from the backend and rejects records outside the current space or already soft deleted.

- [ ] **Step 1: Add reusable current-space lookup in each command transaction**

Use a helper returning the current UUID string and bind it as a SQL parameter. Do not add `space_id` to `NewEvent`, `NewAction`, `ProcessEvent`, update payloads, or frontend types.

- [ ] **Step 2: Scope event list, delay restoration, create, update, process, complete, and restore**

Every event query must include `e.space_id = ?current_space_id` and `e.deleted_at IS NULL`. Every event mutation must include `WHERE id = ?id AND space_id = ?space_id AND deleted_at IS NULL`. During event-to-project conversion, verify the event and all moved actions belong to the same space, insert the project with the same space and a fresh `sync_id`, and keep the existing one-project rule.

- [ ] **Step 3: Scope project list, update, complete, abandon, and source-event joins**

Filter both project and source event by current space and non-deleted status. Project completion counts only non-deleted actions in the same space. Status synchronization must update the source event with matching `space_id` and `deleted_at IS NULL`.

- [ ] **Step 4: Scope action list, create, update, complete, restore, and delegated resolution**

Filter joined event/project records by current space and non-deleted state. New unassociated actions still receive the current `space_id`; event/project-associated actions must validate same-space ownership. Every new action receives a fresh `sync_id`; updates preserve it.

- [ ] **Step 5: Add cross-space regression tests**

Seed two spaces directly in a test database with same integer IDs where possible. Verify list commands expose only the active space and mutation commands cannot update, complete, abandon, or associate records from the inactive space.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml commands::
```

---

## Task 4: Replace hard deletes with transactional soft-delete cascades

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\events.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\projects.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\actions.rs`

**Interfaces:**
- Consumes scoped command queries from Task 3.
- Produces the same frontend command names and payloads, but deletion leaves records in SQLite with `deleted_at` and `updated_at`.

- [ ] **Step 1: Implement event soft-delete transaction**

Replace `DELETE FROM events` with a transaction that loads the current-space event, marks it deleted, then marks its non-deleted source project and all non-deleted direct/project actions deleted with the same timestamp. Preserve prior action status values in the rows; do not change completed or abandoned status merely because the row is hidden.

- [ ] **Step 2: Implement project soft-delete transaction**

Replace physical deletion with a transaction that marks the current-space project, its source event, and all project actions deleted. Keep the existing source-event relationship in the database so a deleted project still prevents a second conversion.

- [ ] **Step 3: Implement action soft-delete guard**

Mark only the requested current-space action deleted. Before doing so, count non-deleted actions belonging to the project; reject the operation when it would leave zero non-deleted project actions. For unassociated or event-direct actions, allow deletion according to existing rules.

- [ ] **Step 4: Update all aggregate conditions**

Ensure `COUNT`, pending/completed counts, completion checks, action ordering, and status restoration never include `deleted_at IS NOT NULL`. A deleted action must not prevent an event or project from satisfying its completion condition.

- [ ] **Step 5: Test cascade and no-physical-delete behavior**

Verify deleting an event/project hides the full chain, preserves rows and original statuses, blocks duplicate project conversion, and leaves previously abandoned actions abandoned. Verify deleting the last non-deleted project action returns the existing validation error.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml commands::events commands::projects commands::actions
```

---

## Task 5: Expose startup notices and backup retry without exposing spaces

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\models.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\lib.rs`
- Modify: `E:\项目\LifePlanTodolist\src-tauri\src\commands\mod.rs`
- Create: `E:\项目\LifePlanTodolist\src-tauri\src\commands\system.rs`
- Modify: `E:\项目\LifePlanTodolist\src\lib\api.ts`
- Modify: `E:\项目\LifePlanTodolist\src\App.tsx`

**Interfaces:**
- Produces `get_startup_notice() -> Option<StartupNotice>` and `retry_startup_backup() -> Result<(), String>` Tauri commands.
- `StartupNotice` contains a kind (`backup_warning` or `migration_restored`) and a user-readable message; it contains no UUID or filesystem secret beyond a concise backup failure explanation.

- [ ] **Step 1: Add startup notice state to `AppState`**

Store an optional startup notice behind the existing mutex. On startup backup failure, keep the database usable and set a backup warning. On successful migration recovery, set a migration-restored notice. On unrecoverable migration failure, fail initialization before registering the main window state.

- [ ] **Step 2: Register system commands**

Register `system::get_startup_notice` and `system::retry_startup_backup` in `tauri::generate_handler!`. The retry command reruns the safe startup backup for the configured database path, clears the warning only on success, and returns a user-readable error otherwise.

- [ ] **Step 3: Add frontend API and one-time notice display**

Add typed wrappers in `src/lib/api.ts`. In `src/App.tsx`, read the notice once after mount, display a concise Ant Design-style inline alert/modal, provide “立即重试” for backup warnings, and allow the user to close the alert while continuing to use the app. Do not add a space selector or show `space_id`.

- [ ] **Step 4: Build the frontend**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build pass with no new frontend dependencies.

---

## Task 6: Complete validation and document operational behavior

**Files:**
- Modify: `E:\项目\LifePlanTodolist\README.md`
- Modify: `E:\项目\LifePlanTodolist\docs\技术规划.md` only where the current migration/backup behavior contradicts this plan.

**Interfaces:**
- Documents the database location, backup location, migration behavior, and the fact that the current phase is single-user with hidden default local space.

- [ ] **Step 1: Document user-visible backup and migration behavior**

Add concise startup behavior: backups live beside the database in `backups`, backup failures do not block use, migration recovery can return the app to the previous version, and unrecoverable migration failures block the main interface.

- [ ] **Step 2: Run formatting and frontend validation**

Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run build
```

Expected: both commands pass.

- [ ] **Step 3: Run Rust validation**

Run:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: pass when Windows MSVC Build Tools and Windows SDK provide `link.exe`. If unavailable, record that exact blocker without changing unrelated project files.

- [ ] **Step 4: Perform manual acceptance checks**

Using a disposable database copy, verify:

1. A new database creates one default space and example chain.
2. A legacy database migrates without changing integer IDs or relations and does not receive examples.
3. Startup creates/updates the backup file under `backups`.
4. Two-space seed data cannot leak through list or mutation commands.
5. Event/project/action soft deletion hides records while preserving database rows.
6. Migration failure restores the pre-migration copy; restoration failure prevents main-interface startup.

- [ ] **Step 5: Record final validation status**

Report the changed files, successful commands, and any environment-only Rust linker limitation. Do not commit or create a branch because the workspace is not a Git repository.

---

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 cover schema, UUIDs, timestamps, versioning, old-data migration, example-data gating, backups, and recovery. Tasks 3–4 cover backend isolation, all business queries, soft deletion, aggregate filtering, and cascade rules. Task 5 covers user-visible startup failure handling without exposing spaces. Task 6 covers documentation and acceptance validation.
- **Placeholder scan:** No `TBD`, `TODO`, “implement later”, or unspecified error-handling steps are used.
- **Type consistency:** `current_space_id`, `StartupNotice`, `get_startup_notice`, and `retry_startup_backup` are introduced before their consumers; business payloads intentionally remain free of `space_id`.
- **Scope check:** This plan contains one cohesive subsystem—local data isolation and safe database lifecycle—and does not include login or cloud synchronization implementation.
