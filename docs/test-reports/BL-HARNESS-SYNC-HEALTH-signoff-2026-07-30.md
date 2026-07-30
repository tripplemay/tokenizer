# BL-HARNESS-SYNC-HEALTH Signoff 2026-07-30

> 状态：Evaluator 全部 PASS，人工闸门已批准并消费，`progress.json status=done`
> 锁定 SHA：`fc923fa88738a550ebcd572d9290019b81ca7973`
> 生产部署 SHA：`95eb927b7fca3dab57aed2ef672de6a6046af3c8`

## 变更范围

- F001：结构化 Harness 同步结果、安全错误分类与 20 条 issue 上限
- F002：本地健康快照、四态判定、原子持久化与日志去重
- F003：Device 三个可空诊断字段、Heartbeat 严格校验与 agent v5
- F004：设备列表、设备详情、Harness 项目卡共享健康展示
- F005：`harness --status`、`harness --json`、README 与回归测试
- F006：Kimi A2A 独立安全与端到端验收

## 独立验收

`reviewer-kimi-a2a` 在 1429 秒内完成 loopback A2A 验收，事件序列为
`SUBMITTED -> WORKING -> artifact -> COMPLETED`。本地 receipt 与 verdict schema
均校验通过；原始结论见
`docs/test-reports/BL-HARNESS-SYNC-HEALTH-verdict.json`，F001-F006 全部 PASS，
`waiting=null`。

| 检查 | 结果 |
|---|---|
| `npm run verify` | PASS（Prisma generate + TypeScript） |
| `npm run lint` | PASS，0 error / 0 warning |
| 聚焦回归 | PASS，6 files / 71 tests |
| 全量 `npm test` | PASS，667 passed / 4 skipped |
| `npm run build` | PASS |

Evaluator 使用临时 HOME、三个假 Harness 仓库与 `127.0.0.1` mock server 完成六轮：
部分 400、相同 issue 去重、issue 变化、全网络失败、恢复、持续健康。结构化
state、Heartbeat body、CLI JSON、agent log 与 UI 字段均未泄漏模拟响应正文、token、
URL query、绝对路径或 stack。

## 数据与 Ops

- 用户于人工闸门消费后另行明确授权生产发布；`main` 已推送至
  `95eb927b7fca3dab57aed2ef672de6a6046af3c8`。
- GitHub Actions `Deploy VPS` run `30568649559` 全部成功：Linux/Windows 验证通过，
  `20260730000000_add_harness_sync_diagnostics` 已由 `prisma migrate deploy` 应用，
  PostgreSQL healthy、应用容器重建并通过 `/api/health`。
- 生产健康接口回报 `commit=95eb927b7fca3dab57aed2ef672de6a6046af3c8`。
- 本机客户端从 `9197bd4` 升级至 `95eb927`，复用既有设备凭据并重启 launchd；
  v5 心跳与 Harness `degraded` 快照已成功上报生产。

## Dispatch 运行记录

- Generator 在 2400 秒硬截止前完成实现、测试与 build，但未写 handoff；权威 receipt
  为 `CANCELED`。Orchestrator 保全 diff、独立复验，并用真实 CLI 发现和修复 Commander
  action 接线缺陷。详见 `BL-HARNESS-SYNC-HEALTH-generator-timeout-recovery.md`。
- Evaluator A2A 在 1800 秒上限内于 1429 秒完成并返回合法 artifact。
- Evaluator 的临时脚本遇到 macOS 无 GNU `timeout` 后改用后台进程完成 scheduler 验证；
  没有把平台差异误判为产品故障。

## Soft-watch

| ID | 描述 | 风险 | 处置 |
|---|---|---|---|
| S1 | 独立浏览器没有生产登录会话，未自动点击带真实设备数据的下钻面板 | low | 已验证 `/harness` 未登录时正确 307 至 `/login`；服务端、迁移、心跳和数据上报均已 smoke，登录态视觉验收留作人工查看 |
| S2 | 三个历史项目的摘要触发 `sensitive_summary_data`，Harness 总体为 `degraded` | medium | 新诊断已正确分类并显示具体项目；这是下一批基础设施修复输入，不阻断本批发布 |

## 人工闸门

`tripplezhou@gmail.com` 于 `2026-07-30T16:37:55.431Z` 一次性批准
`BL-HARNESS-SYNC-HEALTH-verifying-done-w1`。设备 agent 以 commit `64b9efe`
中继决策，Ed25519 guard 验签通过；批准已消费，`pending_gate=null`。该批准不包含
生产部署或数据库迁移授权；生产操作来自随后用户对“提交推送部署”的单独明确授权。
