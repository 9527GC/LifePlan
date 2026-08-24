# 事件篮项目 Tab 合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目入口合并到事件篮，在事件篮使用平铺 Tab 管理事件状态，并在“已转项目”Tab 展示完整的项目卡片和行动管理能力。

**Architecture:** 把当前 `Projects.tsx` 中的项目卡片、项目弹窗和行动管理组件提取到 `src/components/projects/`，由事件篮容器统一加载事件、项目和行动数据并管理 Tab 和弹窗状态。`/projects` 保留为重定向兼容入口，Rust/Tauri API 和数据库语义不变。

**Tech Stack:** React 19, TypeScript, React Router, Ant Design 6, lucide-react, Tauri 2 invoke API, plain CSS.

## Global Constraints

- 左侧导航只保留“事件篮”和“行动”。
- 事件篮 Tab 顺序为：`待处理`、`已转项目`、`已委托`、`延迟`、`已放弃`、`已完成`。
- “待处理”只匹配 `Event.status === 0`，不包含延迟事件。
- “已转项目”直接显示项目卡片，不提供项目状态二级筛选；已放弃事项在事件篮“已放弃”Tab 展示。
- 项目卡片默认收起并可展开查看；行动只能从项目入口创建。
- 所有现有 Tauri 命令、数据字段、删除级联语义和日期 `YYYY-MM-DD` 格式保持不变。
- 事件、项目和行动 API 失败使用现有页面级 `Alert`；mutation 成功后刷新相关列表并关闭成功完成的弹窗。
- 保持现有 Ant Design 主题、蓝色主色、32px 控件高度和响应式布局。
- 不修改 Rust 业务代码；仓库没有 `.git`，因此不执行 commit。

---

### Task 1: 提取可复用项目组件

**Files:**
- Create: `src/components/projects/ProjectCard.tsx`
- Create: `src/components/projects/ProjectActionList.tsx`
- Create: `src/components/projects/ProjectActionModal.tsx`
- Create: `src/components/projects/ProjectModal.tsx`
- Create: `src/components/projects/AbandonModal.tsx`
- Create: `src/components/projects/index.ts`
- Modify: `src/pages/Projects.tsx`

**Interfaces:**
- Consumes: `Project`, `Action`, `UpdateProject`, `UpdateAction`, `projectsApi`, `actionsApi`.
- Produces: 可由事件篮直接使用的项目组件；组件通过 props 接收实体和回调，不读取事件篮 Tab 状态。

- [ ] **Step 1: 从现有 `Projects.tsx` 识别并复制项目相关实现**

提取现有 `ProjectHeader`、`ProjectExtra`、项目卡片主体、`ProjectActionList`、`ProjectActionModal`、`ProjectModal`、`AbandonModal`，保留字段名、表单默认值、确认提示、状态判断和 API payload。

- [ ] **Step 2: 为每个组件定义显式 props**

组件接口至少保持以下形状：

```ts
type ProjectCardProps = {
  project: Project;
  actions: Action[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onAbandon: () => void;
  onDelete: () => void;
  onAddAction: () => void;
  onEditAction: (action: Action) => void;
  onDeleteAction: (action: Action) => void;
};
```

弹窗组件使用 `project: Project | null` 或 `project: Project | null` 加 `action: Action | null | undefined` 区分关闭、新建和编辑状态，并通过 `onSaved: () => Promise<void>` 将刷新责任交给页面容器。

- [ ] **Step 3: 让 `Projects.tsx` 改为使用提取组件**

保持 `/projects` 兼容入口行为，改为从 `src/components/projects` 导入组件。页面仍加载 projects/actions、维护展开状态，并把 API 操作回调传入组件。

- [ ] **Step 4: 运行构建检查提取没有改变行为契约**

Run: `npm run build`

Expected: PASS，且 TypeScript 不报告 props、表单值或 import 错误。

### Task 2: 建立事件篮 Tab 数据模型

**Files:**
- Modify: `src/pages/Inbox.tsx`
- Modify: `src/types/index.ts` only if a shared tab type is needed

**Interfaces:**
- Consumes: `eventsApi.list()`, `projectsApi.list()`, `actionsApi.list()`, extracted project components.
- Produces: 主 Tab 状态、事件 Tab 过滤结果、项目 Tab 过滤结果及 Tab 数量。

- [ ] **Step 1: 将事件过滤状态改为主 Tab状态**

使用明确的 union type：

```ts
type InboxTab = "pending" | "projects" | "delegated" | "delayed" | "abandoned" | "completed";
```

初始值为 `pending`。过滤逻辑必须是：`pending -> status === 0`、`delegated -> status === 2`、`delayed -> status === 3`、`abandoned -> status === 4`、`completed -> status === 5`；`projects` 不从事件列表派生内容。

- [ ] **Step 2: 增加项目和行动状态**

在 Inbox 中增加 `projects`, `actions`, `projectsLoaded`, `projectsLoading` 和 `expanded` 状态。`expanded` 使用 `Set<number>` 或等价的数字 ID 集合，初始为空。

- [ ] **Step 3: 实现按需加载且只加载一次的项目数据**

保留首次事件加载。切换到 `projects` Tab 时，如果 `projectsLoaded` 为 false，则执行：

```ts
const [projectList, actionList] = await Promise.all([
  projectsApi.list(),
  actionsApi.list(),
]);
setProjects(projectList);
setActions(actionList);
setProjectsLoaded(true);
```

项目加载失败时设置页面错误并允许下一次切换重试；不清空已经存在的事件数据。

- [ ] **Step 4: 派生过滤结果和数量**

事件 Tab 数量按各自 status 计算；项目 Tab 数量显示项目数量。项目按当前产品定义展示，行动按 `project_id` 分组。

