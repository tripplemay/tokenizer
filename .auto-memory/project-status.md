---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-SYNC-HEALTH（done，6/6，fix_round 0）**：Kimi A2A 全 PASS，人工闸门已验签并消费。
- 真实触发：7/28 本机有人闸门但控制台未见；7/30 agent 恢复后 6 项目成功、3 项目确定性 400 每分钟重复。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a` loopback；自治关闭，family 互斥成立。
- F001-F006 已完成；Kimi 锁 `fc923fa` 跑 verify/lint/build、71 focused、667 full 与六轮同步模拟，verdict 全 PASS。
- Generator 在 2400s 截止前完成实现和 build 但未产 handoff，receipt=CANCELED；orchestrator 接管并修复真实 CLI 接线缺陷。
- `BL-HARNESS-SYNC-HEALTH-verifying-done-w1` 由 tripplezhou@gmail.com 一次性批准，agent 中继后 Ed25519 guard 验签通过。
- 本批改 tokenizer 产品类型、agent、Device schema/heartbeat 和现有诊断 UI；不改 harness-template，不访问生产或部署。

## 上一批次

- **BL-DISPATCH-LIFECYCLE ✅ done（2026-07-29）**：dispatch deadline、portable watchdog、A2A cancel/stop 与终态 receipt；6/6，fix round 0。
- 人工闸门已签发、中继并消费；tokenizer 当前基线 `9483208`，Harness framework v1.5.2 `473ecd0`。

## 已知边界

- 产品代码仍未 push/deploy；当前已安装 agent 仍是旧版，控制台暂不会出现本批健康字段。
- 本批不做永久 4xx 自适应 backoff；只做结构化分类、持久诊断与重复日志降噪，保持闸门周转上限。
- 跨物理机 A2A 与 Windows 原生进程树仍为 soft-watch，不纳入本批。
