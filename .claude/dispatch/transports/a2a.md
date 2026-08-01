# Transport: a2a —— 真异步 / 跨机器（**已实装**）

> 编排者作为 A2A **client**，把一个阶段的活委托给**长驻 runner**；runner 在自己所在机器上
> 调本地机件 #7 沙箱执行，任务状态落盘，供轮询或 SSE 订阅。规范主文见 `harness/dispatch-mode.md`。
>
> ⚠️ **这是 A2A 形状的子集，不是通过一致性认证的 A2A 实现。**
> 只做 JSON-RPC 绑定（不做 gRPC/REST 三绑定）、不做扩展协商、不做签名 Card、不做 OAuth/mTLS。
> **不要假设它能直接对接任意第三方 A2A agent**——对接前需按对方的一致性级别逐项核对。

---

## 1. 它比 local-cli 多给什么

`local-cli` 是阻塞子进程：会话在，任务在；会话关，任务死。`a2a` 多三样：

| 能力 | 说明 |
|---|---|
| **真异步** | `send` 立刻返回 `taskId`（实测 0.08s，对端任务 4s）。派完就能关会话去做别的 |
| **taskId 重订阅** | 任务状态落盘，活过 runner 重启；换个会话、换台机器凭 id 取回结果 |
| **服务端推送** | SSE `SubscribeToTask` 实时推 `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent`，无轮询延迟 |
| （附带）**跨机器** | runner 绑 `0.0.0.0` + Bearer，编排者在另一台机器上派活 |

`run`/`subscribe` 不是无限等待：从 Agent Card 身份核验开始就使用与 local-cli 相同的 effective timeout
`min(envelope.deadline_s, descriptor.timeout_s)`，缺 deadline 时用 descriptor cap，再加 5 秒 transport
grace。到点先 `CancelTask`；确认 CANCELED 后，即使 runner 在 drain 结束后令最终 GetTask 连接失败，
本地仍落可解释的 CANCELED run-meta，不把已确认事实降级成未知错误。

active v2 non-fast 的 client 调用还会先匹配 resolution 的
`execution_provenance_sha256`：远端 endpoint、runner identity、adapter 执行契约、timeout 等可执行 target
语义只要漂移，即在网络请求前 fail-closed。该 hash 不是 Agent Card 签名，也不是防篡改凭证；用户的
Ed25519 意图签名仍只覆盖 `{tool, invocation}`。旧五字段 active v2 checkpoint 缺少此基线，升级后必须重新
`/plan` 并 consume 新 intent。

对 `/autodrive` 心跳模型尤其合适：唤醒周期不必再等外部 CLI 跑完，
`ScheduleWakeup` 间隔与外部任务时长彻底解耦——`autonomous-mode.md` §9 那个
「长 verify 跑超间隔导致并发唤醒抢跑」的未决问题顺手解掉。

## 2. 组件

```
编排者（client）                          对端机器（runner）
 dispatch-run.sh                          a2a-runner.py --integration <cli-integration>
   └ a2a-client.py run                      ├ GET  /.well-known/a2a-agent-card
       ├ SendMessage → taskId               ├ POST / SendMessage → 起后台 sandbox-profile.sh
       ├ SubscribeToTask (SSE)              ├ POST / GetTask / ListTasks / CancelTask
       ├ 产物写本地 deliverable.artifact     ├ POST / SubscribeToTask（SSE + Last-Event-ID 重放）
       └ 合成 run-meta（与 local-cli 同形）  └ task store 落盘（活过重启）
```

`dispatch/1` 的旧路径仍可使用 `--agent <local-cli-id>`。新的 `tool-integrations/1` 配置使用
`--integration <integration-id>`：runner 从该 integration 的 `local_cli` 配置启动已验证 adapter，
并只接受框架固定的 Planner / Evaluator 角色。Coordinator 侧的 `a2a_targets` 记录 endpoint、认证与
`remote_runner_id`；工具目录为每个 target 生成角色专属内部 ID，例如
`a2a--codex-remote--planner`、`a2a--codex-remote--evaluator`。这些 ID 是运行时审计键，不是用户配置。

因此，任何已验证 `local_cli` integration 都可由同一个 runner 泛化为 A2A Planner/Evaluator：Claude Code、
Codex 和 Kimi 不需要各自实现第二套网络协议。一个新 CLI 想进入 A2A 目录仍必须先有已验证 adapter，并由
运维配置远端 `a2a_targets` 条目；系统无法从“本机已安装命令”自动推断远端地址或凭据。当前示例已为这三种
工具提供 loopback target；未来工具只要通过同一 adapter 核验即可自动进入规则体系。

