---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-DISPATCH-LIFECYCLE（building，0/6，fix_round 0）**：deadline、portable watchdog、A2A cancel/stop、终态 receipt 与 soak。
- 用户明确同意把上一批发现的 dispatch 基础设施问题作为下一批。
- 源码唯一源=`/Users/yixingzhou/project/harness-template`；tokenizer 只经 `harness.sh sync` 更新托管副本。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a` loopback；自治关闭，family 互斥成立。
- building 串行；verifying 跑 deterministic lifecycle matrix + 真实 Kimi A2A 短时 soak。

## 上一批次

- **BL-HARNESS-DETAIL-MODEINTENT ✅ done（2026-07-27）**：项目下钻、签名下一次 `/plan` 模式意图与 dispatch 历史；6/6，fix round 1。

## 生产状态

- tokenizer 产品仍为 `de10a16`/`4aa801f` 修复链；本批不改产品 API/UI/DB，也不访问生产。
- Harness framework 当前 v1.5.0；本批目标 v1.5.1，先改模板源再同步 tokenizer。

## 已知 gap

- 已复现风险：envelope deadline 未执行、macOS 单次 sleep/单 PID watchdog、runner stop 留孤儿、client connection refused 无终态。
- Harness 详情页无既有 Stitch/design-draft 原型，本批按现有控制台视觉系统新增布局并做 Playwright 双 viewport 验证。
