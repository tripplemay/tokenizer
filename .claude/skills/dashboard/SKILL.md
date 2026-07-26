---
name: dashboard
description: 渲染/刷新项目研发进度看板 Artifact——从 progress.json + features.json + backlog.json 渲染自包含 HTML，发布到 progress.json.dashboard_url 指向的同一 Artifact URL。在阶段边界或用户说"刷新看板"时使用。
---

<!-- 项目进度看板机制。渲染模板在 framework/templates/dashboard.template.html；progress.json 用 dashboard_url 字段。 -->

# /dashboard — 项目进度看板（Artifact 快照）

**关键约束：** Artifact 严格 CSP **禁 fetch**——看板读不了磁盘上的 JSON。所以它是**快照**：数据在发布时嵌入 HTML，
靠本 skill **重渲染 + 重发到同一 URL** 更新。阶段边界本就是有意义的更新点，契合。

## 何时刷新
- 每个**阶段边界**（harness-rules §四 更新 progress.json 那一步顺手刷）
- 用户说"刷新看板" / `/dashboard`
- `done` 阶段（定格最终态）

## 步骤
1. **读状态**（唯一数据源，无外部依赖）：
   - `progress.json` — status / current_sprint / fix_rounds / completed_features / total_features / docs.signoff / session_notes / evaluator_feedback / `dashboard_url`
   - `features.json` — 每条 id / title / executor / status / acceptance / verdict
   - `backlog.json` — 需求池条目
2. **渲染**：套 `framework/templates/dashboard.template.html`（CSS 已内联，自包含）逐 token 填充：
   - 顶栏：项目名、批次 id+title、车道、CI 状态、签收状态、当前阶段徽章（+ fix_round + 阶段角色）
   - 状态机流水线：7 状态按当前 status 标 `done` / `cur` / `next`
   - 指标瓦片：completed/total 环形（`--pct`）、fix_rounds、CI、签收
   - 功能看板：每 feature 一卡，左色条按 verdict —— PASS→`ok` / FAIL→`bad` / PARTIAL→`warn` / pending→`idle`
   - 右栏：evaluator_feedback 最新结论（含 steps_to_reproduce）+ backlog + 最新 session_note
   - 脚注：`git rev-parse --short HEAD` + 快照日期 + 数据源
3. **落 HTML** 到工作文件（scratchpad 或 `docs/`），**不 fetch、不引任何外链**（否则 CSP 拦截）
4. **发布**：
   - `dashboard_url` 为空（首次）→ Artifact 发布 → 把返回 URL 写回 `progress.json.dashboard_url`，随本次阶段边界一起 commit
   - 已有 → Artifact 发布时传 `url = progress.json.dashboard_url`（更新同一看板，URL 不变，跨会话也命中）
5. 向用户回链接

## 铁律
- 看板是**只读镜像，不是真相源**——真相永远在 progress.json / features.json；看板渲染出错不影响状态机
- 本 skill **只读状态 + 发布，不 flip status、不改任何状态文件**（除首次把返回 URL 写回 `dashboard_url`）
- 数据**全部来自已落盘的状态文件**，无额外数据源、无外链
- 默认私有；用户可从 artifact 页面自行分享只读链接给干系人