## 3. 安全模型

### 3.1 沙箱在自建 runner 下**完整生效**（对 dispatch-mode.md R4 的修正）

runner 跑在哪台机器，就在哪台机器调本地 `sandbox-profile.sh` —— 机件 #7 四道锁一条不少。
**R4「沙箱在 a2a 下整体失效」只适用于我们不控制的第三方对端**，不适用于自建 runner。

跨机器部署时对端须自证机件在位（`.claude/dispatch/` 已装、adapter `_verified: true`）；
Agent Card 的 `x-harness.sandboxed` 字段用于声明，但**声明不等于证明**——
接非自建对端前必须人工确认。

### 3.2 鉴权 fail-closed

- `HARNESS_A2A_TOKEN` 未设时**只允许绑 loopback**；绑 `0.0.0.0` 而无 token → **拒绝启动**
- 所有端点（含 Agent Card）校验 `Authorization: Bearer`，错/缺 → 401
- 第一版刻意不做 OAuth/mTLS：局域网 + Bearer 已覆盖目标场景，上 OAuth 是负资产

编排端 descriptor 的 `auth` 是另一条受控边界：只允许省略（无 header）、`{"type":"none"}`，或
`{"type":"bearer","env":"REMOTE_A2A_TOKEN"}`。`auth.env` 必须是安全的专用 `REMOTE_A2A_*` POSIX
变量名，不能把 `OPENAI_API_KEY` 等任意宿主密钥转发给远端；`HOME`、`PATH`、所有 `GIT_*` / `HARNESS_*`、
动态链接器和 shell 初始化变量也都被拒绝。空对象、`null`、未知类型、多余字段、缺 bearer `env`，以及
local-cli/subagent descriptor 上的 `auth` 都 fail-closed。registry preflight、tool catalog 与 a2a client
在发出任何网络请求前共享这项检查。

对端 runner 可继续把自己的监听凭据保存在 `HARNESS_A2A_TOKEN`；编排端应从安全的外部配置把**同一个值**注入
如 `REMOTE_A2A_TOKEN` 的专用变量，再在 A2A descriptor 中引用后者。这样远端 token 不会通过 descriptor
读取 Harness 的内部控制变量。

### 3.3 🔴 远端自述只是参考，权威判定在本地

runner 返回的 `state` 写进 run-meta 的 `remote_state_advisory` 字段，**仅供取证**。
客户端把产物写到本地后，由调用方对**本地副本**重跑 `validate-dispatch.sh receipt`——
我们校验实际收到的东西，不采信远端的结论。跨机器场景下这是唯一诚实的做法。

对于 `tool-integrations/1` 的 target，client 在每次涉及已委托信封的发送、读取或订阅前都会读取 Agent Card，并严格核验
`remote_runner_id`、`tool`、`integration_id`、`model_family`、请求角色、`harness/1.1` 版本与
`sandboxed=true`。这避免把“Codex A2A target”误接到 Kimi runner 后，悄然破坏 Generator/Evaluator 的
family 互斥。该 Card 仍不是签名证明；非自建对端的身份信任仍依赖部署边界和认证。

### 3.4 Generator 目前被刻意拒绝

`a2a-client.py` 能把结构化 artifact 内联回本机，但不能安全回流远端 Generator 的源码 diff、
未提交变更或可验证 commit。因而 registry、tool catalog、dispatch 入口和 runner 都会 fail-closed
拒绝 `transport=a2a + role=generator`。这不是 A2A 整体未实装：Planner proposal 与 Evaluator verdict
仍可正常使用 a2a。等 source-handoff protocol 明确定义了 diff/commit 的归属、完整性和回流校验后，才可
放开 Generator。

## 4. 与 local-cli 的一致性

**Planner / Evaluator 的产物落盘位置、run-meta 字段、回执推断表、gate-arbiter、`/autodrive` 全部不变。**
`dispatch-run.sh` 按 `descriptor.transport` 路由，两条路径输出同形 run-meta：
两者也都把该记录耐久落在 `--state` 目录（默认项目 `.harness-dispatch/`）；
local-cli 的日志仍在它的 workroot，不会被搬运或上传。

| run-meta 字段 | local-cli | a2a |
|---|---|---|
| `artifact` | worktree 内绝对路径 | **本地**绝对路径（内联回传后写盘） |
| `outcome` | 沙箱直接观察 | 由传输层事实推导（拿到产物=RETURNED，取消=TIMEOUT…） |
| `transport` | `"local-cli"` | `"a2a"` |
| `remote_state_advisory` | 缺省 | 远端自述，仅参考 |

