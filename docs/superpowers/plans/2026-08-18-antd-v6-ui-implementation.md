# Ant Design 6 UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LifePlan 的桌面界面统一迁移到 Ant Design 6 极简现代风格，同时保持现有路由、Tauri 命令、SQLite 数据结构和业务规则不变。

**Architecture:** 使用 `ConfigProvider` 统一主题，以 Ant Design 的 Layout、Menu、表单、反馈、列表和弹窗组件替换当前页面级自定义控件。业务页面继续直接调用现有 `src/lib/api.ts`，日期在 UI 与 API 边界转换为 `YYYY-MM-DD` 字符串；共享布局和全局 CSS 负责 1000×650 桌面窗口下的密度、响应式和视觉基线。

**Tech Stack:** React 19.1、TypeScript、Vite、Ant Design 6.6.1、Tauri 2、Rust、SQLite、lucide-react。

## Global Constraints

- 使用 `antd@6.6.1`，主色固定为 `#1778FF`。
- 控件默认高度约 32px，页面采用浅色、弱边框、弱阴影和 6px/8px 圆角。
- 保留 `/inbox`、`/projects`、`/actions` 路由和所有现有 Tauri invoke 命令。
- 不改变后端数据结构；日期传给 API 时仍为 `YYYY-MM-DD`。
- 删除、完成、放弃等确认统一使用 Ant Design `Popconfirm` 或 `Modal`，不使用原生 `window.confirm`/`window.alert`。
- 浏览器测试环境继续显示“请启动桌面客户端”错误，不能绕过 `invoke` 保护。

---

### Task 1: Install Ant Design and Configure Theme

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces a global `ConfigProvider` with primary color `#1778FF`, compact control sizing, and Chinese system fonts.

- [ ] **Step 1: Install the exact UI dependency**

Run: `npm install antd@6.6.1`
Expected: `package.json` and `package-lock.json` contain `antd` at `6.6.1`.

- [ ] **Step 2: Wrap the router with `ConfigProvider`**

Import `ConfigProvider` from `antd` and render the existing startup notice and router inside it. Configure `theme.token.colorPrimary`, `borderRadius`, `controlHeight`, and component tokens without changing route elements.

- [ ] **Step 3: Establish the global reset**

Keep the existing Tailwind imports if needed by the build, then set the global font stack, page background, full-height root, focus behavior, and default overflow for the desktop shell.

- [ ] **Step 4: Build the TypeScript bundle**

Run: `npm run build`
Expected: TypeScript and Vite complete successfully.

### Task 2: Replace the Shared Shell and Base Styles

**Files:**
- Modify: `src/components/layout/Layout.tsx`
- Modify: `src/App.css`
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/components/ui/Badge.tsx`

**Interfaces:**
- `Layout` continues to render `Outlet` for the three existing routes.
- Existing page imports can remain temporarily valid while page components migrate.

- [ ] **Step 1: Build the Ant Design shell**

Use `Layout.Sider`, `Layout.Header` only where useful, `Layout.Content`, `Menu`, and lucide icons. Keep the sidebar at 160px with full Chinese labels and active route highlighting. Keep the content padding compatible with a 1000×650 window.

- [ ] **Step 2: Replace shared modal and badge implementations**

Either adapt the wrappers to Ant Design `Modal`/`Tag` or remove their use after page migration. Preserve `open`, `title`, `onClose`, and child composition until all consumers are migrated.

- [ ] **Step 3: Replace legacy CSS primitives**

Define only the page-level layout classes still needed by migrated pages. Normalize buttons, inputs, selects, date controls, cards, rows, filters, and modal spacing to the Ant Design visual baseline; remove duplicated legacy action-step overrides.

- [ ] **Step 4: Verify shell rendering**

Run: `npm run build`
Expected: the shell compiles before page-specific migration continues.

### Task 3: Migrate the Event Inbox

**Files:**
- Modify: `src/pages/Inbox.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Continue calling `eventsApi.list/create/update/process/delete/restore/complete` with the existing payload types.
- Preserve the two-step self-processing flow and required action title, duration, and start date validation.

- [ ] **Step 1: Replace entry and filters**

Use `Input` with an embedded `Button`, `Select` for status filtering, `Typography.Text` for counts, and `Alert`/`Empty` for request and empty states.

- [ ] **Step 2: Replace event rows and feedback**

Use `Tag`, `Button`, `Tooltip`, `Popconfirm`, and `message` for status, actions, deletion, and mutation feedback. Preserve created-date text in `YYYY-MM-DD 新增` format.

- [ ] **Step 3: Rebuild process dialogs with Ant Design Form**

Use `Modal`, `Form`, `Input`, `Input.TextArea`, `Select`, `DatePicker`, and `Steps`. Convert selected dates to `YYYY-MM-DD`; keep the decomposition list editable and require at least one fully filled action.

- [ ] **Step 4: Exercise inbox flows**

Run: `npm run build`
Expected: build passes and the browser fallback still reports the protected desktop-client error when APIs are unavailable.

### Task 4: Migrate Projects and Action CRUD

**Files:**
- Modify: `src/pages/Projects.tsx`
- Modify: `src/pages/Actions.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Continue using `projectsApi` and `actionsApi` without changing command names or payload shapes.
- Preserve collapsed-by-default projects, expandable action lists, action CRUD, completed/abandoned restrictions, and delegated follow-up resolution.

- [ ] **Step 1: Rebuild project listing**

Use `Select`, `Collapse` or equivalent Ant Design expansion, `List`, `Tag`, `Button`, `Tooltip`, `Popconfirm`, `Empty`, and `Alert`. Hide add-action controls for non-active projects while retaining inspection.

- [ ] **Step 2: Rebuild project and action forms**

Use Ant Design `Form` validation, compact controls, `DatePicker`, `Select`, `Checkbox`, and `Input.TextArea` for project editing and nested action add/edit dialogs. Keep title, duration, and start-date requirements where currently enforced.

- [ ] **Step 3: Rebuild actions page**

Use compact filters and a single list surface for action rows. Preserve complete, restore, delete, edit, relation selection, frog flag, and delegated resolution flows; replace native prompts with Ant Design feedback.

- [ ] **Step 4: Verify page behavior**

Run: `npm run build`
Expected: TypeScript and Vite pass with all three routes migrated.

### Task 5: Desktop Validation and Cleanup

**Files:**
- Modify: `src/App.css`
- Modify: `src/index.css`
- Modify: `README.md` only if the run instructions need updating

- [ ] **Step 1: Run frontend validation**

Run: `npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run Rust validation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS; Rust API layer remains unchanged.

- [ ] **Step 3: Check Rust formatting**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS.

- [ ] **Step 4: Launch the Tauri desktop client**

Run the project through the existing Tauri development command in a complete MSVC environment and verify navigation, event creation, event processing, project expansion, project action CRUD, action CRUD, confirmations, and validation at 1000×650.

- [ ] **Step 5: Remove obsolete style and wrapper code**

After confirming no imports remain, remove only unused custom modal/badge rules and old action-step overrides; do not change backend or unrelated files.
