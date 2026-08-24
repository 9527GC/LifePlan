# 项目行动列表拖动排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让项目行动列表的拖动排序在 Tauri WebView 中有明确、稳定的拖动入口和插入位置反馈。

**Architecture:** 保留现有 HTML5 drag/drop 和 Rust `reorder_project_actions` 接口。React 组件额外维护拖动方向和插入目标，拖动经过每行时按上下半区计算插入位置；CSS 将方向呈现为目标行上方或下方的高亮线与位置文案。

**Tech Stack:** React 19, TypeScript, Ant Design, Vite, Tauri 2, CSS。

## Global Constraints

- 继续使用现有后端排序接口和 `sort_order` 字段，不修改数据库及 Rust 命令。
- 只允许进行中的项目且至少有两个行动参与排序。
- 保存失败时恢复拖动前顺序并显示错误。

### Task 1: 更新行动列表拖动状态与位置计算

**Files:**
- Modify: `src/pages/Projects.tsx` 中的 `ProjectActionList`

**Interfaces:**
- Consumes: 现有 `onReorder(actionIds: number[]) => Promise<void>`。
- Produces: `dragOverId`, `dropPosition` 和 `dropLabel` 驱动的拖动反馈；保存成功时传递移动后的相对位置文案。

- [ ] **Step 1: 增加拖动位置类型和状态**

在 `ProjectActionList` 内增加 `DropPosition = "before" | "after"`，并维护 `dropPosition`；保留 `dragOverId` 作为目标行动 id。

- [ ] **Step 2: 在 dragOver 中按目标行上下半区计算位置**

调用 `getBoundingClientRect()`，比较 `event.clientY` 与行中线，保存目标 id 与 `before/after`，并持续 `preventDefault()`。

- [ ] **Step 3: 在 drop 中按已计算的位置插入行动**

从旧数组移除源行动，重新查找目标行动，按 `dropPosition` 插入；源行动或目标行动无效时清理状态并返回。

- [ ] **Step 4: 让拖动反馈和保存状态互相独立**

拖动结束、离开列表和取消 drop 时统一清除反馈；drop 后先更新本地数组，再调用现有接口；成功提示“已移动到某行动之前/之后”，失败恢复旧数组。

### Task 2: 增加可理解的拖动视觉反馈

**Files:**
- Modify: `src/App.css` 中行动列表拖动样式
- Modify: `src/pages/Projects.tsx` 中行动列表标题和 `List.Item` className

**Interfaces:**
- Consumes: Task 1 的 `draggingId`, `dragOverId`, `dropPosition`, `saving`。
- Produces: 拖动中的半透明行、上方/下方插入线、列表标题状态和可识别的拖动抓手。

- [ ] **Step 1: 为列表标题增加拖动状态文案**

拖动时显示“正在调整顺序”，空闲时显示“可拖动调整”；保存时显示“正在保存”。

- [ ] **Step 2: 为目标行生成方向 class**

目标行使用 `is-drag-over-before` 或 `is-drag-over-after`，源行动使用 `is-dragging`。

- [ ] **Step 3: 添加插入线与位置提示样式**

插入线使用项目蓝色，定位在目标行顶部或底部；位置文案固定在行内容区域内，不改变列表布局高度。

### Task 3: 构建验证与运行验证

**Files:**
- Verify: `src/pages/Projects.tsx`
- Verify: `src/App.css`

- [ ] **Step 1: 执行生产构建**

运行 `npm run build`，预期 TypeScript 检查和 Vite 构建均成功。

- [ ] **Step 2: 启动测试环境**

运行 `npm run dev -- --host 127.0.0.1`，确认 `http://127.0.0.1:1420/` 返回 HTTP 200。

- [ ] **Step 3: 启动 Tauri 客户端并检查窗口**

运行 `npm run tauri -- dev` 或启动现有 debug 可执行文件，确认客户端窗口存在且能进入项目详情。

- [ ] **Step 4: 手工验证五种路径**

验证向上移动、向下移动、移到首项、移到末项、取消拖动；刷新后顺序保持，保存失败时本地顺序回滚。
