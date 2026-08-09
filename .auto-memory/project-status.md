---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- 无进行中批次（BL-CODEX-USAGE-DEDUP done + 已部署，2026-08-06）。**status=done，等待消费 backlog 启动 BL-REPO-MECH。**
- **战略裁决（2026-08-08/09，用户确认）：双仓 keep-separate**（三视角裁判一致 0.85/0.80/0.72），tokenizer 沿「agent 编程项目管理系统」路线升级。完整依据 `docs/analysis/2026-08-08-repo-strategy/`（本地未提交，BL-REPO-MECH F004 后入库）；落地计划 `implementation-plan.md` + 12 份批次方案 `batch-plans/`；backlog.json 已物化 14 条新批次（近期 6 high + 中期 6 medium + 派生 2 low）。
- **下一批次执行形态已签名钉住**：mode intent 77af0221（08-09 签发，08-16 过期）= heterogeneous，generator=codex/local-cli，evaluator=kimi/local-cli，Planner=Coordinator，自主关闭。

## 已知边界

- 🔴 **部署管道当前冻结**：main 有 7 个测试红（framework-version/mode-badges 硬编码 1.7.0 vs manifest 1.7.1，v1.7.1 升级走 paths-ignore 未跑 CI）——任何产品 push 被 verify 拦。修复 = BL-REPO-MECH F003（打头阵）。
- **paths-ignore 与 CLAUDE.md 不一致**：实际不含 `*.md` 全局豁免，docs/specs|test-cases|test-reports 之外的 docs push 会触发生产部署（BL-REPO-MECH F004 修）。
- Windows CI `install-agent-lifecycle` 既有失败使 workflow 总结论恒 failure（BL-AGENT-SUPPLY-CHAIN F006 修）。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；bridge launch 前如过期需先以最小 kimi -p 调用刷新（fail-closed 设计）。
- 本机 Agent parser 修复待重新安装 Agent（BL-CODEX-USAGE-DEDUP 遗留）。
