---
name: role-context-planner
description: Planner 角色行为规范 — 需求处理、框架维护、收尾流程（不存计划和进度）
type: feedback
---

## 需求处理

- 新批次启动前必读：`docs/test-reports/user_report/`（用户反馈）+ `backlog.json`（需求池）
- 用户反馈中的 P0/P1 级 DX 问题应优先纳入下一批次
- 涉及 UI 页面架构变更时，检查设计稿是否已同步，未同步则追加更新设计稿的功能条目
- 功能改造批次的 acceptance 必须包含设计稿一致性检查项（除非明确为「布局变更」）

## IA refactor 类批次 redirect 清单评估（v1.0 — BL-064 沉淀）

- spec §关键决策点必须逐条标记每个老路由 redirect 的 destination **wire-readiness** 状态
- destination 未 wire 等效功能 → 该条写 "kept deep-link，BL-XXX wire 后启 redirect"，不预设"所有老路由立即 redirect"

## 工具绑定与角色分配

- 新的 v2 模式只向用户展示 Harness 支持的 CLI 工具及调用方式
  (`{tool, invocation}`)，不展示或要求用户选择具体 agent id；下一次 `/plan` 才由本机
  `tool-integrations/1` registry 与 verified adapter 确定性解析内部 target。
- Planner 选择器的首项固定为不可配置的 Coordinator；签发 `planner: null` 表示由当前主会话
  负责规划。Coordinator 不属于 registry，也不写入 `role_assignments`。
- Generator 与 Evaluator 必须解析为不同 `model_family`；A2A 目前只允许 Planner/Evaluator，
  Generator 必须使用有本地 source-handoff 契约的路径。
- 历史 v1 的 `role_assignments` / `.agents-registry` 仍只按兼容路径读取；不要在新的 v2 intent
  中写入 agent id。用户未指定工具时，按界面默认的 Coordinator Planner 与已签发的其他绑定处理。

## done 收尾

1. **校验** project-status.md 是否准确完整（不重写，整合不一致处即可）
2. 处理 `framework/proposed-learnings.md`，逐条提交用户确认
3. 清除 progress.json 中的 `role_assignments`
4. 询问下一批次

## 框架维护

- 即时提出：影响当前决策的规则变更，对话中提出 → 用户确认 → 立即写入
- 后台队列：不紧急的，追加到 `framework/proposed-learnings.md`
- **不得未经用户确认直接修改 `framework/` 文件**（proposed-learnings.md 除外）
