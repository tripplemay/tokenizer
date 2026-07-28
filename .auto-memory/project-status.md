---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-DISPATCH-LIFECYCLE（verifying，5/6，fix_round 0）**：deadline、portable watchdog、A2A cancel/stop、终态 receipt 与 soak。
- 用户明确同意把上一批发现的 dispatch 基础设施问题作为下一批。
- 源码唯一源=`/Users/yixingzhou/project/harness-template`；tokenizer 只经 `harness.sh sync` 更新托管副本。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a` loopback；自治关闭，family 互斥成立。
- F001-F005 已完成；F006 正在跑 deterministic lifecycle matrix + 真实 Kimi A2A 短时 soak。

## 上一批次

- **BL-HARNESS-DETAIL-MODEINTENT ✅ done（2026-07-27）**：项目下钻、签名下一次 `/plan` 模式意图与 dispatch 历史；6/6，fix round 1。

## 生产状态

- tokenizer 产品仍为 `de10a16`/`4aa801f` 修复链；本批不改产品 API/UI/DB，也不访问生产。
- Harness framework v1.5.1 已在源仓 `9fb6ffc` 推送，tokenizer sync 后 139 个受管文件零漂移。
- 独立验证：lifecycle 18/18、local-state 3/3、mode-intent 30/30、Vitest 619/4、Prisma/TS 与 bootstrap smoke 通过。

## 已知 gap

- 已修复风险：deadline 未执行、macOS 单 PID watchdog、runner stop 留孤儿、client 终态丢失和 deadline 完成竞态。
- 待办仅 F006：Kimi 锁定 `9fb6ffc` 做真实 A2A loopback、cancel/stop/timeout 与 3-task soak 独立验收。
