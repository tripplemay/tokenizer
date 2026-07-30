---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-SYNC-HEALTH（verifying，5/6，fix_round 0）**：harness 同步健康已进入本地 state、heartbeat、Device schema 和三处控制台视图。
- 真实触发：7/28 本机有人闸门但控制台未见；7/30 agent 恢复后 6 项目成功、3 项目确定性 400 每分钟重复。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a` loopback；自治关闭，family 互斥成立。
- F001-F005 已锁本地 SHA `446d319`；F006 由 Kimi A2A 跑 test/verify/build、四轮同步模拟与敏感信息负例。
- Generator 在 2400s 截止前完成实现和 build 但未产 handoff，receipt=CANCELED；orchestrator 接管并修复真实 CLI 接线缺陷。
- 本批改 tokenizer 产品类型、agent、Device schema/heartbeat 和现有诊断 UI；不改 harness-template，不访问生产或部署。

## 上一批次

- **BL-DISPATCH-LIFECYCLE ✅ done（2026-07-29）**：dispatch deadline、portable watchdog、A2A cancel/stop 与终态 receipt；6/6，fix round 0。
- 人工闸门已签发、中继并消费；tokenizer 当前基线 `9483208`，Harness framework v1.5.2 `473ecd0`。

## 已知边界

- 产品代码尚未 push/deploy；当前已安装 agent 仍是旧版，控制台暂不会出现本批健康字段。
- 本批不做永久 4xx 自适应 backoff；只做结构化分类、持久诊断与重复日志降噪，保持闸门周转上限。
- 跨物理机 A2A 与 Windows 原生进程树仍为 soft-watch，不纳入本批。
