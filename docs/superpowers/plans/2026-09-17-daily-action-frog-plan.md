# 今日事行动详情标记青蛙实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 在“今日事”的已安排行动详情弹框中增加可即时保存的“标记为青蛙”复选框及提示，并同步更新界面状态。

**架构：** 复用 `ActionPickerModal` 中已有的行动详情视图、`actionsApi.update` 接口和 `FrogHelp` 提示组件。详情视图维护一个受控复选框和更新中状态，成功后通过父组件已有的 slot 回调与行动列表状态同步完整行动对象，失败时回滚复选框。

**技术栈：** React 19、TypeScript、Ant Design、Tauri command API、现有 Vite 构建与 Node 测试脚本。

## 全局约束

- 所有新增代码注释、文档和提交信息使用简体中文。
- 只修改“今日事”详情弹框相关前端逻辑，不新增数据库字段或后端命令。
- 复选框文案必须为“标记为青蛙”，并复用现有 `FrogHelp` 提示。
- 勾选和取消勾选必须立即持久化；取消勾选保存为 `is_frog: 0`。
- 更新失败必须恢复变更前状态并通过 `userFacingError` 与 `message.error` 提示。

---

### 任务 1：为详情视图准备行动更新同步接口

**文件：**
- 修改：`E:\项目\LifePlanTodolist\src\pages\DailyList.tsx:31-90`
- 修改：`E:\项目\LifePlanTodolist\src\pages\DailyList.tsx:188-207`

**接口：**
- `DailyList` 继续维护 `schedule` 与 `actions` 两份状态。
- `ActionPickerModal` 增加 `onActionUpdated: (action: Action) => void` 属性。
- 父组件传入回调后，将返回的完整行动对象写回 `actions`，并将当前 slot 的 `action` 同步替换；已有 `onSaved` 仍只负责 slot 结构更新。

- [ ] **步骤 1：修改父组件调用点**

在 `DailyList` 渲染 `ActionPickerModal` 的位置增加：

```tsx
onActionUpdated={(action) => {
  setActions((current) => current.map((item) => item.id === action.id ? action : item));
  setSchedule((current) => current ? {
    ...current,
    slots: current.slots.map((item) => item.action_id === action.id
      ? { ...item, action }
      : item),
  } : current);
}}
```

保留现有 `onAssigned`、`onSaved` 和其他属性不变。

- [ ] **步骤 2：扩展 `ActionPickerModal` 属性类型**

将组件属性类型增加：

```tsx
onActionUpdated: (action: Action) => void;
```

并在函数参数解构中接收该回调。不要改动已有行动安排与重复行动逻辑。

- [ ] **步骤 3：执行类型检查**

运行：

```bash
npm run build
```

预期：如果此时只有调用点和属性定义变化，TypeScript 编译通过；若出现属性漏传错误，修正所有 `ActionPickerModal` 调用点后再继续。

- [ ] **步骤 4：提交**

```bash
git add src/pages/DailyList.tsx
git commit -m "重构：同步今日事行动更新状态"
```

---

### 任务 2：实现青蛙复选框的即时更新与回滚

**文件：**
- 修改：`E:\项目\LifePlanTodolist\src\pages\DailyList.tsx:188-323`

**接口：**
- 使用 `actionsApi.update(payload: UpdateAction): Promise<Action>`。
- 使用 `onActionUpdated(action: Action)` 将接口返回的完整行动同步到父组件。
- 复选框变更处理函数必须接受 `checked: boolean`，并提交 `is_frog: checked ? 1 : 0`。

- [ ] **步骤 1：增加详情视图状态**

在 `ActionPickerModal` 内增加：

```tsx
const [frogSaving, setFrogSaving] = useState(false);
const [frogChecked, setFrogChecked] = useState(false);
```

在已有依赖 `slot` 的 `useEffect` 中，当 slot 变化时初始化：

```tsx
setFrogChecked(slot.action?.is_frog === 1);
setFrogSaving(false);
```

这样打开普通行动时默认未勾选，打开青蛙行动时默认已勾选。

- [ ] **步骤 2：增加更新处理函数**

在 `ActionPickerModal` 内加入以下逻辑，放在 `performAssign` 前后均可：

