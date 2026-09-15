# 工作日志 AI 配置重置确认实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 为工作日志 AI 配置的重置操作增加确认弹窗，确认后重置除 API Key 以外的全部配置。

**架构：** 复用 `WorkLogModal.tsx` 已引入的 Ant Design `Modal`，通过 `Modal.confirm` 拦截现有重置入口。实际重置逻辑保持不变，仅将调用从按钮点击事件移动到确认回调中。

**技术栈：** React、TypeScript、Ant Design、Vite。

## 全局约束

- 确认弹窗必须使用项目现有 Ant Design 样式。
- API Key 必须保留，接口地址、模型、日志模板、日志生成要求恢复默认值。
- 不新增依赖，不修改无关功能。
- 代码注释、文档和提交信息使用中文。

---

### 任务 1：为重置入口增加确认弹窗

**文件：**
- 修改：`src/components/ui/WorkLogModal.tsx` 中的 `resetAiDefaults` 及 AI 配置弹窗 footer 重置按钮。

**接口：**
- 消费：现有 `resetAiDefaults` 重置逻辑及 `Modal`。
- 产出：用户确认后才执行重置，取消时不改变输入值。

- [ ] **步骤 1：修改重置处理逻辑**

将现有 `resetAiDefaults` 改为仅负责实际重置，并新增确认处理函数：

```tsx
const resetAiDefaults = () => {
  setApiUrl(DEFAULT_API_URL);
  setModel(DEFAULT_MODEL);
  setLogTemplate(DEFAULT_LOG_TEMPLATE);
  setLogRequirements(DEFAULT_LOG_REQUIREMENTS);
  localStorage.setItem(API_URL_STORAGE, DEFAULT_API_URL);
  localStorage.setItem(MODEL_STORAGE, DEFAULT_MODEL);
  localStorage.setItem(LOG_TEMPLATE_STORAGE, DEFAULT_LOG_TEMPLATE);
  localStorage.setItem(LOG_REQUIREMENTS_STORAGE, DEFAULT_LOG_REQUIREMENTS);
  message.success("已恢复默认配置，API Key 未被清除");
};

const confirmResetAiDefaults = () => {
  Modal.confirm({
    title: "确认重置 AI 配置",
    content: "将重置除 API Key 以外的全部配置，确定要继续吗？",
    okText: "确认重置",
    cancelText: "取消",
    onOk: resetAiDefaults,
  });
};
```

将按钮绑定改为：

```tsx
<Button type="link" onClick={confirmResetAiDefaults}>
  恢复默认配置（不清除 API Key）
</Button>
```

- [ ] **步骤 2：运行类型检查和构建**

运行：`npm run build`

预期：命令成功退出，TypeScript 与 Vite 构建通过。

- [ ] **步骤 3：检查变更范围**

运行：`git diff -- src/components/ui/WorkLogModal.tsx`

预期：只包含确认弹窗及其调用关系的修改，不改变 API Key 和其他配置的重置内容。

- [ ] **步骤 4：提交实现**

```bash
git add src/components/ui/WorkLogModal.tsx
git commit -m "feat: 为 AI 配置重置增加确认提示"
```
