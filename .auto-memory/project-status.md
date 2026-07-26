---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-FWDRIFT ✅ done（2026-07-26）**：控制台把框架版本从「一个字符串」变成「一个判断」
  （落后 N 版 / 最新 / 超前 / 未知，各带可执行指引）。405 测试通过。
  - **本批次是 harness 全链路在本项目自身上的首次实跑**：plan→build→异厂商 fan-out 验收
    （Kimi × Codex 各在一次性 worktree 独立验）→ 结论不一致举 debias_conflict 闸门 →
    人在控制台批准 → fixing → 复验一致 4/4 → phase_advance 闸门 → done
  - 外部验收抓到 1 个真 bug：`parseFrameworkVersion("01.0.3")` 前导零被当合法 → 报「落后 9 版」。
    我自己的 12 个用例与 Kimi 都没碰到这个分支，只有 Codex 探边界撞出来
  - 2 处根子在规格上：F002 描述与验收标准自相矛盾；F003 要求给一条 `adopt` 命令，
    而 adopt 在 lock 存在时会拒绝执行 —— 跑不通的建议。裁决为**改规格不改实现**
- **待办**：框架侧 6 条沉淀待确认（harness-template/proposed-learnings.md）；
  确认并修掉后再把 harness 推广到其余 8 个项目

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
