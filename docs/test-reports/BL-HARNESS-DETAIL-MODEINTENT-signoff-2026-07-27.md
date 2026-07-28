# BL-HARNESS-DETAIL-MODEINTENT 验收签署

> **已撤回（2026-07-28T01:54:40Z）：** signoff 后的真实 device 上报发现合法 feature title 中的
> `/plan` 被敏感路径检测误报，tokenizer `/api/harness/report` 持续返回 400，phase gate 无法显示。
> `progress.json` 已回到 `fixing`，本文件仅保留首轮验收审计，不可作为批准依据。

**批次：** Harness 项目下钻、模式意图与 dispatch 历史  
**车道：** Generator=`builder-codex`（Codex/local-cli）· Evaluator=`reviewer-kimi-a2a`（Kimi/A2A loopback）  
**结论：** F001-F006 全部 PASS，首轮通过，`fix_rounds=0`

## 交付范围

| 功能 | 结果 | 交付事实 |
|---|---|---|
| F001 Harness 契约 | PASS | framework v1.5.0 安装签名 mode defaults、下次 `/plan` 消费和项目内 dispatch run-meta 落点 |
| F002 数据与校验 | PASS | additive Prisma migration、完整签名载荷、状态集合、执行/Agent/family/autonomy 纯函数约束 |
| F003 API 与上报 | PASS | session/device 租户隔离、合法 ACK 状态机、fail-closed 签发、脱敏摘要 upsert |
| F004 Device agent | PASS | 验签、repo/HEAD/脏文件检查、原子暂存、定向提交、ACK 与能力版本 4 |
| F005 下钻面板 | PASS | 整卡链接、Overview/Modes & Agents/Activity、模式编辑器、中英文与旧快照兼容 |
| F006 独立验收 | PASS | Kimi 锁定 Generator SHA，经 A2A loopback 独立取证并返回 schema verdict |

## 独立验收与 dispatch 记录

- Generator 锁定提交：`91d3d2fc4924d84f45a1e1eba8db9cdbce44f017`。
- A2A task：`BL-HARNESS-MODEINTENT-F006-91d3d2fc4924`，事件完整经过
  `SUBMITTED -> WORKING -> artifact -> COMPLETED`，595 秒返回。
- 本机重跑 receipt 后判 `COMPLETED`；verdict schema 合法，Kimi 原样判定 F006 `PASS`，无 waiting。
- 原样 verdict：`docs/test-reports/BL-HARNESS-DETAIL-MODEINTENT-verdict.json`。

## L1 与安全 fixture

| 检查 | 结果 |
|---|---|
| `npm run lint` | 通过，0 warning / 0 error |
| `npm run verify` | Prisma generate 与 `tsc --noEmit` 通过 |
| `npm run test -- --no-cache` | 49 files，588 passed，4 skipped，0 failed |
| `npm run build` | Next.js 生产构建通过，`/harness/[id]` 与全部 API route 正常产出 |
| `prisma migrate deploy` | 空 PostgreSQL fixture 依次应用 18 个 migration；复跑无 pending migration |
| 签名 fixture | 30/30 通过，覆盖篡改、过期、repo identity、family、transport、预算和 `/plan` 边界 |
| 聚焦 Harness 测试 | 6 files，127/127 通过，覆盖 staging、ACK、上报与 intent API |

签发与撤销后，当前 fixture 的 `status`、batch、HEAD、`execution=heterogeneous` 和
`autonomy.enabled=false` 均未改变；待生效的 slow + autonomy defaults 仍独立保留，证明当前批次不会被即时改写。

## 浏览器验收

Python Playwright 使用系统 Chrome 对锁定源码的生产构建执行了桌面 `1440x1000` 与移动端
`390x844` 流程：点击项目卡、遍历三个视图、检查 issued/staged/applied/failed、触发空日期校验、
真实签发（POST 201）并撤销（DELETE 200）。9 个页面状态的 body/root 宽度均等于 viewport，
console error 与 page error 均为 0。

- `docs/test-reports/BL-HARNESS-DETAIL-MODEINTENT-F006-desktop.png`
- `docs/test-reports/BL-HARNESS-DETAIL-MODEINTENT-F006-mobile.png`

## 部署与 Ops

F005 产品提交的 GitHub Actions run `30317964879` 已完成 Linux Verify、Windows Verify 与 Deploy VPS，
三段均成功。F006 只使用一次性本地 PostgreSQL 数据库和本地测试登录态；没有执行生产数据库 ops，
没有向外部服务发送凭据或原始日志。

## 未变更范围

Registry、凭据、deny-list、sandbox、`console.pub` 和框架升级仍为只读；控制台没有立即切换当前批次的入口，
也没有保存 prompt、stdout/stderr、环境变量、源码或本机绝对路径。

## Soft-watch

无。真实跨物理机 A2A 明确属于本批非目标；本批只验收 loopback 的协议、隔离、事件与 receipt 链路。

## Harness 状态

验收证据齐全，已举 `verifying -> done` 的 `phase_advance` 人闸门。批准前保持 `verifying`；
任何 agent 都不得代替人类写入 decision。

## Framework Learnings

本批次无新增 framework learning；dispatch 的 loopback、schema 交付与本地 receipt 规则按 v1.5.0 原样生效。
