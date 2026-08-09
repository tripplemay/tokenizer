---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-TRANSITION-LOG：done（2026-08-09，一次通过）**。落地计划近期 #2：HarnessTransition 流转事件表 + HarnessBatchArchive 归档表（report 事务内差分/done+superseded 触发）+ timeline tab。fan-out 4 隔离 evaluator 全 PASS（含影子库 migration 重放、scratch 库 migrate deploy 实跑、8 边界探针、真实组件渲染测试）；生产运行 a48f0f9+。消费口径备注：done 批次统计按 archivedReason='done' 过滤（superseded 行 doneAt 恒 null）。**下一批次：BL-COST-BATCH-V1 前先做 BL-GATE-INBOX（近期 #3）**——注意两批都改 report route，串行。
- **BL-REPO-MECH：done（2026-08-09）**。落地计划近期 #1 完成：部署管道解冻（7 红→21/21 绿，CI Linux Verify/Deploy/Contract Conformance 三绿）· 版本测试去税（manifest 派生，v1.8.0 sync 与假版本注入两次实战验证）· 上游 v1.8.0 contract-fixtures + tokenizer 双向契约测试与跨仓 CI · paths-ignore 扩 `docs/**`（docs-only push 实测零触发）· keep-separate ADR（`docs/adr/0001`）。复验 Kimi fix_round=1 全 PASS，闸门经控制台签名批准消费。顺带产出框架 v1.7.2（generator 派发回执 local-cli 假阴性修复，本批首派撞出）。
- **异构执行首次全程跑通**：v2 signed intent（Codex generator ×3 派发 + Kimi evaluator ×2 轮）+ spec-lock critic ×3 + accept 全链路。踩坑解法与机制缺口已记 `framework/proposed-learnings.md`（3 条待确认）。
- **战略基线（用户 2026-08-08 确认）**：双仓 keep-separate + 升级「agent 编程项目管理系统」三阶段落地计划——`docs/analysis/2026-08-08-repo-strategy/`（已入库）；backlog 排队近期 5 批 + 中期 6 批。**下一批次：BL-TRANSITION-LOG**（含吸收 PERF-ANALYTICS 归档表建议）。

## 已知边界

- Windows CI `install-agent-lifecycle` 既有失败使 workflow 总结论恒 failure（Linux Verify/Deploy 不受影响）——已排入 BL-AGENT-SUPPLY-CHAIN F006。
- harness-console-demo 删除待用户执行（Contract Conformance CI 已取代其演练职能）。
- mode intent 77af0221 已随 BL-REPO-MECH 消费；下批次执行形态待控制台新签 intent 或本机手工选择。
- accept-generator-handoff 本机操作要点：`TMPDIR=/tmp` 调用（长路径破 sun_path 104）+ 沙箱先铺 node_modules（目标已存在须先 rm 再 `cp -cR`）——根治提案在 proposed-learnings。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；派发前以最小 `kimi -p` 调用刷新（fail-closed 设计）。
- 本机 Agent parser 修复待重新安装 Agent（BL-CODEX-USAGE-DEDUP 遗留）。
- prisma/migrations 缺 migration_lock.toml + legacy 漂移（批次前遗留，backlog：BL-MIGRATION-LOCK-DRIFT，low）。