```tsx
const updateFrogStatus = async (checked: boolean) => {
  if (!slot.action) return;
  const previous = frogChecked;
  setFrogChecked(checked);
  setFrogSaving(true);
  try {
    const updated = await actionsApi.update({
      id: slot.action.id,
      title: slot.action.title,
      description: slot.action.description,
      estimated_hours: slot.action.estimated_hours,
      start_date: slot.action.start_date,
      deadline: slot.action.deadline,
      is_frog: checked ? 1 : 0,
      importance: slot.action.importance,
      urgency: slot.action.urgency,
    });
    onActionUpdated(updated);
    message.success(checked ? "已标记为青蛙行动" : "已恢复为普通行动");
  } catch (cause) {
    setFrogChecked(previous);
    message.error(userFacingError(cause));
  } finally {
    setFrogSaving(false);
  }
};
```

该 payload 必须完整保留行动的非青蛙字段，避免更新接口将其他字段重置。

- [ ] **步骤 3：在详情弹框底部增加布局**

将现有详情视图替换为等价的左右布局：

```tsx
<div className="form-footer daily-action-detail-footer">
  <Checkbox
    checked={frogChecked}
    disabled={frogSaving}
    onChange={(event) => void updateFrogStatus(event.target.checked)}
  >
    标记为青蛙 <FrogHelp />
  </Checkbox>
  <Space>
    <Button onClick={() => setViewing(false)}>更换行动</Button>
    <Button type="primary" onClick={() => slot.action && onStartPomodoro(slot.action)}>
      开始番茄钟
    </Button>
  </Space>
</div>
```

保留详情弹框中的 `ActionPreview` 与原有标题、关闭行为不变。`Space` 已在文件导入中存在。

- [ ] **步骤 4：增加必要的 CSS**

在 `E:\项目\LifePlanTodolist\src\App.css` 增加：

```css
.daily-action-detail-footer {
  justify-content: space-between;
  align-items: center;
}
```

如果现有 `.form-footer` 在窄窗口无法容纳按钮，使用 `flex-wrap: wrap; gap: 12px;`，不得改变其他弹框 footer 的布局。

- [ ] **步骤 5：执行构建验证**

运行：

```bash
npm run build
```

预期：输出 TypeScript 无错误并成功生成 Vite 构建产物。

- [ ] **步骤 6：提交**

```bash
git add src/pages/DailyList.tsx src/App.css
git commit -m "功能：支持在今日事详情标记青蛙行动"
```

---

### 任务 3：执行回归验证并检查变更范围

**文件：**
- 检查：`E:\项目\LifePlanTodolist\src\pages\DailyList.tsx`
- 检查：`E:\项目\LifePlanTodolist\src\App.css`
- 检查：`E:\项目\LifePlanTodolist\docs\superpowers\specs\2026-09-17-daily-action-frog-design.md`

- [ ] **步骤 1：运行现有测试**

运行：

```bash
npm run test:release
```

预期：所有已有 release 测试通过。

- [ ] **步骤 2：检查差异**

运行：

```bash
git diff HEAD~2..HEAD -- src/pages/DailyList.tsx src/App.css
```

确认差异仅包含：详情弹框复选框、行动更新同步、错误回滚和对应样式；未修改行动安排、重复行动、番茄钟行为。

- [ ] **步骤 3：检查工作区状态**

运行：

```bash
git status --short
```

确认不覆盖用户已有的 `src-tauri` 未提交修改；如工作区中仍有这些修改，不要执行清理或还原。

- [ ] **步骤 4：完成验收清单**

手动启动桌面客户端，逐项验证：

1. 普通行动详情中复选框未勾选；
2. 勾选后详情与今日事单元格显示“青蛙”；
3. 关闭并重新打开后仍已勾选；
4. 取消勾选后立即去除“青蛙”标签；
5. 失败时复选框回滚并显示错误；
6. “更换行动”和“开始番茄钟”仍可正常使用。

- [ ] **步骤 5：提交回归验证结果**

```bash
git status --short
```

预期：只保留用户原有未提交的 `src-tauri` 修改，功能代码与文档已提交。
