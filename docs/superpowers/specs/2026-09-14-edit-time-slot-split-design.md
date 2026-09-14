# 编辑时间段弹框拆分功能设计

**日期：** 2026-09-14

## 目标
调整编辑时间段弹框的按钮文案和布局，并增加“拆分”功能：将超过 30 分钟的时间段拆成“前 30 分钟”和“剩余时间”两个时间段，同时保留行动及复盘记录在前 30 分钟时间段。

## 交互设计
- 删除底部“取消”按钮，保留右上角关闭按钮。
- “删除时间段”改为“删除”，“保存时间段”改为“保存”。
- 按钮顺序为：删除、拆分、保存。
- 时长正好 30 分钟时隐藏“拆分”；大于 30 分钟时显示。
- 点击拆分后调用后端原子命令；成功后关闭弹框、刷新日程，显示白底 Toast“完成拆分”。
- 失败时保留弹框并显示错误。
- 删除已有行动时间段的限制保持不变。

## 拆分规则
原时间段 `start_time-end_time` 拆为：
- 原记录：`start_time-(start_time+30分钟)`；
- 新记录：`(start_time+30分钟)-end_time`。

例如 `16:30-18:00` 拆为 `16:30-17:00` 和 `17:00-18:00`。原记录的 `action_id`、`actual_notes`、`met_expectation`、`focused` 全部保留，新记录不关联行动且不带复盘数据。当前后端仅允许分钟为 `00` 或 `30`，不支持跨午夜。

## 后端事务
新增 `split_daily_slot` Tauri 命令，在 SQLite 事务中完成查询、校验、更新原记录、创建后半段记录及提交；任一步失败均回滚。按 `space_id + list_date + slot_id` 校验归属，时长不超过 30 分钟时拒绝拆分。

前端 API：

```ts
splitSlot: (listDate: string, slotId: number) =>
  invokeCommand<DailyScheduleSlot[]>("split_daily_slot", { listDate, slotId })
```

Rust 命令：

```rust
#[tauri::command]
pub fn split_daily_slot(
    state: State<'_, AppState>,
    list_date: String,
    slot_id: i64,
) -> Result<Vec<DailyScheduleSlot>, String>
```

前端成功后以重新加载的完整日程为准。

## Toast
使用独立 class 覆盖 Ant Design 样式：白色背景、深色文字、浅色边框和轻微阴影；文案为“完成拆分”。

## 验收标准
- 30 分钟时不显示拆分，超过 30 分钟时正确显示。
- 拆分产生两个连续时间段，行动和复盘仅保留在前 30 分钟。
- 后端事务原子，不产生半拆分状态。
- 成功后关闭弹框、刷新列表并显示白底提示。
- 按钮文案和布局符合要求。
- `npm run build` 和 Rust 检查通过。

## 不包含
不改变新增/编辑时间段的既有重叠校验、删除规则或工作日志逻辑。
