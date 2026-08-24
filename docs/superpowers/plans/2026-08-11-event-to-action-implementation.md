# 事件到行动闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Tauri + React + SQLite 架构上完成事件篮、事件转项目、委托跟进行动、完整行动页和项目状态联动。

**Architecture:** 保留事件、项目、行动三个独立对象，由 Rust 命令在 SQLite 事务中执行跨对象状态变更；React 页面只负责表单、筛选、确认弹窗和展示。事件与项目通过一对一来源关系连接，行动最多直接关联事件或项目中的一个，项目行动通过项目来源间接归属于事件。

**Tech Stack:** Tauri 2, Rust 2021, rusqlite 0.32, SQLite, React 19, TypeScript 5.8, React Router 7, Tailwind CSS 3, lucide-react.

## Global Constraints

- 第一阶段只实现 `事件 -> 项目 -> 行动`，不实现任务/子任务、每日清单、番茄钟、奖励池和复盘统计。
- 事件不再有 `description`、`goal` 字段；项目不再有 `description` 或 `goal_id`，项目目标使用独立的 `target` 多行文本。
- 项目只能由事件转化创建，一个事件最多一个项目；项目状态只有 `进行中 / 已完成 / 已放弃`。
- 行动状态为 `待办 / 已完成 / 已放弃`，预计耗时只能为 `0.5 / 1 / 1.5 / 2` 小时。
- 重要程度和紧急程度均保存为 `0/1`，优先级为四象限 `1/2/3/4`，数字越大越优先。
- 页面使用 `#1778FF` Ant Design 风格，窄侧栏显示完整导航文案，事件篮、项目清单、行动页均为单栏主区域。
- 优先适配桌面窗口 `800x600`，内容不足时滚动，更大窗口自适应。
- 所有跨对象操作必须由 Rust SQLite 事务完成，前端不自行推断联动状态。
- 当前工作区没有可用 Git 仓库，不执行提交步骤；每个任务以构建、单元测试或手工验收作为检查点。

## File Map

- Modify `src-tauri/src/db/migrations.rs`: 定义新表结构和初始化示例数据。
- Modify `src-tauri/src/db/mod.rs`: 添加幂等迁移和日期处理所需的数据库辅助函数；示例数据不作为本阶段必需项。
- Modify `src-tauri/src/models.rs`: 同步事件、项目、行动以及创建/更新载荷类型。
- Create `src-tauri/src/commands/actions.rs`: 行动查询、创建、更新、完成、恢复、删除和委托跟进行动完成联动。
- Modify `src-tauri/src/commands/events.rs`: 事件 CRUD、处理去向、转项目、完成/放弃/恢复级联。
- Modify `src-tauri/src/commands/projects.rs`: 项目 CRUD、编辑、完成、放弃、删除和恢复联动。
- Modify `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`: 注册行动模块和新的 Tauri 命令。
- Modify `src/lib/api.ts`: 为事件、项目、行动提供与 Rust 命令一致的调用封装。
- Modify `src/types/index.ts`: 删除目标旧模型，增加事件、项目、行动新字段和载荷类型。
- Modify `src/App.tsx` and `src/components/layout/Layout.tsx`: 保留路由骨架，应用新导航和视觉布局。
- Create `src/components/ui/Modal.tsx`, `src/components/ui/Select.tsx`, `src/components/ui/Badge.tsx`, `src/components/ui/ConfirmDialog.tsx`: 复用的表单、状态标签和确认交互。
- Create `src/components/events/EventForm.tsx`, `src/components/events/EventRow.tsx`, `src/components/events/EventProcessDialog.tsx`: 事件表单、事件行和四种处理流程。
- Create `src/components/actions/ActionForm.tsx`, `src/components/actions/ActionRow.tsx`, `src/components/actions/ActionFilters.tsx`: 行动创建/编辑表单、列表行和筛选器。
- Create `src/components/projects/ProjectRow.tsx`, `src/components/projects/ProjectEditDialog.tsx`, `src/components/projects/ProjectFilters.tsx`: 项目行、编辑弹窗和筛选器。
- Modify `src/pages/Inbox.tsx`, `src/pages/Actions.tsx`, `src/pages/Projects.tsx`: 使用新组件和真实 API。
- Modify `src/App.css`, `src/index.css`, `tailwind.config.js`: 统一 `#1778FF` 蓝色设计令牌、间距、窄侧栏和桌面响应式样式。
- Create `src-tauri/src/commands/tests.rs` or module-local `#[cfg(test)]` tests: 覆盖事务状态联动和核心排序/校验。

