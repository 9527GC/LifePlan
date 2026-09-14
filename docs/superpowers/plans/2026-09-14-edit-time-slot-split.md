# 编辑时间段拆分功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑时间段弹框增加安全的 30 分钟拆分能力，并完成按钮文案、布局和白底 Toast 调整。

**Architecture:** 在现有 `daily_schedule` Rust 命令模块中增加 SQLite 事务型 `split_daily_slot` 命令，更新原时间段为前 30 分钟并创建无行动/复盘的后半段。React 页面通过 `dailyScheduleApi` 调用该命令，成功后关闭弹框、重新加载日期数据并显示白底提示。

**Tech Stack:** React 19、TypeScript、Ant Design 6、Day.js、Tauri 2、Rust、rusqlite、Vite。

## Global Constraints

- 所有用户可见文案使用简体中文。
- 拆分成功提示固定为 `完成拆分`，并使用白底样式。
- 时间格式为 `HH:mm`，分钟仅允许 `00` 或 `30`，不支持跨午夜。
- 行动和复盘字段必须保留在拆分后的前 30 分钟记录。
- 后端拆分必须在单个 SQLite 事务中完成，失败时整体回滚。
- 不改变现有删除已有行动时间段的限制、普通时间段重叠行为和工作日志逻辑。

---

## 文件地图

- `src-tauri/src/commands/daily_schedule.rs`：新增命令、时间计算、事务和数据归属处理。
- `src-tauri/src/lib.rs`：注册 Tauri 命令。
- `src/types/index.ts`：如接口返回类型需要，补充前端类型声明。
- `src/lib/api.ts`：暴露 `dailyScheduleApi.splitSlot`。
- `src/pages/DailyList.tsx`：编辑弹框按钮、拆分可见性、调用及成功刷新逻辑。
- `src/App.css`：新增拆分 Toast 白底样式；沿用现有表单布局。
- `docs/superpowers/specs/2026-09-14-edit-time-slot-split-design.md`：已确认设计依据。

## 接口约定

前端调用：

```ts
splitSlot: (listDate: string, slotId: number) =>
  invokeCommand<DailyScheduleSlot[]>("split_daily_slot", { listDate, slotId })
```

Rust 命令：

```rust
pub fn split_daily_slot(
    state: State<'_, AppState>,
    list_date: String,
    slot_id: i64,
) -> Result<Vec<DailyScheduleSlot>, String>
```

返回值为拆分后当前日期的两个 `DailyScheduleSlot`；前端仍以重新调用 `dailyScheduleApi.get` 的结果作为最终展示数据。

---

### Task 1: 增加后端原子拆分命令

**Files:**
- Modify: `E:/项目/LifePlanTodolist/src-tauri/src/commands/daily_schedule.rs`
- Modify: `E:/项目/LifePlanTodolist/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: 现有 `time_minutes`、`validate_date`、`slot_query`、`current_space_id`、`now_millis`、`AppState`。
- Produces: `daily_schedule::split_daily_slot`，返回 `Result<Vec<DailyScheduleSlot>, String>`。

- [ ] **Step 1: 写后端验证用例/验证场景**

由于项目当前没有 Rust 测试夹具，先在命令实现前固定以下可执行验收场景，后续通过临时 SQLite 数据库或手工桌面流程验证：

```text
输入 2026-09-14、原时间段 16:30-18:00：
原记录变为 16:30-17:00；新增记录为 17:00-18:00。
原记录 action_id/actual_notes/met_expectation/focused 不变；新增记录四个字段均为空。
输入 30 分钟时间段：返回“时间段必须超过 30 分钟才能拆分”。
输入不存在的 slot_id 或错误 list_date：返回“时间段不存在”。
```

- [ ] **Step 2: 实现拆分时间计算和事务**

在 `daily_schedule.rs` 的删除命令附近新增 `split_daily_slot`。实现要点：

```rust
let start_minutes: i32 = row.get(0)?;
let end_minutes: i32 = row.get(1)?;
if end_minutes - start_minutes <= 30 {
    return Err("时间段必须超过 30 分钟才能拆分".into());
}
let split_minutes = start_minutes + 30;
let split_time = format!("{:02}:{:02}", split_minutes / 60, split_minutes % 60);
let timestamp = now_millis();
let tx = conn.unchecked_transaction().map_err(|error| error.to_string())?;
tx.execute(
    "UPDATE daily_schedule_slots SET end_time = ?1, updated_at = ?2 WHERE id = ?3 AND space_id = ?4 AND list_date = ?5",
    params![split_time, timestamp, slot_id, space_id, list_date],
).map_err(|error| error.to_string())?;
tx.execute(
    "INSERT INTO daily_schedule_slots (space_id, list_date, start_time, end_time, action_id, actual_notes, met_expectation, focused, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, ?5, ?6, ?6)",
    params![space_id, list_date, split_time, end_time, sort_order + 1, timestamp],
).map_err(|error| error.to_string())?;
tx.commit().map_err(|error| error.to_string())?;
```

实际实现应先读取原始 `start_time`、`end_time`、`sort_order`，用现有 `time_minutes` 校验，使用事务连接完成更新和插入；不得清空原记录的行动或复盘列。返回 `slot_query(&conn, &list_date)?.into_iter().filter(...)` 得到两个拆分记录。

- [ ] **Step 3: 注册命令**

在 `src-tauri/src/lib.rs` 的 `invoke_handler` 列表中，在 `update_daily_slot` 和 `delete_daily_slot` 附近加入：

```rust
daily_schedule::split_daily_slot,
```

- [ ] **Step 4: 运行 Rust 格式和检查**

运行：

```powershell
cargo fmt --manifest-path E:/项目/LifePlanTodolist/src-tauri/Cargo.toml -- --check
cargo check --manifest-path E:/项目/LifePlanTodolist/src-tauri/Cargo.toml
```

预期：格式检查通过，`cargo check` 成功完成且无新增编译错误。

- [ ] **Step 5: 提交后端改动**

```powershell
git add src-tauri/src/commands/daily_schedule.rs src-tauri/src/lib.rs
git commit -m "新增时间段原子拆分命令"
```

### Task 2: 增加前端 API 和拆分弹框交互

**Files:**
- Modify: `E:/项目/LifePlanTodolist/src/lib/api.ts`
- Modify: `E:/项目/LifePlanTodolist/src/types/index.ts`（仅在类型缺失时修改）
- Modify: `E:/项目/LifePlanTodolist/src/pages/DailyList.tsx`

**Interfaces:**
- Consumes: Task 1 的 `split_daily_slot` 命令。
- Produces: `dailyScheduleApi.splitSlot(listDate, slotId)`；`TimeSlotModal` 的拆分按钮行为。

- [ ] **Step 1: 增加 API 方法**

在 `dailyScheduleApi` 现有 `updateSlot`、`deleteSlot` 附近加入：

```ts
splitSlot: (listDate: string, slotId: number) =>
  invokeCommand<DailyScheduleSlot[]>("split_daily_slot", { listDate, slotId }),
