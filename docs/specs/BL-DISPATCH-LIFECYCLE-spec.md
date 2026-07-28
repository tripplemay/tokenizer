# BL-DISPATCH-LIFECYCLE — Dispatch deadline 与生命周期收束

**批次类型：** 混合基础设施批次（F001-F005 Generator；F006 Evaluator）  
**车道：** Generator=`builder-codex`（Codex/local-cli）· Evaluator=`reviewer-kimi-a2a`（Kimi/A2A loopback）  
**框架源：** `/Users/yixingzhou/project/harness-template`；tokenizer 的 `framework/` 与 `.claude/` 只能由 `harness.sh sync` 更新  
**自治：** 关闭；所有阶段推进继续由人工 gate 控制

## 背景与实物证据

上一批 `BL-HARNESS-DETAIL-MODEINTENT` 的修复轮真实运行暴露了 dispatch 生命周期缺口：

1. envelope 声明 `deadline_s=1400`，但 `sandbox-profile.sh` 只读取 agent descriptor 的
   `timeout_s=1800`，任务级 deadline 没有参与执行上限。
2. macOS 无 GNU `timeout` 时 fallback 是一次性 `sleep "$secs"` 后只 `kill` 直接子 PID。
   主机 suspend/resume 会让“进程 elapsed”与 sleep 的剩余时间分离；CLI 的孙进程也可能逃逸。
3. A2A task 长时间停在 `WORKING` 后执行 runner `--stop`，runner PID 退出，但 sandbox/CLI 进程组
   被重新挂到 PID 1；客户端随后以 `GetTask connection refused` 结束，拿不到可验证终态。
4. 同一 Kimi 改走直接 local-cli 后 794 秒正常完成，后续窄任务 412 秒正常完成，说明主要故障在
   timeout/A2A 生命周期层，而不是 evaluator 模型或产品代码。
5. 本批首次从 tokenizer 调用入口、把 envelope 指向 harness-template 时，sandbox 仍按调用者 CWD 克隆
   tokenizer，直到 checkout harness-template SHA 才失败。`repo.url` 没有参与目标仓库选择或前置一致性校验。
   切到 harness-template CWD 后，adapter 默认路径又被相对目标仓解析，证明机件路径也与 CWD 错误耦合。

系统休眠是否发生不能只凭 elapsed 反推，因此本批不把单次现场现象当实现结论；验收必须用可注入时钟和
可控假进程机械复现，再用真实 Kimi loopback 做短时 soak。

## 目标

- 让 `deadline_s` 从“说明字段”变成 local-cli 与 a2a 共用的每任务硬上限。
- 消除 envelope `repo.url` 与调用者 CWD 的目标歧义，在创建任何隔离目录前 fail-closed。
- 在 macOS/Linux 上可靠回收 CLI 完整进程树，并准确区分自身超时、外部取消和普通失败。
- 让 CancelTask、runner `--stop`、SSE/轮询和 durable task store 对同一终态达成一致。
- 任何路径都不得无限 `WORKING`、遗留孤儿进程，或因 runner 先退出而丢失终态 receipt。
- 将现场问题固化为无需真实模型即可在 CI/本机快速运行的生命周期矩阵。

## 关键设计决策

1. **目标仓库先验。** local path `repo.url` 必须规范化到 git top-level，并在 clone/worktree 创建前与实际
   调用仓一致；不一致时给出明确错误，不得克隆 CWD 后靠 checkout 偶然失败。真实跨机器 remote clone 仍非本批目标。
   adapter、validator、timeout helper 等框架资源的默认路径必须相对 dispatch 脚本自身目录解析，而不是目标仓 CWD。
2. **effective timeout = min(envelope deadline, descriptor cap)。** `deadline_s` 存在时是本任务硬上限；
   descriptor `timeout_s` 是 agent 级不可突破上限。缺 `deadline_s` 时保持旧行为。两者必须是有界正整数。
3. **单一可移植 timeout helper。** 不再让 GNU timeout 与 macOS bash watchdog产生不同语义。
   helper 以绝对 wall clock 判断到期，子命令在独立 process group/session 中运行；到期先 TERM，短 grace
   后 KILL 整组。只有 helper 自己到期才返回 124；外部 SIGTERM/CANCEL 不伪装成 timeout。
4. **终态先持久化，runner 后退出。** Cancel/stop 必须先让每个活动任务进入 `CANCELED`，写
   `finished_at`、status event 与 `events_complete`，回收进程组并提供短暂 drain 窗口，最后清 pidfile 退出。
5. **client 等待也有上限。** `run` 按 effective timeout + transport grace 等待；到点主动 CancelTask。
   `subscribe` 没有 envelope 时使用 descriptor cap。SSE 中断保留 resume seq；若 cancel 已确认，不依赖一次
   可能失败的 GetTask 才能生成 CANCELED 事实。
6. **幂等和状态所有权不变。** 同一 task id 不重复执行；transport 不推进 `progress.json`；远端 state 仍是
   advisory，本地 receipt/schema 仍是权威。不得自动无限重派。
7. **building 串行。** F001-F004 都触及 timeout/runner/client 契约，避免并行分支各写一套语义。
   verifying 用 deterministic matrix 打底，再运行真实 A2A loopback；真实跨物理机仍非目标。

## 状态与回执契约