---

### Task 1: 重建事件、项目和行动数据模型

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/mod.rs`

**Interfaces:**
- Produces Rust types `Event`, `NewEvent`, `UpdateEvent`, `Project`, `NewProject`, `UpdateProject`, `Action`, `NewAction`, `UpdateAction`，供后续命令和前端 API 使用。
- Produces event statuses `0..=5` for `未处理 / 已转项目 / 已委托 / 延迟 / 已放弃 / 已完成`，project statuses `1..=3` for `进行中 / 已完成 / 已放弃`，action statuses `0..=2` for `待办 / 已完成 / 已放弃`。

- [ ] **Step 1: 更新 Rust 模型和 TypeScript 对应字段清单**
  - `Event` 删除 `description` 和 `decision`，增加 `follow_up_date`, `delay_until`, `delay_note`, `abandon_reason`。
  - `Project` 使用必填唯一 `event_id`、可空 `target`，删除 `goal_id` 和项目说明字段。
  - `Action` 使用可空 `project_id`、可空 `event_id`，增加 `completed_at`, `is_delegated_follow_up`, `cascade_abandoned`。
  - 所有日期字段使用 Unix 日开始时间戳；前端表单使用 `YYYY-MM-DD` 字符串转换。

- [ ] **Step 2: 将迁移 SQL 改为新的表约束**
  - `projects.event_id` 增加唯一约束并开启级联所需的外键关系。
  - `actions.project_id` 改为可空，新增 `event_id`、`completed_at`、`is_delegated_follow_up`、`cascade_abandoned`。
  - `events` 增加委托、延迟和放弃字段，保留时间戳字段。
- 采用项目-行动两层模型；不建立或保留任务/子任务表。每日清单、番茄钟、时间日志、奖励和复盘相关表属于后续阶段。

- [ ] **Step 3: 添加幂等迁移处理旧结构**
  - 在 `run_migrations` 中先执行 `PRAGMA foreign_keys = ON`。
  - 通过 `PRAGMA table_info` 判断字段是否存在；新字段使用 `ALTER TABLE ... ADD COLUMN`，旧的 `projects` 需要通过临时表重建以移除 `goal_id`、`description` 并创建 `event_id` 唯一约束。
  - 对无法映射到新模型的孤立旧项目不自动保留；初始化后的有效数据必须满足事件来源约束。
  - 迁移执行后再次运行不能重复添加字段或示例数据。

- [ ] **Step 4: 运行 Rust 编译检查**
  - Run: `cargo check --manifest-path src-tauri/Cargo.toml`
  - Expected: PASS；模型、迁移和模块声明无编译错误。

### Task 2: 建立后端事件 CRUD、处理和级联事务

**Files:**
- Modify: `src-tauri/src/commands/events.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs`

**Interfaces:**
- Produces commands `get_events`, `create_event`, `update_event`, `delete_event`, `process_event`, `complete_event`, `abandon_event`, `restore_event`, `convert_event_to_project`。
- `process_event` 接收处理去向载荷，事务内更新事件、创建项目或委托行动、迁移直接行动。
- `delete_event` 事务内删除事件及其项目/行动；`restore_event` 只恢复本次级联放弃的数据。

- [ ] **Step 1: 为事件状态和处理载荷定义 Rust 枚举/结构体**
  - 使用 `ProcessEventPayload` 区分 `self_do`, `delegate`, `delay`, `abandon` 四种去向。
  - `self_do` 包含项目标题、目标、耗时、日期、重要程度、紧急程度和初始行动标题。
  - `delegate` 包含委托对象、跟进日期、说明和可编辑行动标题。
  - `delay` 包含可空重新处理日期和备注；`abandon` 包含必填原因。

- [ ] **Step 2: 实现事件 CRUD 和日期到期恢复**
  - 创建事件只保存标题，状态为未处理。
  - 更新事件只允许改标题。
  - 查询事件时先把已到期的 `delay_until` 更新为未处理，再按创建时间倒序返回。
  - 删除事件按是否有 `event_id` 来源项目分支执行级联删除。

- [ ] **Step 3: 实现自己做转项目事务**
  - 校验标题、耗时枚举、重要程度、紧急程度和日期顺序。
  - 插入一个 `event_id` 唯一的进行中项目。
  - 将原事件直接行动的 `project_id` 改为新项目 ID 并清空 `event_id`。
  - 仅当迁移前没有直接行动时创建初始行动；初始行动默认 1 小时并继承项目重要/紧急/日期。
  - 更新事件为已转项目并提交事务。

- [ ] **Step 4: 实现委托、延迟和放弃事务**
  - 委托创建固定关联原事件的跟进行动，默认不重要、不紧急、1 小时、非青蛙、开始日期为跟进日期。
  - 延迟保存日期和备注，状态为延迟。
  - 放弃写入事件原因，并将来源项目和所有待办行动级联为已放弃，级联行动设置 `cascade_abandoned = 1`。

- [ ] **Step 5: 实现事件完成、恢复和委托跟进完成分支**
  - 完成前要求至少一条直接行动且不存在待办行动；返回已完成/已放弃汇总供前端确认。
  - 恢复只允许已放弃事件，恢复来源项目和 `cascade_abandoned = 1` 的行动，随后清除级联标记。
  - 委托跟进行动删除时恢复原事件为未处理。
  - 委托跟进行动完成后的“保持已委托 / 已完成 / 已放弃”选择由单独事务命令执行。

- [ ] **Step 6: 为关键事务增加 Rust 单元测试**
  - 使用临时 SQLite 连接初始化迁移。
  - 测试转项目迁移已有事件行动且不重复创建初始行动。
  - 测试无行动事件转项目时创建初始行动。
  - 测试放弃/恢复只恢复级联行动。
  - 测试删除事件会删除来源项目和行动。

### Task 3: 建立后端项目命令和联动

**Files:**
- Modify: `src-tauri/src/commands/projects.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces commands `get_projects`, `update_project`, `delete_project`, `complete_project`, `abandon_project`。
- `update_project` 支持标题、目标、耗时、日期、重要程度、紧急程度，关联事件不可修改。
- `complete_project` 返回行动汇总并只在无待办且至少一条行动时提交完成。

