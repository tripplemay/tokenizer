---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HOMEPAGE-FRESHNESS：verifying（4/5，2026-08-22）**。直接用户反馈：首页停留约 3 小时无新事件且需硬刷新。Generator 已分别提交 one-shot refresh（`fc9f0cf`）、25-event newest-first upload（`a5de7a6`）、durable queue/cursor checkpoint（`97ecad9`）、append-only UTF-8 byte cursor（`fdb049d`）；精确 HEAD L1 为 lint/verify/build PASS、1274 passed/20 skipped。F005 待隔离 Evaluator 验证部署 SHA 与真实浏览器 freshness。
- **BL-SECURITY-P1：done（8/8，2026-08-22，fix_rounds=0）**。异厂商编排（generator=codex / evaluator=kimi）独立验收 F001-F008 全 PASS；迁移后 scratch PostgreSQL 实证 F004 并发 CAS=200/409 且单一签名、F005 多账号隔离，F007 独立复算 1,951,110 tokens / $19.388000 且单查询。产品 HEAD `1b218df` 的 Linux Verify + Deploy 已绿（Actions 32609297410）；signoff：`docs/test-reports/BL-SECURITY-P1-signoff-2026-08-22.md`。Soft-watch：enrollment-status 恒真断言与 F006 unmount abort 缺 jsdom 行为测试，均为 low、后续批次补强。
- **BL-COST-BATCH-V1：done（2026-08-10，fix_rounds=1）**。战略核心首兑现：HarnessTransition 时间窗 join → 批次/阶段成本进控制台（harness overview 成本卡 + projects 联动卡，同口径 cache key 字节级同一）。首轮 5 分片全 PASS（F004 审计 27/27：混入 $5.15 恰多算 $5.15）；同 SHA 独立前端评审（46 findings）F-31 触发 fixing 轮：done 终态零宽封闭 + unpriced 显式披露 + orderBy 次级序，复验零回归。顺路 F005：migration_lock.toml + 九表 FK ON UPDATE 漂移收敛（反事实逐字节核证）。评审分流：**BL-SECURITY-P1 下批优先** + BL-COST-PERF + REMAINDER。signoff：`docs/test-reports/BL-COST-BATCH-V1-signoff.md`。
- **BL-AGENT-LATENCY：done（2026-08-10，一次通过 fix_rounds=0）**。落地计划近期 #4：双条目 cron（闸门延迟 15min→2min，cron 主机重装后生效）· 退避+抖动（60s×2ⁿ 封顶 600s）· enroll agentFetch · events 页 cursor 分页（scratch DB 250 条实证零重复遗漏）· release 1.4.0（预案 1.3.0 被 DISPATCH-USAGE 占用，带据修正）· notify 8s 超时（上批 soft-watch #2 闭环）· model 归因补全（框架 v1.10.0 argv 兜底 + 服务端 unknown 补写；4 条 9.54M 事件重报落地）。规划期发 v1.9.1 消费台账（学习回流）。signoff：`docs/test-reports/BL-AGENT-LATENCY-signoff.md`。坑：feature title 裸路由开头触发 sensitive_summary_data 拒收；agent-lifecycle SIGTERM 用例 CI flake 一次（重跑绿，留观）。生产 f3d7a9a+；本机 agent 1.4.0。**下一批候选：BL-COST-BATCH-V1（近期 #5，战略核心）**。
- **BL-GATE-INBOX：done（2026-08-09，一次通过 fix_rounds=0）**。落地计划近期 #3：全站待批徽章 + pending-count API · 闸门邮件通知（Resend REST + notifiedAt claim 恰一次 + fail-open）· evidence 分类徽标先行版 · dashboardUrl 补显 · dispatch 产物补显（排除断言带据反转）。fan-out 5 隔离 evaluator 全 PASS（signoff：`docs/test-reports/BL-GATE-INBOX-signoff.md`，含 scratch 库 migration 重放、4 个 fail-open 探针、生产 401 负向面实测）；生产 ac69897+。L2 自然验证：下次真实闸门应收到邮件 + 导航栏红徽章。soft-watch 已录 backlog（BL-NOTIFY-FETCH-TIMEOUT，low）。**下一批次候选：BL-AGENT-LATENCY（近期 #4→#5 序）**。
- **BL-DISPATCH-USAGE-CAPTURE：done（2026-08-10，fix_rounds=1）**。用户发现派发用量缺失后直立批次；三层根因全修：codex --ephemeral 使用量仅存 run 日志（框架 v1.9.0 提取器+钩子）、agent 批次白名单丢历史 run、readRegistry 不认 tool-integrations/1（dispatch 镜像 07-31 迁移后静默断链）。服务端幂等物化（dispatch:<taskId>）+ attribution_only 防 kimi 双重计费；回填 4 次 codex 派发共 input 9.54M（用户目视确认 /events 可见）。fix_round=1 修正被复验证伪的交付叙述（adapter 实已钉 -c model=gpt-5.6-sol——unpriced 真因是提取器缺 argv 兜底档，顺延 BL-DISPATCH-MODEL-PIN）。agent release 1.3.0；release 版本税已消。
- **BL-TRANSITION-LOG：done（2026-08-09，一次通过）**。落地计划近期 #2：HarnessTransition 流转事件表 + HarnessBatchArchive 归档表（report 事务内差分/done+superseded 触发）+ timeline tab。fan-out 4 隔离 evaluator 全 PASS（含影子库 migration 重放、scratch 库 migrate deploy 实跑、8 边界探针、真实组件渲染测试）；生产运行 a48f0f9+。消费口径备注：done 批次统计按 archivedReason='done' 过滤（superseded 行 doneAt 恒 null）。**下一批次：BL-COST-BATCH-V1 前先做 BL-GATE-INBOX（近期 #3）**——注意两批都改 report route，串行。
- **战略基线（用户 2026-08-08 确认）**：双仓 keep-separate + 升级「agent 编程项目管理系统」三阶段落地计划——`docs/analysis/2026-08-08-repo-strategy/`（已入库）；backlog 排队近期 3 批（GATE-INBOX/AGENT-LATENCY/COST-BATCH-V1/BUDGET 中前三）+ 中期 6 批。

## 已知边界

- Windows CI `install-agent-lifecycle` 既有失败使 workflow 总结论恒 failure（Linux Verify/Deploy 不受影响）——已排入 BL-AGENT-SUPPLY-CHAIN F006。
- harness-console-demo 删除待用户执行（Contract Conformance CI 已取代其演练职能）。
- mode intent：77af0221 与 **da55b68a 均已消费入台账**（后者 → BL-SECURITY-P1）；done 收尾已同时清除旧 `role_assignments` / `progress.mode_intent`。`harness.json.project.mode_defaults=null`，下批按本机手工默认车道，除非控制台另签新 intent。
- 框架 **v1.10.1**（2026-08-10 回流）：console-mode §3.5 投递失败语义——`head_mismatch` 归可重试竞态、被拒 intent 须留痕、服务端 failed 走闸门邮件、`/plan` §0c 强制化。产品侧实现在 backlog `BL-MODE-INTENT-DELIVERY`。
- accept-generator-handoff 本机操作要点：`TMPDIR=/tmp` 调用（长路径破 sun_path 104）+ 沙箱先铺 node_modules（目标已存在须先 rm 再 `cp -cR`）——根治提案在 proposed-learnings。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；派发前以最小 `kimi -p` 调用刷新（fail-closed 设计）。
- install.sh 重装未推进 checkout（本次手动 fetch+checkout 兜底）——归 BL-AGENT-SUPPLY-CHAIN 整改面。