- [ ] **Step 5: 运行构建检查数据模型**

Run: `npm run build`

Expected: PASS；不得出现 `filter` 与主 Tab 类型不匹配或 `Project`/`Action` 可选字段处理错误。

### Task 3: 重构事件篮页面展示和项目操作

**Files:**
- Modify: `src/pages/Inbox.tsx`

**Interfaces:**
- Consumes: Task 1 的项目组件和 Task 2 的状态/派生数据。
- Produces: 平铺 Tab、事件内容区、项目卡片内容区和完整 mutation 刷新闭环。

- [ ] **Step 1: 用 Ant Design Tabs 替换事件筛选 Select**

Tab items 的 key 和 label 必须对应：

```ts
[
  { key: "pending", label: `待处理 ${count}` },
  { key: "projects", label: `已转项目 ${count}` },
  { key: "delegated", label: `已委托 ${count}` },
  { key: "delayed", label: `延迟 ${count}` },
  { key: "abandoned", label: `已放弃 ${count}` },
  { key: "completed", label: `已完成 ${count}` },
]
```

Tab 内容区域只渲染当前 Tab，事件内容继续使用 `EventRow`；移除旧的 `statusOptions` 和下拉筛选控件。

- [ ] **Step 2: 在“已转项目”Tab 渲染项目卡片**

遍历项目卡片，传入对应的 actions、expanded 状态和项目/行动操作回调。无项目时显示项目空状态，加载时显示加载状态；放弃事项由事件篮“已放弃”Tab 承载。

- [ ] **Step 3: 将项目 mutation 接入 Inbox 容器**

实现以下容器回调，并在成功后刷新项目与行动数据：

```ts
const refreshProjects = async () => {
  const [projectList, actionList] = await Promise.all([
    projectsApi.list(),
    actionsApi.list(),
  ]);
  setProjects(projectList);
  setActions(actionList);
  setProjectsLoaded(true);
};
```

项目编辑、完成、放弃、删除，行动新增、编辑、删除都复用现有 API 和成功提示。删除和放弃的确认由提取组件负责，API 错误回传到 Inbox 的页面级错误状态。

- [ ] **Step 4: 保持事件 mutation 的现有行为并修正 Tab 过滤**

新增、编辑、处理、完成、恢复、删除事件后继续调用 `load()`。事件处理成功后根据决策切换到目标 Tab：`self -> projects`、`delegate -> delegated`、`delay -> delayed`、`abandon -> abandoned`；普通新增和编辑不强制切换。

- [ ] **Step 5: 运行构建并检查页面状态闭环**

Run: `npm run build`

Expected: PASS；项目卡片展开、弹窗关闭、列表刷新和错误状态均有明确 props/回调连接。

### Task 4: 收敛导航与路由

**Files:**
- Modify: `src/components/layout/Layout.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: 现有 React Router 路由和导航配置。
- Produces: 只有事件篮、行动两个可见入口，旧项目地址重定向到事件篮。

- [ ] **Step 1: 从侧边栏移除项目导航项**

删除 `FolderKanban` import 和 `/projects` nav item，保留事件篮与行动，并保持当前选中项逻辑。

- [ ] **Step 2: 把 `/projects` 路由改为兼容重定向**

将 `Route path="projects" element={<Projects />}` 替换为 `Route path="projects" element={<Navigate to="/inbox" replace />}`；移除不再需要的 `Projects` import。根路由仍重定向到 `/inbox`。

- [ ] **Step 3: 验证路由构建**

Run: `npm run build`

Expected: PASS；项目导航不再出现在布局中，旧项目路径仍有合法目标。

### Task 5: 调整 Tab 和窄屏样式

**Files:**
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 3 的 className 或 Ant Design Tabs DOM。
- Produces: 平铺可扫描的事件 Tab、可横向滚动的窄屏布局和无重叠项目卡片。

- [ ] **Step 1: 添加事件 Tab 的平铺样式**

为主 Tabs 设置宽度、底部边框、选中指示线和 Tab 间距；不要把 Tabs 放进 Card。Tab label 和数量应保持一行，窄屏时允许横向滚动。

- [ ] **Step 2: 检查响应式布局**

在 `max-width: 820px` 和 `max-width: 620px` 下确保 Tab 不换行重叠、项目卡片操作区可换行、项目行动列表和按钮不超出内容宽度；保留现有事件卡片窄屏纵向排列。

- [ ] **Step 4: 运行构建**

Run: `npm run build`

Expected: PASS。

### Task 6: 全量验证与回归检查

**Files:**
- Test: `npm run build`
- Test: `cargo check --manifest-path src-tauri/Cargo.toml`
- Test: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

- [ ] **Step 1: 执行前端构建**

Run: `npm run build`

Expected: PASS，生成前端构建产物，无 TypeScript 或 Vite 错误。

- [ ] **Step 2: 执行 Rust 编译和格式检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Expected: PASS，确认 Rust 层未被本次前端改动破坏。

- [ ] **Step 3: 手动验收核心流程**

在桌面客户端验证：待处理不含延迟事件；各 Tab 数量与内容匹配；切换到已转项目时项目只加载一次；项目卡片默认收起且可展开；项目和行动的增删改、完成、放弃、删除反馈正常；放弃事项可在“已放弃”Tab 查看；访问 `/projects` 重定向到 `/inbox`；窄窗口下 Tab 和项目操作无重叠。

- [ ] **Step 4: 检查工作区变更范围**

Run: `git status --short`

Expected: 当前环境没有 `.git`，命令可能提示不是 Git 仓库；不得为了提交而初始化或重置仓库，也不得修改与本需求无关的文件。