- [ ] **Step 1: 重写项目查询和更新映射**
  - 查询项目时联结来源事件标题和行动统计，返回进行中/已完成/已放弃状态。
  - 更新时重新计算 `priority = importance * 2 + urgency + 1`，确保四象限值为 1 到 4。
  - 目标为空时保存 `NULL`，不再读取目标表。

- [ ] **Step 2: 实现项目完成事务**
  - 检查项目至少有一条行动且没有待办行动。
  - 将项目改为已完成，并将来源事件改为已完成。
  - 返回已完成/已放弃行动数量。

- [ ] **Step 3: 实现项目放弃事务**
  - 要求非空放弃原因。
  - 更新来源事件和项目为已放弃，写入同一事件放弃原因。
  - 仅将待办项目行动改为已放弃并设置级联标记。

- [ ] **Step 4: 实现项目删除事务**
  - 只允许“删除项目和全部行动”路径；在事务中删除项目行动、项目和来源事件。
  - 没有行动的项目也使用同一事务路径，保证事件不会留下孤立项目状态。

- [ ] **Step 5: 测试项目状态联动**
  - 测试项目无行动或存在待办时不能完成。
  - 测试完成项目同步事件完成。
  - 测试放弃项目级联待办行动并保留已完成/已放弃行动。
  - 测试删除项目同时删除来源事件和行动。

### Task 4: 建立后端行动命令