```

`DailyScheduleSlot` 已存在时不重复定义类型。

- [ ] **Step 2: 增加拆分状态和事件处理**

在 `TimeSlotModal` 中复用现有 `saving` 状态，新增：

```ts
const duration = minutesBetween(slot.start_time, slot.end_time);
const canSplit = duration > 30;

const split = async () => {
  setSaving(true);
  try {
    await dailyScheduleApi.splitSlot(slot.list_date, slot.id);
    await onSaved();
    message.success({ content: "完成拆分", className: "daily-split-message" });
  } catch (cause) {
    message.error(userFacingError(cause));
  } finally {
    setSaving(false);
  }
};
```

调用 `onSaved()` 后再显示成功提示，确保刷新完成；保留弹框关闭行为由父组件的 `onSaved` 完成。

- [ ] **Step 3: 调整弹框按钮**

将当前底部区域调整为：

```tsx
<div className="form-footer">
  {slot.action_id ? (
    <Button danger disabled title="请先移除已安排的行动">删除</Button>
  ) : (
    <Popconfirm title="确定删除这个时间段吗？" onConfirm={() => void remove()} okText="删除" cancelText="取消">
      <Button danger loading={saving}>删除</Button>
    </Popconfirm>
  )}
  {canSplit && <Button onClick={() => void split()} loading={saving}>拆分</Button>}
  <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
</div>
```

移除底部“取消”按钮；保留 `AntModal` 的 `onCancel={onClose}` 和右上角关闭按钮。所有异步操作共用 `saving`，避免重复提交。

- [ ] **Step 4: 运行前端构建**

运行：

```powershell
npm run build
```

预期：TypeScript 检查和 Vite 构建均成功。

- [ ] **Step 5: 提交前端交互改动**

```powershell
git add src/lib/api.ts src/pages/DailyList.tsx src/types/index.ts
git commit -m "调整时间段弹框并接入拆分操作"
```

### Task 3: 增加白底 Toast 样式并做集成验收

**Files:**
- Modify: `E:/项目/LifePlanTodolist/src/App.css`

**Interfaces:**
- Consumes: Task 2 使用的 `daily-split-message` class。
- Produces: 拆分成功提示的白底视觉样式。

- [ ] **Step 1: 增加精确样式**

在 `App.css` 中加入：

```css
.daily-split-message .ant-message-notice-content {
  background: #fff;
  color: #303133;
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
```

如果 Ant Design 6 的 class 层级在实际渲染中不匹配，应保留 `daily-split-message` 作为通知 class，并针对实际 DOM 层级将选择器收窄到通知内容节点，不修改全局 `.ant-message` 样式。

- [ ] **Step 2: 运行最终检查**

运行：

```powershell
npm run build
cargo fmt --manifest-path E:/项目/LifePlanTodolist/src-tauri/Cargo.toml -- --check
cargo check --manifest-path E:/项目/LifePlanTodolist/src-tauri/Cargo.toml
```

预期：全部命令成功。

- [ ] **Step 3: 手工验收桌面流程**

启动桌面客户端，依次验证：

```text
30 分钟时间段：不显示“拆分”。
60 分钟时间段：点击“拆分”后得到前 30 分钟和后 30 分钟。
90 分钟时间段：点击“拆分”后得到前 30 分钟和后 60 分钟。
带行动和复盘的时间段：行动、复盘留在前 30 分钟，后半段为空。
拆分成功：弹框关闭、列表刷新、显示白底“完成拆分”。
按钮文案：删除、拆分、保存；底部无取消按钮。
删除已有行动：仍不可删除，限制提示不变。
```

- [ ] **Step 4: 提交样式和验收改动**

```powershell
git add src/App.css
git commit -m "增加时间段拆分白底提示样式"
```

## 自检清单

- 设计文档中的按钮、拆分、数据归属、事务、Toast 和验收要求均已映射到 Task 1-3。
- 未引入新的依赖或改变现有删除、重叠校验、工作日志范围。
- `split_daily_slot` 的前端参数名与 Rust 命令参数名一致：`listDate`/`list_date` 通过 Tauri 参数对象映射。
- 30 分钟边界由前端隐藏按钮、后端再次校验，避免绕过 UI 造成非法拆分。
- 原记录的行动和复盘列只执行 `UPDATE end_time`，新记录显式写入空关联字段。
- 计划中没有未定义的函数或接口；执行时应根据现有项目的数据库连接事务 API 调整为可编译的等价写法。
