---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次
- **[批次 ID]：`[status]`**（一句话目标）
- Generator [N/M] done → [下一步]
- [关键决策或路线图链接]

## 上一批次（[ID] done）
- [N/M] PASS，fix_rounds=[X]，[Reviewer 名] [日期] 签收
- Signoff: `docs/test-reports/[xxx]-signoff-YYYY-MM-DD.md`

## 生产状态
- HEAD `[short-sha]`（含 [批次] 代码），生产部署版本 `[short-sha]`
- [批次] 是否已部署、是否有 migration

## 路线图（如有）
- [大型重构计划的批次顺序，参考 backlog.json order 字段]

## 已知 gap（非阻塞）
- [遗留问题，每条一行]

## Backlog（延后）
- [被推迟到未来批次的事项]

<!-- 写入规则（来自 harness-rules.md §记忆分层）：
1. 覆盖写，不追加；保持 ≤30 行
2. 所有角色都可写，谁产生变更谁更新
3. 内容边界：只放 WHAT（会变的事实），不放 HOW（行为规范，那是 role-context 的事）
4. 不重复 progress.json 已有的结构化数据（status/completed_features/fix_rounds 等）
-->