**Files:**
- Create: `src-tauri/src/commands/actions.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces commands `get_actions`, `create_action`, `update_action`, `complete_action`, `restore_action`, `delete_action`, `complete_delegated_follow_up`。
- `NewAction` 由项目入口创建并自动接收 `project_id`；不支持无关联行动或直接关联事件。
- `UpdateAction` 不包含 `event_id`、`project_id` 或关联类型字段。

- [ ] **Step 1: 实现行动查询和排序**
  - 默认查询待办行动。
  - 支持状态和青蛙筛选；不实现四象限、事项链路和委托多维筛选。
  - 排序按 priority 降序、有日期优先、日期升序、无日期最后、created_at 升序。
  - 返回关联项目标题、来源事件标题、委托对象和完成时间。

- [ ] **Step 2: 实现新建行动校验**
  - 标题非空、耗时只能为 0.5/1/1.5/2、日期顺序有效。
  - 行动只能从项目入口创建，并遵循项目的二值重要程度和紧急程度。
  - 已放弃项目不允许新增行动。

- [ ] **Step 3: 实现更新、完成和恢复**
  - 更新只修改可编辑字段，关联字段保持不变。
  - 完成写入 `completed_at`；普通行动只改变自身状态。
  - 恢复只允许已完成行动，清空 `completed_at`；已完成项目下行动恢复时同步项目和事件为进行中/已转项目；未转项目的已完成事件新增待办时恢复事件为未处理。

- [ ] **Step 4: 实现删除和最后行动保护**
  - 删除前由前端确认，后端仍检查项目最后一条行动不能删除。
  - 未转项目事件的最后一条直接行动可以删除，但不自动改变事件状态。
  - 委托跟进行动删除时在同一事务中将原事件恢复为未处理。

- [ ] **Step 5: 测试行动规则**
  - 测试四种耗时值和非法耗时拒绝。
  - 测试关联类型创建后不可更新。
  - 测试完成/恢复完成时间。
  - 测试项目最后一条行动删除保护和委托行动删除联动。

### Task 5: 同步前端类型、API 和通用交互组件

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/api.ts`
- Create: `src/components/ui/Modal.tsx`
- Create: `src/components/ui/Select.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/ConfirmDialog.tsx`

**Interfaces:**
- Produces typed API objects `eventsApi`, `projectsApi`, `actionsApi` matching the Rust command argument names and return payloads.
- Produces reusable `Modal`, `Select`, `Badge`, `ConfirmDialog` components with keyboard escape, disabled/loading state and error-safe submit behavior.

- [ ] **Step 1: 删除旧目标类型和 API**
  - 删除 `Goal`, `NewGoal`, `UpdateGoal` 及 `goalsApi`。
  - 删除事件 `description` 字段、项目 `goal_id`/`description` 字段。

- [ ] **Step 2: 添加前端事件、项目、行动类型**
  - 定义状态联合类型和创建/更新载荷。
  - `Action` 同时包含关联展示字段和 `isDelegatedFollowUp`。
  - 日期值在表单层使用字符串，在 API 层转换为 Rust 需要的数字日期。

- [ ] **Step 3: 添加 API 封装**
  - `eventsApi.process`, `complete`, `abandon`, `restore`, `delete`。
  - `projectsApi.update`, `complete`, `abandon`, `delete`。
  - `actionsApi.list`, `create`, `update`, `complete`, `restore`, `delete`, `completeDelegatedFollowUp`。
  - 所有方法保持 `invoke<T>(command, payload)` 的现有风格。

- [ ] **Step 4: 实现通用弹窗和字段组件**
  - `Modal` 用固定宽度、滚动内容和 `aria-modal`，在 800x600 中不撑破窗口。
  - `ConfirmDialog` 支持确认/取消、危险操作样式和异步 loading。
  - `Select` 支持标签、错误态和半小时耗时下拉选项。
  - `Badge` 统一状态、四象限、青蛙和委托跟进标签。

### Task 6: 实现事件篮和四种处理流程

**Files:**
- Create: `src/components/events/EventForm.tsx`
- Create: `src/components/events/EventRow.tsx`
- Create: `src/components/events/EventProcessDialog.tsx`
- Modify: `src/pages/Inbox.tsx`

