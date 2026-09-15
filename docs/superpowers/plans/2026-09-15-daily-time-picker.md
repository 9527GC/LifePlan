# 今日事时间选择器改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“今日事”新增/编辑时间段的小时、分钟分栏选择改为每 30 分钟一个候选项的组合时间列表，并支持点击即选中以及“此刻”快捷选择。

**Architecture:** 在 `DailyList.tsx` 中抽取可复用的半小时刻度时间选择器，继续向 Ant Design `Form` 提供 `Dayjs` 值，新增和编辑弹窗仅替换字段控件。通过受控下拉状态、自定义候选列表和底部快捷操作实现点击即关闭，保持现有保存与校验逻辑。

**Tech Stack:** React 19、TypeScript、Ant Design 6、Dayjs、现有 CSS、Vite。

## Global Constraints

- 候选时间固定为 `00:00` 至 `23:30`，步进为 30 分钟。
- 小时和分钟必须组合成单个 `HH:mm` 候选项。
- 点击候选项后立即更新字段并关闭下拉，不显示默认“确定”按钮。
- 下拉底部仅保留“此刻”按钮。
- “此刻”按当前时间映射到最近的半小时：分钟 `<15` 为 `:00`，`15-44` 为 `:30`，`>=45` 进位到下一小时。
- 保持现有表单校验、数据结构、后端接口及保存流程。
- 代码注释、文档、提交信息使用简体中文。
- 不覆盖或纳入当前工作区已有的 `src/App.css`、`src/pages/DailyList.tsx`、`src/pages/Inbox.tsx` 修改之外的无关变更。

## 文件结构与职责

- Modify: `E:\项目\LifePlanTodolist\src\pages\DailyList.tsx` — 新增半小时候选生成、组合时间选择器及新增/编辑表单接入。
- Modify: `E:\项目\LifePlanTodolist\src\App.css` — 增加时间列表、选中态、滚动区域和“此刻”按钮样式；保留并合并现有未提交修改。
- Test: 手工验证新增/编辑弹窗及 `npm run build`；项目当前未配置独立测试脚本。

### Task 1: 抽取时间候选与“此刻”转换逻辑

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src\pages\DailyList.tsx`

**Interfaces:**
- Produces `HALF_HOUR_TIMES: string[]`、`toHalfHourTime(value: Dayjs): string` 和候选项到 `Dayjs` 的转换逻辑，供时间选择器使用。

- [ ] **Step 1: 在现有时间工具函数附近增加全天候选生成函数**

```ts
const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) => {
  const minutes = index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
```

- [ ] **Step 2: 增加“此刻”半小时映射函数**

```ts
const toHalfHourTime = (value: Dayjs) => {
  const rounded = value.minute() < 15 ? 0 : value.minute() < 45 ? 30 : 0;
  const hour = value.minute() >= 45 ? value.hour() + 1 : value.hour();
  return `${String(hour % 24).padStart(2, "0")}:${String(rounded).padStart(2, "0")}`;
};
```

- [ ] **Step 3: 检查 TypeScript 类型并确认函数不改变现有 `formatTime`、`minutesBetween` 行为**

运行：`npm run build`
预期：若选择器尚未接入，构建保持通过。

### Task 2: 实现可复用组合时间选择器

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src\pages\DailyList.tsx`

**Interfaces:**
- Consumes: `Form.Item` 的 `Dayjs | undefined` 字段值、`HALF_HOUR_TIMES`、`toHalfHourTime`。
- Produces: `HalfHourTimePicker`，props 至少包含 `value?: Dayjs`、`onChange?: (value: Dayjs | null) => void`、`className?: string`。

- [ ] **Step 1: 编写受控选择器组件骨架**

组件使用 `Dropdown` 或等价的受控弹层承载自定义面板，触发器显示当前值的 `HH:mm`，无值时显示 Ant Design 时间输入的占位文本。

- [ ] **Step 2: 实现候选列表点击行为**

候选项点击时使用 `dayjs("2000-01-01T" + time)` 创建值，调用 `onChange(nextValue)`，随后关闭面板。选中态通过当前 `value.format("HH:mm")` 与候选字符串比较确定。

- [ ] **Step 3: 实现“此刻”按钮行为**

点击“此刻”时调用 `toHalfHourTime(dayjs())`，转换为当天基准日期的 `Dayjs` 值，调用 `onChange` 并关闭面板。

- [ ] **Step 4: 实现键盘与可访问性行为**

候选项使用按钮或具备 `role="option"` 的可聚焦元素，支持 Enter/Space 选择；弹层关闭后触发器恢复焦点，按钮提供“此刻”文字标签。

- [ ] **Step 5: 处理弹层定位与当前值滚动**

列表设置固定可用高度并允许纵向滚动；打开时将当前候选项滚动到可见区域，当前值不存在于半小时候选时不强制改写，直到用户主动选择。

### Task 3: 接入新增与编辑时间段表单

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src\pages\DailyList.tsx`

- [ ] **Step 1: 替换 `InsertSlotModal` 的开始时间控件**

将 `TimePicker format="HH:mm" minuteStep={30}` 替换为 `HalfHourTimePicker`，保持 `Form.Item name="start_time"`、label、rules 和 `className="full-width"`。

- [ ] **Step 2: 替换 `InsertSlotModal` 的结束时间控件**

保持 `Form.Item name="end_time"` 的字段名和校验，仅替换内部选择器。

- [ ] **Step 3: 替换 `TimeSlotModal` 的开始、结束时间控件**

保持结束时间依赖开始时间的校验函数不变，仅将两个时间字段接入 `HalfHourTimePicker`。

- [ ] **Step 4: 清理不再使用的 `TimePicker` 导入并检查已有 `Dayjs` 导入**

运行：`npm run build`
预期：构建成功且无未使用导入或类型错误。

### Task 4: 增加视觉样式并进行验证

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src\App.css`

- [ ] **Step 1: 增加组合时间列表样式**

为触发器、弹层、滚动列表、单项、选中项、分隔符和底部快捷操作增加局部类名样式；列表采用单列布局，单项高度足够支持截图所示的清晰纵向浏览。

- [ ] **Step 2: 增加窄窗口适配**

确保弹层宽度不超出视口，列表可以滚动，按钮和文字在现有桌面窗口宽度下不发生溢出。

- [ ] **Step 3: 运行构建验证**

运行：`npm run build`
预期：`tsc` 和 Vite 构建均成功。

- [ ] **Step 4: 手工验收新增流程**

运行：`npm run dev`，打开“今日事”→“新增时间段”，验证候选为半小时刻度；点击任意候选后立即关闭；点击“此刻”后立即关闭并回填；保存成功。

- [ ] **Step 5: 手工验收编辑与回归流程**

打开已有时间段编辑，验证开始/结束时间回填、当前项选中、结束时间校验、取消、保存、拆分和删除功能均正常。

- [ ] **Step 6: 提交实现变更**

```bash
git add src/pages/DailyList.tsx src/App.css
git commit -m "改造今日事时间段选择器"
```

## 自检结果

- 规格覆盖：目标、候选粒度、立即关闭、“此刻”、新增/编辑复用、表单校验、样式和构建验收均已拆分到任务中。
- 占位符检查：未使用 TBD、TODO 或“稍后实现”等未定义步骤。
- 类型一致性：选择器以 Ant Design 表单标准 `value/onChange` 接口接入，时间值统一为 `Dayjs | null`，与现有字段兼容。
- 范围检查：仅涉及今日事时间段选择器及其样式，属于单一子系统。
