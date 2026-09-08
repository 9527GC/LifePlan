# 事件篮头部间距 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一事件篮页面标题与副标题的垂直间距。

**Architecture:** 仅调整 `Inbox.tsx` 头部 JSX 层级，让标题和副标题共享左侧容器；复用现有 CSS，不修改业务逻辑。

**Tech Stack:** React、TypeScript、Ant Design、现有 CSS。

## Global Constraints

- 代码注释、文档、提交信息使用简体中文。
- 不改变新增事件及响应式布局功能。

### Task 1: 调整事件篮页面头部结构

**Files:**
- Modify: `src/pages/Inbox.tsx`

- [ ] 将标题和副标题包裹到同一个左侧 `div` 中。
- [ ] 保持新增事件表单为右侧同级元素。
- [ ] 运行构建检查 TypeScript 和 JSX。
- [ ] 检查 git diff，确认只涉及头部结构。