**Interfaces:**
- `EventForm` 输出标题。
- `EventProcessDialog` 根据去向渲染表单并调用 `eventsApi.process`。
- `Inbox` 管理事件列表、筛选、弹窗打开状态和操作后刷新。

- [ ] **Step 1: 实现新建事件表单**
  - 页面顶部显示标题输入和 `+ 新建事件` 按钮。
  - 标题为空时禁用提交并显示内联校验。
  - 成功后清空表单、刷新列表并聚焦输入框。

- [ ] **Step 2: 实现事件筛选和单栏行**
  - 使用筛选标签 `待处理 / 已处理 / 全部` 和具体状态筛选入口。
  - 待处理内延迟事件排在底部。
  - 事件行完整显示标题、状态、委托对象或延迟日期/备注摘要。

- [ ] **Step 3: 实现自己做表单**
  - 项目标题默认事件标题。
  - 展示目标多行输入、四种耗时、日期、重要程度、紧急程度。
  - 根据事件当前行动数量动态显示或隐藏初始行动标题；没有行动时标题必填。
  - 提交前校验日期顺序并显示后端错误。

- [ ] **Step 4: 实现委托、延迟和放弃表单**
  - 委托对象和跟进日期必填，标题默认可编辑，说明选填。
  - 延迟日期和备注可选填。
  - 放弃原因必填，危险按钮显示级联说明。

- [ ] **Step 5: 实现事件完成、恢复和删除确认**
  - 事件满足完成条件时显示完成按钮和行动汇总确认。
  - 已放弃事件显示恢复确认，说明项目和级联行动恢复范围。
  - 删除事件按是否已转项目显示级联影响，并调用后端单一删除命令。

### Task 7: 实现行动页

**Files:**
- Create: `src/components/actions/ActionForm.tsx`
- Create: `src/components/actions/ActionRow.tsx`
- Create: `src/components/actions/ActionFilters.tsx`
- Modify: `src/pages/Actions.tsx`

**Interfaces:**
- `ActionFilters` 输出状态和青蛙筛选值。
- `ActionForm` 支持 `create | edit` 模式，编辑模式不渲染关联类型控件。
- `Actions` 通过 `actionsApi` 管理列表和弹窗状态。

- [ ] **Step 1: 实现默认列表和筛选器**
  - 首次加载只请求待办行动。
  - 状态、四象限、青蛙和事项筛选变化时重新请求。
  - 事项筛选显示事件链路，项目行动显示来源事件和项目。

- [ ] **Step 2: 实现新建行动表单**
  - 行动从项目卡片入口创建，自动关联当前项目。
  - 标题、说明、耗时、日期、青蛙字段与后端校验一致。

- [ ] **Step 3: 实现行动行和编辑**
  - 显示标题、状态、优先级、日期、委托跟进标签、委托对象和青蛙标记。
  - 编辑普通行动的所有非关联字段；委托行动隐藏关联编辑并保留原事件。

- [ ] **Step 4: 实现完成、恢复和删除**
  - 待办行动提供完成操作。
  - 已完成行动提供恢复待办操作。
  - 删除使用确认弹窗；后端拒绝删除项目最后行动时展示明确错误。
  - 委托跟进行动完成后展示保持已委托/完成/放弃三选一弹窗，选择放弃时追加原因输入。

### Task 8: 实现项目页和状态联动入口

**Files:**
- Create: `src/components/projects/ProjectRow.tsx`
- Create: `src/components/projects/ProjectEditDialog.tsx`
- Create: `src/components/projects/ProjectFilters.tsx`
- Modify: `src/pages/Projects.tsx`

**Interfaces:**
- `ProjectEditDialog` 输出项目标题、目标、耗时、日期、重要程度和紧急程度。
- `ProjectRow` 提供编辑、完成、放弃和删除操作回调。

- [ ] **Step 1: 实现项目筛选和列表**
  - 默认请求进行中项目。
  - 项目入口合并到事件篮“已转项目”Tab，不提供独立项目状态筛选。
  - 展示目标、四象限、耗时、日期、行动进度、来源事件和状态。