跨机器时客户端读不到 runner 的文件系统，所以**产物必须随响应内联回传**——这是 a2a 与 local-cli
唯一的实质差异，也是 A2A 把 Artifact 设计成消息负载而非路径的原因。

## 5. 用法

```bash
# ── 对端机器 ──
export HARNESS_A2A_TOKEN=<token>        # 绑非 loopback 时必需
python3 .claude/dispatch/transports/a2a-runner.py \
  --integration codex --runner-id codex-remote-runner \
  --host 0.0.0.0 --port 41241

# ── 编排者机器 ──
export REMOTE_A2A_TOKEN=<同一 token>
# descriptor.auth = {"type":"bearer","env":"REMOTE_A2A_TOKEN"}
bash .claude/dispatch/dispatch-run.sh --agent a2a--codex-remote--evaluator --envelope envelope.json   # 阻塞至终态

# 真异步用法：派完就走
python3 .claude/dispatch/transports/a2a-client.py send --agent a2a--codex-remote--evaluator --envelope envelope.json
#   → {"taskId": "...", "state": "SUBMITTED"}          ← 可以关会话了
python3 .claude/dispatch/transports/a2a-client.py get  --agent a2a--codex-remote--evaluator --task <taskId> --envelope envelope.json
#   → 终态时写产物 + 落 run-meta；未完成则报当前 state
python3 .claude/dispatch/transports/a2a-client.py subscribe --agent a2a--codex-remote--evaluator \
        --task <taskId> --envelope envelope.json --resume-from <seq>            ← 断线从第 seq 个事件后重放，不丢事件

# graceful stop：先收束 active task，终态在 drain 内仍可 Get/SSE，最后清 pidfile
python3 .claude/dispatch/transports/a2a-runner.py --integration codex \
        --state .harness-dispatch/a2a --stop
```

runner 的 `--cancel-grace` 下限是 2.25 秒：默认 sandbox timeout helper 先给 CLI group 2 秒 TERM
窗口，再由 runner 回收外层 sandbox group。缩得更短会让 helper 来不及清理它创建的独立 group，故拒绝启动。

## 6. 演练记录（2026-07-25）

| 场景 | 结果 |
|---|---|
| 绑 `0.0.0.0` 无 token | ✅ 拒绝启动 |
| 无 token / 错 token 访问 | ✅ 401 |
| `send` 非阻塞 | ✅ 0.08s 返回（对端任务 4s） |
| 幂等：同 `task_id` 重复派活 | ✅ 命中去重，不重跑 |
| 跨会话凭 `taskId` 取结果 | ✅ |
| SSE 实时四事件 | ✅ SUBMITTED → WORKING → artifact → COMPLETED |
| `--resume-from 0` 断线重放 | ✅ 完整重放 |
| `CancelTask` | ✅ |
| runner 重启 | ✅ 任务记录存活；孤儿 WORKING 标 FAILED 而非永远挂着 |
| duplicate CancelTask | ✅ 幂等返回同一终态，只有一个 CANCELED status event |
| active `--stop` | ✅ TERM→KILL 完整 sandbox/CLI 组，持久化终态后有界 drain |
| **真实 Codex 经 a2a**（198s 长任务） | ✅ SSE 全程保活、4 事件完整、产物落本地、本地判定 COMPLETED |

**一个实测修掉的协议瑕疵：** 执行侧「先写终态记录、再发事件」，若 SSE 以 `state` 为收流判据，
会在最后一个 status 事件写盘前就发 `done` —— 直播订阅者永远收不到终态事件（重放才看得到）。
改为以独立的 `events_complete` 标志收流，并在收流前做最后一次排空。

## 7. 未做

- gRPC / REST 绑定（规范称三者功能等价，我们只做 JSON-RPC）
- 扩展协商（`A2A-Version` / `A2A-Extensions` 头）、`required` profile extension 的协议层拒绝
- 签名 Agent Card（RS256 JWS）验真 —— 接非自建对端时这是必需的
- Push webhook（`pushNotifications: false`）；当前只有 SSE 与轮询
- OAuth / mTLS
- **真实跨机器演练**：本次全部在 loopback 完成，网络路径与鉴权已验证，但未在两台物理机之间跑过
- Windows 原生进程树终止；当前 timeout/runner lifecycle 以 POSIX process group/session 为契约
- 自动无限重试/重派；SSE resume 与 GetTask retry 均受 effective deadline 约束，task-id 重派仍由上层限 1 次
