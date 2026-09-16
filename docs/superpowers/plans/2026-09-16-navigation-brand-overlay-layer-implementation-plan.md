# 导航品牌区与遮罩层级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左上角 Logo 和更新图标以相同层级显示在导航之上，并在所有带遮罩的界面打开时被遮罩覆盖。

**Architecture:** 复用现有 `.brand` 容器作为品牌区的唯一层级边界，更新图标继续作为其子元素继承该层级。将顶部自定义标题栏降到品牌区之下，同时将品牌区控制在 Ant Design 默认遮罩层级及新手引导层级之下；不对各个 Modal、Drawer 或确认弹层逐一添加覆盖规则。

**Tech Stack:** React 19、TypeScript、Ant Design 6、CSS、Vite。

## Global Constraints

- Logo 与更新图标必须共享同一个品牌区层级，不能为更新按钮单独设置 `z-index`。
- 品牌区必须高于左侧导航菜单和自定义顶部标题栏。
- 所有 Ant Design Modal、Drawer、确认类弹层的默认遮罩必须覆盖品牌区。
- 新手引导 `.onboarding-overlay` 必须覆盖品牌区。
- 不修改更新检查、更新安装、导航跳转或弹层交互逻辑。
- 不触碰工作区中与本需求无关的未提交文件。

---

## 文件结构

- 修改：`src/App.css` — 定义自定义顶部标题栏、左侧导航菜单和品牌区的明确堆叠顺序。
- 不修改：`src/components/layout/Layout.tsx` — 现有 `.brand` 已是 Logo 与 `.brand-update-button` 的共同父容器，足以保证两者同层级。
- 不修改：`src/components/ui/OnboardingCarousel.tsx` — 现有 `.onboarding-overlay { z-index: 2000; }` 高于本计划的品牌区层级，无需重复设置。

### Task 1: 建立导航品牌区的显式层级

**Files:**
- Modify: `src/App.css:2,17-20`
- Test: `npm run build`（项目未配置单元测试框架；本任务通过生产构建和桌面端手动层级验证覆盖）

**Interfaces:**
- Consumes: `Layout.tsx` 中的 `.custom-titlebar`、`.brand`、`.brand-update-button` 和侧栏 `Menu`。
- Produces: `.custom-titlebar` 层级为 `10`，`.brand` 层级为 `20`，导航菜单层级为 `1`；`.brand-update-button` 不设置独立 `z-index`。

- [ ] **Step 1: 写入会失败的层级断言脚本并运行，确认当前样式不满足目标**

在 PowerShell 执行以下命令；当前 `.custom-titlebar` 为 `z-index: 1000` 且 `.brand` 为 `z-index: 1200`，因此命令应退出为 `1`：

```powershell
$css = Get-Content -LiteralPath '.\src\App.css' -Raw
if ($css -match '\.custom-titlebar \{ position: fixed; z-index: 10;' -and $css -match '\.brand \{ position: relative; z-index: 20;' -and $css -notmatch '\.brand-update-button \{[^}]*z-index') {
  Write-Output '层级约束已满足'
  exit 0
}
Write-Error '层级约束未满足'
exit 1
```

Expected: FAIL，输出 `层级约束未满足`。

- [ ] **Step 2: 最小化修改 `src/App.css` 中的三个层级规则**

将文件开头的标题栏规则和侧栏规则更新为以下内容；不要给 `.brand-update-button` 添加 `position` 或 `z-index`：

```css
.custom-titlebar { position: fixed; z-index: 10; top: 0; right: 0; left: 0; display: flex; height: 32px; align-items: stretch; justify-content: flex-end; background: #fff; }

.sidebar > .ant-layout-sider-children > .brand,
.sidebar > .ant-layout-sider-children > .ant-menu { transform: translateY(-24px); }
.brand { position: relative; z-index: 20; }
.sidebar > .ant-layout-sider-children > .ant-menu { position: relative; z-index: 1; }
```

保留 `.onboarding-overlay { position: fixed; z-index: 2000; ... }` 不变。Ant Design 默认 Modal、Drawer、确认类弹层的遮罩层级高于 `20`，因而无需在业务组件中逐一设置 `zIndex`。

- [ ] **Step 3: 重跑层级断言脚本，确认 CSS 约束通过**

再次执行 Step 1 的 PowerShell 命令。

Expected: PASS，输出 `层级约束已满足`，进程退出码为 `0`。

- [ ] **Step 4: 运行生产构建，验证 TypeScript 和样式打包正常**

Run:

```powershell
npm run build
```

Expected: PASS，命令以退出码 `0` 结束，并生成或更新 `dist` 构建产物。

- [ ] **Step 5: 在桌面端进行遮罩层级回归验证**

Run:

```powershell
npm run tauri dev
```

按以下顺序手动验证：

1. 常规页面中，Logo 和更新图标位于左侧菜单与顶部标题栏之上，且二者可点击。
2. 打开任意页面的新增/编辑 Modal：遮罩覆盖 Logo 和更新图标，二者不可点击。
3. 打开任意 Drawer（若当前页面提供）：遮罩覆盖 Logo 和更新图标，二者不可点击。
4. 触发确认类弹层（例如 Popconfirm）：其遮罩或所属弹层不会被 Logo 或更新图标遮挡。
5. 点击顶部标题栏的“了解 LifePlan”打开新手引导：引导遮罩覆盖 Logo 和更新图标，二者不可点击。
6. 关闭每个弹层后，Logo 和更新图标恢复显示与交互。

Expected: 六项均满足；没有导航布局偏移、更新按钮状态异常或弹层无法关闭的问题。

- [ ] **Step 6: 提交仅包含本任务的样式改动**

```powershell
git add -- 'src/App.css'
git commit -m 'fix: 调整导航品牌区与遮罩层级'
```

Expected: 创建一个仅包含 `src/App.css` 的提交，不包含既有的未提交改动。