- [ ] **Step 2: 实现直接编辑**
  - 标题和目标可编辑；目标支持多行输入和清空。
  - 耗时使用四个下拉选项，日期校验和行动表单一致。
  - 项目来源事件只读展示。

- [ ] **Step 3: 实现完成和放弃**
  - 项目无待办且至少有行动时提供完成确认和行动汇总。
  - 放弃弹窗要求原因并说明待办行动会级联为已放弃。
  - 完成/放弃成功后刷新项目和事件相关列表。

- [ ] **Step 4: 实现删除和空状态**
  - 有行动时只提供取消或删除项目和全部行动。
  - 删除成功后刷新项目列表，事件篮中来源事件同步消失。
  - 无项目时显示由事件篮创建项目的入口提示，不再提供孤立示例项目按钮。

### Task 9: 完成布局和视觉系统

**Files:**
- Modify: `src/components/layout/Layout.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/db/migrations.rs`

**Interfaces:**
- Produces the final desktop shell with complete narrow-sidebar labels and single-column content pages.
- Produces one-time initialization function that inserts one example event, project, and 2–3 actions only for an empty new database.

- [ ] **Step 1: 重做布局壳和导航**
  - 导航固定窄宽度但显示完整中文文案，不使用只显示图标的折叠状态。
  - 主区域使用单栏、浅灰背景、白色列表项、`#1778FF` 主按钮和浅蓝选中态。
  - 所有按钮补充 lucide 图标，危险操作使用红色语义，普通操作使用蓝色或灰色。

- [ ] **Step 2: 清理旧目标和占位文案**
  - 移除目标规划区块、示例项目按钮和事件/项目说明字段。
  - 更新空状态和导航文案，确保不存在旧的目标 API 调用。

- [ ] **Step 3: 保留示例数据扩展点**
  - 示例数据不作为当前阶段必需项，不纳入本阶段验收。
  - 后续如启用示例数据，再增加初始化标记和防重复生成规则。

- [ ] **Step 4: 做 800x600 和大窗口检查**
  - 在 `800x600` 下验证导航文案、表单、列表和弹窗均可滚动且没有遮挡。
  - 在至少一个更大窗口验证主区域宽度自适应，事件和行动仍保持单栏。

### Task 10: 全面验证并修复集成问题

**Files:**
- Modify: any implementation file that fails the checks above
- Test: `src-tauri/src/commands/*.rs` module-local tests

**Interfaces:**
- Consumes all previous Rust commands and React API types.
- Produces a buildable application with validated core state transitions.

- [ ] **Step 1: 运行 Rust 格式化和测试**
  - Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
  - Expected: PASS；所有 Rust 文件格式符合 rustfmt。
  - Run: `cargo test --manifest-path src-tauri/Cargo.toml`
  - Expected: PASS；迁移、转项目、级联和行动规则测试全部通过。

- [ ] **Step 2: 运行 TypeScript 构建**
  - Run: `npm run build`
  - Expected: PASS；`tsc` 和 `vite build` 均成功，没有未使用变量、类型错误或旧 API 引用。

- [ ] **Step 3: 手工走通核心链路**
  - 新建纯标题事件，验证待处理列表。
  - 执行自己做，验证项目创建、初始行动或已有行动迁移。
  - 执行委托，验证跟进行动、完成后三种分支和删除恢复事件。
  - 执行延迟，验证待处理底部排序和到期恢复。
  - 执行放弃/恢复，验证项目、事件和级联行动状态。
  - 验证行动筛选、编辑、完成、恢复、删除和项目最后行动保护。

- [ ] **Step 4: 检查已取消字段和 UI 视觉**
  - 搜索前端和 Rust 源码，确认没有用户可见的 `goal_id`、事件说明、事件目标、项目说明或目标规划入口。
  - 确认主色为 `#1778FF`，窄侧栏文案完整，事件篮/项目/行动均为单栏。

- [ ] **Step 5: 记录验证结果**
  - 在最终交付说明中列出通过的命令、未能执行的环境依赖和任何非本阶段遗留问题。
