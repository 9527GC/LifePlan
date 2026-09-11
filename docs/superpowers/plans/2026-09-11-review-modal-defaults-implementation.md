# 复盘弹框默认值 Implementation Plan

> **For agentic workers:** 直接在当前工作区按任务执行并完成验证。

**Goal:** 为新建复盘弹框增加默认复盘内容、达到预期和专注状态，同时保留已有复盘内容。

**Architecture:** 在 `DailySlotModal` 的表单初始化处集中计算默认值。通过判断当前时间段是否已有完整复盘字段，区分新建与编辑；不改动后端模型和保存接口。

**Tech Stack:** React 19、TypeScript、Ant Design 6、Vite。

## Global Constraints

- 所有代码注释、文档和提交信息使用中文。
- 默认值仅用于新建复盘，编辑已有复盘必须保留原值。
- 不新增依赖，不修改数据库或 API。

---

### Task 1: 增加复盘弹框默认值

**Files:**
- Modify: `src/pages/DailyList.tsx:264-270`

**Interfaces:**
- Consumes: `DailyScheduleSlot.action.project_title`、`DailyScheduleSlot.action.title`、现有复盘字段。
- Produces: `DailySlotModal` 表单初始化值。

- [ ] **Step 1: 修改表单初始化逻辑**

在 `DailySlotModal` 的 `useEffect` 中：

```tsx
useEffect(() => {
  if (!slot) return;
  setCompleteAfterReview(false);
  const isNewReview = slot.actual_notes === undefined
    && slot.met_expectation === undefined
    && slot.focused === undefined;
  form.setFieldsValue({
    actual_notes: isNewReview ? (slot.action ? `${slot.action.project_title ? `${slot.action.project_title}-` : ""}${slot.action.title}` : "") : slot.actual_notes,
    met_expectation: isNewReview ? 1 : slot.met_expectation,
    focused: isNewReview ? 1 : slot.focused,
  });
}, [slot, form]);
```

- [ ] **Step 2: 运行构建验证**

运行：`npm run build`

预期：TypeScript 检查和 Vite 构建均成功完成。

- [ ] **Step 3: 检查变更**

运行：`git diff --check`

预期：无空白错误或冲突标记。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-09-11-review-modal-defaults-design.md docs/superpowers/plans/2026-09-11-review-modal-defaults-implementation.md src/pages/DailyList.tsx
git commit -m "优化复盘弹框默认值"
```