| 场景 | sandbox 事实 | A2A task | 本地 receipt |
|---|---|---|---|
| 正常交付 | `RETURNED` | `COMPLETED`/waiting | schema 推断结果 |
| helper 自身到期 | exit 124 / `TIMEOUT` | `CANCELED` | `CANCELED`，允许一次幂等重派 |
| CancelTask | 外部终止，不伪造 helper timeout | `CANCELED` | `CANCELED` |
| runner `--stop` 有活动任务 | 全进程组 TERM→KILL | 每项 `CANCELED` + events complete | 客户端取得终态后 runner 退出 |
| 普通非零退出 | `FAILED` | `FAILED` | `FAILED` |
| exit 0 无 artifact | `ARTIFACT_MISSING` | `FAILED` | `FAILED` |

run-meta 可增加有界的 effective timeout/termination reason，但不得保存 envelope 原文、prompt、stdout/stderr、
环境变量、凭据或任意日志正文。task store 只保留现有有界 advisory/error tail 规则。

## F001 — Deadline 契约与校验

- dispatch/sandbox 在创建 workroot 子目录前校验本地 `repo.url` 与当前 git top-level 一致；错误必须指出两者，
  且不得留下半 clone。调用方可切换到正确仓库后用同一 task id 重试。
- `dispatch-run.sh`/`sandbox-profile.sh` 的 adapter、validator 与 helper 默认路径从脚本目录解析；从模板源或
  其他目标仓用绝对入口调用时行为一致，显式 `--adapters` 仍可覆盖。
- `dispatch-envelope.schema.json` 与 `validate-dispatch.sh envelope` 对 `deadline_s` 做同样的类型/范围校验。
- `sandbox-profile.sh` 解析 descriptor cap 与 envelope deadline，计算 effective timeout；缺省兼容旧信封。
- a2a client 的等待上限使用同一算法，不得重新发明第三套默认值。
- 测试覆盖 repo match/mismatch/非 git路径、跨 CWD 默认资源解析，以及 deadline 小于/等于/大于 descriptor、缺省、
  boolean/float/string/过小/负数。

## F002 — Portable process timeout helper

- 新 helper 负责启动独立 process group、绝对 wall-clock deadline、TERM/KILL escalation 与退出码传播。
- 信号处理必须在 wrapper 收到外部 TERM/INT 时转发给子组并收尸；不得留下 zombie/orphan。
- deterministic fixture 生成父进程 + 孙进程，断言 timeout 后二者都不存在。
- 通过可注入 clock/已过期 deadline 模拟 suspend 后唤醒，不要求 CI 真的休眠主机。

## F003 — A2A runner 生命周期

- Executor 的 process map 与 shutdown 状态线程安全；cancel/complete race 只能产生一个终态序列。
- CancelTask 等待进程组收束并原子完成 task record；重复 cancel 幂等返回同一终态。
- `--stop` 触发 graceful shutdown：取消所有活动任务、等待终态可读、再关闭 HTTP server；必要时在有界 grace
  后强杀，但仍落 durable CANCELED/FAILED 事实。
- pidfile 只指向本 state runner；退出清理。重启时继续把遗留 WORKING 标为可解释的 FAILED。

## F004 — A2A client 有界等待

- `run`/`subscribe` 的 SSE timeout 与 effective task timeout 对齐，并保留小的 transport grace。
- 超限时调用 CancelTask；cancel 确认后合成本地 CANCELED run-meta，不因随后的短暂断连降级为未知失败。
- 断线重订阅保留 Last-Event-ID；终态 artifact 仍内联回传并在本地重验 receipt/schema。
- CLI `send/get/cancel/card/ls` 兼容，stdout 仍只有机器 JSON，进度走 stderr。

## F005 — 回归、文档与发布

- 新增快速 lifecycle fixture，至少覆盖正常、timeout、external cancel、CancelTask、active `--stop`、SSE 重放、
  idle-exit、runner restart、重复 task id 和孤儿进程检查。
- 测试不得调用真实模型、网络或生产；临时目录/端口精确分配并在失败时清理。
- 更新 `dispatch-mode.md`、`local-cli.md`、`a2a.md` 与 CHANGELOG；框架版本升至 `1.5.1`。
- bootstrap/init/sync 管理新 helper/tests；harness-template 为唯一源，tokenizer 只经 sync 获得副本并保持零漂移。

## F006 — 独立验收与真实 soak

Evaluator 锁定集成 SHA，不采信 generator handoff 结论：

1. 独立运行 lifecycle fixture、shell/Python syntax、bootstrap init/sync smoke 与 tokenizer 相关 L1。
2. 用真实 `reviewer-kimi` runner + `reviewer-kimi-a2a` client 完成一个短任务，事件必须经过
   `SUBMITTED -> WORKING -> artifact -> COMPLETED`，本地 receipt/verdict schema 通过。
3. 用无模型可控 envelope 验证 deadline timeout、CancelTask 与活动 task 下 `--stop`；检查 task store、
   event seq、events_complete、pidfile 和精确 PID/PGID 全部收束。
4. 做 3 个连续短任务或等价短时 soak，证明无无限 WORKING、端口泄漏与 task id 串扰。
5. 输出原样 verdict 与 signoff；A2A runner/client 日志只留一次性 workroot，不进入项目报告。

## 非目标与回滚

- 不做真实跨物理机 A2A、OAuth/mTLS、第三方 A2A 一致性认证、Windows 原生 shell timeout 或网络隔离。
- 不修改 tokenizer 产品 API/UI/数据库，不访问生产，不调整 agent 厂商账户预算。
- 不自动批准 phase gate，不自动无限重派，不用宽泛 `pkill`/递归删除清理进程或目录。
- 回滚时恢复 v1.5.0 dispatch 机件；新信封仍兼容，但 `deadline_s` 会退回旧的说明性语义，故发布说明必须明确。
