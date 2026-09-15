# 事件篮空标题新增提示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让事件篮在事件标题为空时保持新增按钮禁用视觉，并在点击按钮区域时显示白底提示“请先输入事件名称”。

**Architecture:** 保留 Ant Design Button 的 `disabled` 属性，通过按钮外层容器捕获禁用状态下的点击；可用状态仍由表单提交触发既有创建流程。使用现有 `message` API，并为该提示增加专用 class 以覆盖 toast 内容样式。

**Tech Stack:** React 19、TypeScript、Ant Design 6、Vite、CSS。

## Global Constraints

- 所有新增代码注释、文档和提交信息使用简体中文。
- 不改变有效标题的现有创建流程。
- 空标题或仅空格时不得调用 `eventsApi.create`。
- Toast 文案必须为“请先输入事件名称”，背景为白色。

---

### Task 1: 调整事件篮快速新增交互

**Files:**
- Modify: `src/pages/Inbox.tsx:59-61`

**Interfaces:**
- Consumes: 现有 `newTitle` 状态、`addEvent` 函数和 Ant Design `message` API。
- Produces: 空标题时可点击提示、有效标题时保持原有提交行为的快速新增控件。

- [ ] **Step 1: 修改快速新增控件结构**

将快速新增区域调整为在禁用按钮外包裹可点击容器；容器只在标题为空时提示，按钮仍保留 `disabled={!newTitle.trim()}`，表单提交仍调用 `addEvent`：

```tsx
<Form className="quick-add" onFinish={() => void addEvent()}>
  <Input
    value={newTitle}
    onChange={(event) => setNewTitle(event.target.value)}
    placeholder="记录一个新事件…"
    addonAfter={(
      <span
        className="quick-add-button-wrapper"
        onClick={() => {
          if (!newTitle.trim()) {
            message.info({ content: "请先输入事件名称", className: "quick-add-empty-toast" });
          }
        }}
        role="presentation"
      >
        <Button
          type="primary"
          htmlType="submit"
          disabled={!newTitle.trim()}
          icon={<Plus size={15} />}
        >
          新增事件
        </Button>
      </span>
    )}
  />
</Form>
```

按钮可用时，外层点击处理不执行任何操作，事件继续由表单提交处理；按钮禁用时，外层显示提示且不会触发提交。

- [ ] **Step 2: 运行类型检查和构建**

Run: `npm run build`

Expected: TypeScript 检查和 Vite 构建均成功，输出 `dist` 构建产物且无错误。

- [ ] **Step 3: 检查代码差异**

Run: `git diff --check; git diff -- src/pages/Inbox.tsx`

Expected: 无空白错误；差异仅涉及快速新增按钮外层点击提示和相关 class。

- [ ] **Step 4: Commit**

```bash
git add src/pages/Inbox.tsx
git commit -m "实现事件篮空标题新增提示"
```

---

### Task 2: 增加白底 toast 样式

**Files:**
- Modify: `src/App.css:127-133`

**Interfaces:**
- Consumes: Task 1 传入的 `quick-add-empty-toast` class。
- Produces: 白色背景、深色文字、可辨识阴影的 toast 视觉样式。

- [ ] **Step 1: 增加 toast 样式**

在快速新增相关样式附近增加：

```css
.quick-add-empty-toast .ant-message-notice-content {
  color: #303133;
  background: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .12);
}
```

- [ ] **Step 2: 运行构建验证样式引用**

Run: `npm run build`

Expected: 构建成功，CSS 被正常打包。

- [ ] **Step 3: 检查差异并提交**

Run: `git diff --check; git diff -- src/App.css`

Expected: 无空白错误，新增样式只作用于空标题提示。

```bash
git add src/App.css
git commit -m "设置事件篮空标题提示白底样式"
```

---

## 验证清单

- [ ] 清空标题后按钮保持禁用视觉。
- [ ] 点击按钮区域出现“请先输入事件名称”。
- [ ] 输入仅空格后仍出现相同提示。
- [ ] 输入有效标题后可以正常创建事件。
- [ ] 空标题状态不会调用创建接口。
- [ ] Toast 背景为白色且文字为深色。
