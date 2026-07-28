# BL-DISPATCH-LIFECYCLE 验收签署

> 状态：**验收完成，待人工 phase gate**

**批次：** Dispatch deadline 与生命周期收束  
**车道：** Generator=`builder-codex`（Codex/local-cli）· Evaluator=`reviewer-kimi-a2a`（Kimi/A2A loopback）  
**结论：** F001-F006 全部 PASS，`fix_rounds=0`

## 交付范围

| Feature | 结果 | 交付事实 |
|---|---|---|
| F001 | PASS | local `repo.url` 在创建目录前校验；框架资源按脚本目录解析；deadline 与 descriptor cap 共用 `min` 契约 |
| F002 | PASS | stdlib wall-clock helper 使用独立 session/PGID、TERM→KILL、外部信号区分和完整收尸 |
| F003 | PASS | CancelTask、runner stop、重启恢复、唯一终态事件、drain 与 pidfile 生命周期收束 |
| F004 | PASS | A2A client 有界 SSE/GetTask、Last-Event-ID resume、confirmed cancel 恢复和 deadline 完成竞态处理 |
| F005 | PASS | 18 项 deterministic matrix、文档、CHANGELOG、v1.5.1 与 init/sync 管理 |
| F006 | PASS | Kimi 锁定提交独立复核；真实 A2A、3-task soak、timeout、cancel、active stop 全部通过 |

## Dispatch 记录

- 首次 preflight 从错误 CWD 调用，旧 sandbox 克隆 tokenizer 后无法 checkout harness SHA；未启动 agent。
- 第二次从正确仓调用，但旧 adapter 默认路径仍相对目标 CWD；未启动 agent。
- 两项均纳入 F001 后，Generator 锁定 harness-template `bd88e00`，task
  `BL-DISPATCH-LIFECYCLE-build-bd88e008aeb7` 在 2093 秒返回 `COMPLETED`。
- Generator handoff 通过字段白名单、F001-F005 归属与声明文件/真实 diff 一致性检查，归档于
  `docs/test-reports/BL-DISPATCH-LIFECYCLE-generator-handoff.json`。
- 集成审查修正了 stop fixture 观察窗短于 cancel grace 的时序问题，并补上 client deadline
  与恰好完成/既有 runner cancel 的两个终态竞态。

## 框架发布与同步

- harness-template v1.5.1：`9fb6ffcdb18971e913839d6be13b0656ac37499c`，已推送 `origin/main`。
- tokenizer 集成：`441a4c452b2ec74a15e1c5442da2dba9aa9d4bd0`，已推送 `origin/main`。
- `harness.sh status/verify`：v1.5.1，139 个受管文件与安装时一致，目标源零漂移。
- 隔离 bootstrap smoke：init、status、verify、sync 均通过，三个新 helper/test 在
  `.claude` 与 `framework` 两侧进入 harness.lock。

## 独立 Kimi A2A 验收

- A2A task：`BL-DISPATCH-LIFECYCLE-verify-441a4c452b2e`，锁定 tokenizer `441a4c4`。
- 事件严格为 `SUBMITTED → WORKING → artifact → COMPLETED`，466 秒返回。
- 本地 run-meta：`RETURNED`、effective timeout=1200、termination=`process_exit`。
- 本地 receipt 与 verdict schema 均通过；Kimi 对 F001-F006 原样判定 6/6 PASS，`waiting=null`。
- `resume-from=2` 只重放事件 3 artifact 与事件 4 COMPLETED，随后正常 done。
- runner graceful stop 后 pidfile、监听端口、runner/sandbox/helper/CLI 进程全部消失；durable task 仍为 COMPLETED。
- 原样 verdict：`docs/test-reports/BL-DISPATCH-LIFECYCLE-verdict.json`。

## Exact Loopback 与 Soak

| 场景 | 结果 |
|---|---|
| 3 个连续正常任务 | 三项独立 `COMPLETED`，每项事件 1-4 完整，receipt 三份通过，无 task-id 串扰 |
| hard deadline | effective=60；62 秒含 TERM grace 后 task=`CANCELED`，helper=`deadline/124`，父子 PGID 全回收 |
| CancelTask | task 原因=`cancel_task`；helper=`external_signal/143`；receipt 未伪装 TIMEOUT，父子 PGID 全回收 |
| active runner stop | 预连接 SSE 在 drain 内收到 CANCELED；原因=`runner_stop`；runner、父子 PID、pidfile 与 41241 端口全部收束 |
| 终态唯一性 | timeout/cancel/stop 均只有一个 terminal status event，`finished_at` 与 `events_complete=true` 齐全 |

这些 fixture 通过真实 v1.5.1 runner/client/sandbox/timeout helper，但 adapter 为本地可控脚本，
不调用模型、外网或生产；一次性 workroot/state 日志不进入项目报告。

## L1 与项目回归

| 检查 | 结果 |
|---|---|
| `python3 .claude/dispatch/test-lifecycle.py` | 18/18 通过，多轮复跑稳定 |
| `bash .claude/dispatch/test-local-state.sh` | 3/3 通过 |
| `python3 .claude/console/test-mode-intent.py` | 30/30 通过 |
| shell/Python syntax | 全部通过 |
| `npm run verify` | Prisma generate + `tsc --noEmit` 通过 |
| 全量 Vitest | 49 files，619 passed，4 skipped |

系统默认 LibreSSL 不支持 Ed25519，首次 Vitest 因 16 个 key fixture setup 失败；按项目既有兼容路径将
`/opt/homebrew/opt/openssl@3/bin` 前置后，49/49 文件全部通过。该问题未由本批引入。

## CI、部署与 Ops

本批只修改 harness/framework/status/report 路径，tokenizer workflow 的 `paths-ignore` 明确不触发
Deploy VPS；harness-template 没有 workflow，因此两个提交均无 GitHub Actions run，符合配置。
本批没有产品 API/UI/DB 变更，没有部署，没有数据库 ops，也没有访问生产或外部服务。

## Soft-watch

| ID | 描述 | 风险 | 后续 |
|---|---|---|---|
| S1 | 真实跨物理机 A2A、OAuth/mTLS 与签名 Card 未覆盖 | low | 属于规格明确非目标；引入远端 runner 前单独立项 |
| S2 | Windows 原生进程树语义未覆盖，本版 helper 面向 POSIX | low | 若增加 Windows 原生 dispatch，再补 Job Object 等价实现 |

## Harness 状态

验收证据齐全，已举 `verifying → done` 的 `phase_advance` 人闸门。批准前保持 `verifying`；
任何 agent 都不得代替人类写入 decision。

## Framework Learnings

本批发现的 repo/CWD、资源路径、watchdog 与 A2A 生命周期问题已直接沉淀进 v1.5.1 机件、测试和文档，
没有额外待处理的 framework learning。
