# 兑换记录奖励图标展示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在奖励池的兑换记录中，为每条奖励名称前增加对应图标，并通过适度留白避免布局拥挤。

**Architecture:** 复用现有 `RewardExchange.reward_id` 与页面已加载的 `data.rewards`，在 `Rewards.tsx` 渲染兑换记录时完成图标匹配，不改后端接口和数据库。通过 `App.css` 为记录内容、图标和名称增加横向布局与间距样式，找不到匹配奖励时回退到 `🎁`。

**Tech Stack:** React、TypeScript、Ant Design、Lucide、CSS、Vite。

## Global Constraints

- 仅修改兑换记录的前端展示，不修改数据库结构、后端接口和兑换数据模型。
- 奖励图标优先使用奖励池中的 `icon` 字段；无匹配或图标为空时使用 `🎁`。
- 所有新增代码注释、文档和提交信息使用简体中文；本次无需新增注释。
- 不引入新的依赖。

---

### Task 1: 增加兑换记录图标与布局结构

**Files:**
- Modify: `E:\项目\LifePlanTodolist\src\pages\Rewards.tsx` 兑换记录列表渲染区域
- Modify: `E:\项目\LifePlanTodolist\src\App.css` 兑换记录样式区域

**Interfaces:**
- Consumes: `RewardExchange.reward_id`、`Reward.icon`、当前页面状态 `data.rewards`。
- Produces: 带有 `.exchange-row-content`、`.exchange-row-icon`、`.exchange-row-name` 类名的兑换记录展示结构。

- [ ] **Step 1: 修改兑换记录 JSX，按 `reward_id` 匹配图标**

将兑换记录列表中的单行渲染替换为以下结构，保留原有积分和时间文本：

```tsx
<div className="exchange-list">
  {data.exchanges.slice((exchangePage - 1) * 10, exchangePage * 10).map((item) => {
    const reward = data.rewards.find((candidate) => candidate.id === item.reward_id);
    const icon = reward?.icon || "🎁";
    return <div className="exchange-row" key={item.id}>
      <div className="exchange-row-content">
        <span className="exchange-row-icon" aria-hidden="true">{icon}</span>
        <span className="exchange-row-name">{item.reward_name}</span>
      </div>
      <span className="exchange-row-meta">-{item.points_used} 积分 · {new Date(item.exchanged_at).toLocaleString("zh-CN")}</span>
    </div>;
  })}
</div>
```

- [ ] **Step 2: 增加兑换记录的间距和图标样式**

在 `src/App.css` 现有兑换记录样式附近，将样式调整为：

```css
.exchange-row { display: flex; min-height: 56px; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 0; }
.exchange-row:first-child { padding-top: 0; }
.exchange-row:last-child { padding-bottom: 0; }
.exchange-row-content { display: flex; min-width: 0; align-items: center; gap: 10px; }
.exchange-row-icon { display: inline-flex; width: 28px; height: 28px; flex: 0 0 28px; align-items: center; justify-content: center; border-radius: 8px; background: #fff7e6; font-size: 18px; line-height: 1; }
.exchange-row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exchange-row-meta { flex: 0 0 auto; white-space: nowrap; }
```

在窄屏媒体查询中补充：

```css
@media (max-width: 620px) {
  .exchange-row { align-items: flex-start; flex-direction: column; gap: 6px; }
  .exchange-row-meta { padding-left: 38px; }
}
```

- [ ] **Step 3: 运行前端检查和构建**

Run: `npm run build`

Expected: Vite 构建成功且无 TypeScript 编译错误。

- [ ] **Step 4: 检查变更范围**

Run: `git diff -- E:\项目\LifePlanTodolist\src\pages\Rewards.tsx E:\项目\LifePlanTodolist\src\App.css`

Expected: 仅包含兑换记录图标、布局和响应式间距相关改动；不包含后端、数据库或奖励池卡片逻辑修改。

- [ ] **Step 5: 提交实现**

```bash
git add src/pages/Rewards.tsx src/App.css
git commit -m "功能：为兑换记录增加奖励图标"
```

Expected: 生成一个仅包含本功能前端改动的中文提交。

---

## 自审结果

- 规格覆盖：图标匹配、默认图标、图标与名称间距、记录行留白、窄屏适配和构建验证均已覆盖。
- 占位符检查：未使用 TBD、TODO 或未定义的实现占位描述。
- 类型一致性：使用现有 `RewardExchange.reward_id`、`Reward.icon` 和 `RewardExchange.reward_name` 字段，无新增接口。
