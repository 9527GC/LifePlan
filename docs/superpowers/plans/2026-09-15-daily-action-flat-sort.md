# 今日事安排行动平铺模式排序优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让今日事“安排行动”的平铺视图按开始日期优先、同日按 P1 到 P4 排列，无开始日期的行动置后，同时保持按事件视图不变。

**Architecture:** 将排序逻辑抽成 `src/lib/dailyActionSort.ts` 中的纯函数，使用带原始索引的稳定排序并返回新数组。`DailyList.tsx` 继续负责筛选和视图渲染：平铺视图使用排序结果，按事件视图使用原有筛选结果。

**Tech Stack:** React 19、TypeScript、Vite、Ant Design、现有 Tauri 前端工程。

## Global Constraints

- 仅修改今日事安排行动弹窗的平铺视图排序，不修改 API、数据库字段或按事件视图的 `sort_order` 语义。
- 开始日期存在的行动排在无开始日期行动之前；日期升序；同日期按 `priority` 升序；完全相同时保持原始顺序。
- 所有新增代码注释、文档和提交信息使用简体中文。
- 排序函数不得原地修改传入数组。

---

### Task 1: 新增稳定的行动排序纯函数

**Files:**
- Create: `E:\项目\LifePlanTodolist\src\lib\dailyActionSort.ts`
- Modify: `E:\项目\LifePlanTodolist\src\types\index.ts`（无需修改，仅确认复用 `Action` 类型）

**Interfaces:**
- Produces: `sortDailyActions(actions: Action[]): Action[]`

- [ ] **Step 1: 创建排序函数**

在 `src/lib/dailyActionSort.ts` 中实现：

```ts
import type { Action } from "@/types";

export function sortDailyActions(actions: Action[]): Action[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const leftHasStartDate = Boolean(left.action.start_date);
      const rightHasStartDate = Boolean(right.action.start_date);
      if (leftHasStartDate !== rightHasStartDate) return leftHasStartDate ? -1 : 1;

      if (leftHasStartDate && rightHasStartDate) {
        const dateCompare = left.action.start_date!.localeCompare(right.action.start_date!);
        if (dateCompare !== 0) return dateCompare;
      }

      if (left.action.priority !== right.action.priority) {
        return left.action.priority - right.action.priority;
      }

      return left.index - right.index;
    })
    .map(({ action }) => action);
}
```

- [ ] **Step 2: 添加可执行的排序检查脚本**

由于当前 `package.json` 没有测试运行器，新增 `scripts/check-daily-action-sort.mjs`，使用 Node 内置断言验证编译后的排序逻辑所需的规则，或在实现时选择项目已有的可执行测试方式；不得为单个纯函数引入完整测试框架。检查至少覆盖：有/无开始日期、日期升序、同日优先级、相同字段保持原顺序、空数组和输入数组不被修改。

- [ ] **Step 3: 运行类型检查确认纯函数接口正确**

运行：

```powershell
npm run build
```

预期：TypeScript 检查和 Vite 构建成功。

- [ ] **Step 4: 提交纯函数和检查脚本**

```powershell
git add src/lib/dailyActionSort.ts scripts/check-daily-action-sort.mjs
git commit -m "新增今日事行动稳定排序函数"
```

### Task 2: 将排序接入平铺视图

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src\pages\DailyList.tsx`

**Interfaces:**
- Consumes: `sortDailyActions(actions: Action[]): Action[]` from `@/lib/dailyActionSort`
- Produces: 平铺视图使用排序后的 `visibleActions`，事件视图继续使用未排序的筛选结果。

- [ ] **Step 1: 引入排序函数并派生平铺数据**

在 `DailyList.tsx` 引入 `sortDailyActions`，保留现有 `visibleActions` 的搜索筛选逻辑，新增：

```ts
const flatVisibleActions = useMemo(() => sortDailyActions(visibleActions), [visibleActions]);
```

不要对 `visibleActions` 直接调用 `.sort()`，以免改变事件视图共享的数组顺序。

- [ ] **Step 2: 仅替换平铺视图渲染数据源**

将平铺分支中的：

```tsx
visibleActions.map((action, index) => ...)
```

替换为：

```tsx
flatVisibleActions.map((action, index) => ...)
```

保持按钮的 `key`、选中判断、`scheduledToday` 判断、分配回调和禁用状态不变。事件视图继续传入 `visibleActions`。

- [ ] **Step 3: 运行构建并检查差异**

运行：

```powershell
npm run build
git diff --check
git status --short
```

预期：构建成功、无空白错误；差异只涉及排序函数、检查脚本和 `DailyList.tsx`。

- [ ] **Step 4: 提交视图接入改动**

```powershell
git add src/pages/DailyList.tsx
git commit -m "优化今日事平铺行动排序"
```

### Task 3: 手工验证两种视图互不影响

**Files:**
- No new files.

- [ ] **Step 1: 启动桌面客户端**

运行：

```powershell
npm run tauri dev
```

预期：Vite 和 Tauri 调试客户端均成功启动。

- [ ] **Step 2: 验证平铺视图排序**

在“今日事”页面打开“安排行动”，切换到平铺视图，确认：有开始日期的行动在前；日期较早者在前；同日期按 P1、P2、P3、P4；无开始日期的行动在最后。输入搜索关键词后，剩余结果仍遵循同一排序规则。

- [ ] **Step 3: 验证按事件视图不变**

切换到按事件视图，确认事件分组和组内 `sort_order` 顺序未被平铺排序改变；行动分配和“当日已安排”标记仍正常。

- [ ] **Step 4: 汇总最终状态**

运行：

```powershell
git log -3 --oneline
git status --short
```

预期：工作区干净，包含设计提交和实现提交。
