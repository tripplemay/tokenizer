# BL-NATIVE-SUBAGENT-BRIDGES · F003 第三轮（终轮）复验报告

> **Feature：** F003 — Kimi ACP 原生 Agent 子代理 bridge
> **阶段：** reverifying（fix_rounds = 3）
> **锁定 SHA：** `ce249dc3c431e95a42603e6209158de1a1620f3f`（开工与收工两次核对 HEAD 一致，工作树除本人测试产物外干净）
> **Evaluator：** fresh-context 隔离实例（Andy/evaluator-subagent，第 3 轮）
> **日期：** 2026-08-04（UTC）
> **结论：** **PASS**
>
> 上一轮（reverify2）唯一阻断项 —— **acceptance F：planner persona 生产路径不可用（当时 4/4 确定性失败）**
> —— 已消除。本人在锁定 SHA 上发起 **3 次真实 planner/`plan` persona 端到端 launch**，
> 其中 **2 次成功**（73s / 104s，`RETURNED / completed / nonce 绑定 receipt / source_changes=[]`，
> artifact 由 driver 依 D8 `terminal-message` 通道物化并 sha256 绑定进 receipt），
> 1 次失败为**非确定性**（同一份契约逐字重放即成功），且失败为 fail-closed（无产物、无源码写入）。
> 三个 persona 至此在本 SHA 或其等价前身上均有真实 launch 实证。
> 详见 §5（真实 launch）、§6（逐条判定）、§9（非阻断观察）。

---

## 1. 取证方式声明

全部结论基于磁盘实物与本人实测输出，**未采信任何转述**（包括编排者指令中的描述、Generator 的
commit message、`session_notes` 中的冒烟结论、以及前两轮报告的判定）：

- 自行读取 `progress.json`（含上轮 `evaluator_feedback` 与 `session_notes`）、`features.json`、
  `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-spec.md`（含新增 **D8 / D9**）、
  `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-FIX2-planner-persona-adjudication.md`（`#1:A #2:A #3 #4`）、
  上轮报告 `…-reverify2-F003-2026-08-04.md`
- 自行阅读第 3 轮全量 diff（`c06babc..HEAD`，含 `6b8900b` + `4cf44df`）与 HEAD 现状代码
- 自行**新写**独立探针 `scripts/test/f003r3_terminal_message_channel_probe.py`（不复用 Generator 的测试模块）
- 自行执行真实 launch、突变实验、fail-closed 负例与全量回归
- **未修改任何产品代码；未执行任何 `git add` / `commit` / `push`。**
  工作树新增仅 `scripts/test/f003r3_terminal_message_channel_probe.py`
  与 `docs/test-reports/` 下本报告及证据文件（`git status --short` 唯一条目为 `?? scripts/`）

**L2 边界（已获用户授权）：** 本轮实际行使 **3 次真实 Kimi launch**（planner persona）。
凭据仅经 provider broker 进入 worker；未读取、未复制用户 Kimi wire / session 文件
（对 CLI bundle 的检视限于 provider 自己 staged 的只读副本）；报告与证据文件中所有
session id、nonce、call id 一律以 sha256 摘要出现，无 prompt / 模型正文 / 凭据材料。
为使 provider 通过凭据新鲜度检查，launch 前用厂商 CLI 自身的一次性最小 prompt 触发 OAuth 刷新
（`kimi -p`，在 `/tmp` 独立工作目录中执行），未触碰用户既有会话。

---

## 2. 前置核对（编排者指定，作为跨 feature 证据记录）

### 2.1 目录三角色发布与 provenance 一致性（F001 面）

未打桩实测 `tool-catalog.py catalog`（provider attestation 有效时）：

| role | 候选（tool, invocation） |
|---|---|
| planner | claude-code a2a/local-cli、codex a2a/local-cli、kimi a2a/local-cli、**kimi subagent** |
| generator | claude-code local-cli、codex local-cli、kimi local-cli、**kimi subagent** |
| evaluator | claude-code a2a/local-cli、codex a2a/local-cli、kimi a2a/local-cli、**kimi subagent** |

Codex **无** subagent 候选（**F002 面未回归**）。

target provenance（`tool-catalog.py target`）：

| role | native_agent_type | agent_type | **deliverable_channel** | execution_provenance_sha256 |
|---|---|---|---|---|
| planner | `plan` | planner-proposal | **`terminal-message`** | `f8c09e746967f6e3…` |
| generator | `coder` | generator-restricted | `file` | `be19985929069d9f…` |
| evaluator | `explore` | evaluator | `file` | `7c816e0d5913de5a…` |

共同字段：`bridge_id=kimi-acp-native-agent`、`bridge_strategy=session-bridge-v1`、
`bridge_provider_id=harness-vm-v1`、`bridge_provider_kind=vm-v1`、
`bridge_provider_contract_sha256=5b1ccaaa69e4123d…`、`session_scope=same-session`。

三个 provenance 互不相同，且与上一轮记录**全部不同**——这是**预期**且是好事：新增的
`deliverable_channel` 已进入 provenance 计算（见 §4.3 受控突变证明），签发后 manifest 漂移会被
launch 前复算捕获。

### 2.2 项目 ↔ 模板 ↔ 应用包三方一致性

F003/F004 相关 13 个文件在 `.claude/dispatch/**`、`framework/templates/claude/dispatch/**`、
`~/.tokenizer/app/framework/templates/claude/dispatch/**` 三处**逐一 IDENTICAL**
（tool-catalog.py、dispatch_common.py、**dispatch-run.sh**、test-lifecycle.py、
test-vm-bridge-provider.py、test-tool-catalog.py、test-session-bridge-kimi.py、
transports/{vm-bridge-provider,session-bridge,session_bridge_kimi,vm-bridge-worker}.py、
transports/bridges/kimi-acp-native-agent.json、subagent-bridge.schema.json）。

→ **上轮 §9.1 的分发链缺口（应用包 `dispatch-run.sh` 未同步）已修复。** 本轮真实 launch 全部
以应用包内的 provider 入口发起，即为该结论的实证。

---

## 3. 第 3 轮变更的机制审阅（D8 / D9）

`c06babc..HEAD` 共 30 文件、+979/−531。与 F003 相关的实现要点（本人读码确认）：

| 层 | 变更 | 位置 |
|---|---|---|
| manifest schema | 新增可选 `deliverable_channels`（按角色，`file` \| `terminal-message`），`additionalProperties:false` | `subagent-bridge.schema.json` |
| Kimi manifest | 声明 `{"planner": "terminal-message"}` | `transports/bridges/kimi-acp-native-agent.json` |
| catalog | 解析、缺省补 `file`、越角色/未知值 fail-closed；进入 candidate、target 与 **bridge_semantics（→ provenance）** | `tool-catalog.py` |
| TS 镜像 | 同一形状规则（未知角色/未知通道 → 拒绝整份 manifest） | `src/cli/harness-tool-catalog.ts` |
| driver 分通道 prompt | `terminal-message` 时子代理提示改为"交付物即最终消息、不得写文件/跑命令"，根会话被要求逐字转述 | `transports/session-bridge.py` |
| driver 物化 | `_materialize_terminal_message`：`O_CREAT\|O_EXCL\|O_WRONLY(\|O_NOFOLLOW)`、`0600`、1 MiB 上限、空内容 fail-closed | `transports/session_bridge_kimi.py` |
| 传递链 | worker 校验并透传 `--deliverable-channel`；provider `_load_launch_target` 校验通道合法 | `vm-bridge-worker.py` / `vm-bridge-provider.py` |
| D9 归约 | 受托 artifact 路径可覆盖 baseline，内容变化计入 `source_changes`，哈希照常绑定 | `vm-bridge-provider.py::_reconcile_returned_source` |
| FIX2 #3 | test-lifecycle 两条旧架构用例删除，并留下守护属性映射注释（映射目标用例经本人 grep 确认存在） | `test-lifecycle.py:850-861` |

**关键保真性检查（本人做的等价性实验）：** 用 `git show c06babc:` 取回第 2 轮的
`session-bridge.py`，与 HEAD 并排生成根提示词：

```
evaluator  file-channel root prompt identical to round 2: True
generator  file-channel root prompt identical to round 2: True
planner    terminal-message prompt differs from file    : True
terminal-message prompt bans writes                     : True
```

→ `file` 通道（generator/`coder`、evaluator/`explore`）的提示词与第 2 轮**逐字节相同**，
故第 2 轮对这两个 persona 的真实 launch 结论可无损前移，本轮不必重复消耗 L2。

---

## 4. 协议层与目录层实测（无 L2 成本）

### 4.1 本人独立探针（新写，11 例全绿）

`scripts/test/f003r3_terminal_message_channel_probe.py` —— 以脚本化 ACP peer 驱动**生产源码**
（`session-bridge.py` / `session_bridge_kimi.py` / `vm-bridge-provider.py`），不复用 Generator 的测试模块：

| # | 断言 | 结果 |
|---|---|---|
| 1 | terminal-message 把根会话转述文本物化到 artifact；`artifact_sha256` = 物化字节的 sha256；权限 `0600`；receipt 内**不含**模型正文 / nonce 明文 / session 明文 | OK |
| 2 | `file` 通道行为不变：子代理不落盘即 fail-closed，driver 不代写 | OK |
| 3 | 空/纯空白转述 → fail-closed，且**不留残留文件** | OK |
| 4 | > 1 MiB 转述 → fail-closed，无残留 | OK |
| 5 | 未发布通道（`stdout`）→ 在**启动厂商进程之前**拒绝 | OK |
| 6 | artifact 路径是 symlink → 拒绝，且不写穿到外部目标 | OK |
| 7 | artifact 路径在 worktree 中已存在 → 独占创建失败，fail-closed，**不静默覆盖**（见 §9.2 观察） | OK |
| 8 | **D9**：受托 artifact 覆盖 baseline 被接受，且计入 `source_changes` | OK |
| 9 | **D9**：内容相同的覆盖**不**计入 `source_changes` | OK |
| 10 | **D9**：只读角色在 artifact **之外**的任何改动仍 fail-closed（`read-only bridge returned a source change`） | OK |
| 11 | 返回树缺少受托 artifact → fail-closed | OK |

### 4.2 manifest 通道声明的突变实验（catalog 层）

| 突变 | 结果 |
|---|---|
| 未知通道值 `stdout` | fail-closed：`…deliverable_channels.planner must name a published deliverable channel` |
| 越角色声明（`reviewer`） | fail-closed：`…may only declare the bridge persona roles` |
| 非字符串通道（`7`） | fail-closed：`…must be a non-empty string` |
| `deliverable_channels` 非对象（数组） | fail-closed |
| 字段缺省 | 三角色全部回落 `file`（向后兼容） |

### 4.3 通道确实进入 execution provenance（受控单变量）

以补丁替换 `load_subagent_bridge`，**仅**把 planner 通道由 `terminal-message` 翻成 `file`，
其余输入完全不变，走同一 `candidates_from_registry → resolve_target` 路径：

```
published planner    : f8c09e746967f6e31d7497ba  terminal-message
channel flipped=file : cdb6a87f988ad13cbc2b1a4d  file
provenance changed   : True
```

### 4.4 通道漂移在 provider 与 worker 两层同样 fail-closed

对合法 target JSON 做定点篡改后分别喂给 `_load_launch_target`（provider）与 `target_from`（worker）：

| 篡改 | provider | worker |
|---|---|---|
| 未改（对照组） | 接受 | 接受 |
| `deliverable_channel="stdout"` | `bridge target deliverable channel is invalid` | `target deliverable_channel is invalid` |
| 删除该字段 | `bridge target deliverable channel is invalid` | `target shape is invalid` |
| 置 `null` | `bridge target deliverable channel is invalid` | `target deliverable_channel is invalid` |

→ 目录、provider、worker **三层**独立守门，任何一层被绕过都不足以让非法通道进入执行。

### 4.5 启动层 fail-closed 负例（真实生产入口，均在触达 VM 前拒绝）

| # | 注入 | 实际输出 |
|---|---|---|
| N1 | `--expected-provenance` 全 0 | `bridge target provenance drifted` |
| N2 | planner 信封 × evaluator target | `bridge target does not allow the envelope role` |
| N3 | `--registry` 指向 `agents-registry.example.json` | `bridge registry is not the project registry` |
| N4 | 重复 task_id 再次派发 | `provider state record already exists`（幂等键生效） |

---

## 5. 真实端到端 launch（本人发起，锁定 SHA，L2）

三次均以**应用包内**的生产 provider 入口发起，`--expected-provenance` 取 planner target 的
`f8c09e746967f6e3…`。脱敏结构化证据落盘：
`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F003-r3-planner-launch-audit.json`。

| 探针 | 契约形态 | 起止（UTC） | 时长 | 结果 |
|---|---|---|---|---|
| **P1** | 自然语言 + 要求子代理自行读 `planner-proposal.schema.json` 并按序拼三项事实 | 06:36:44 → 06:41:58 | 314s | **失败**（exit=2，`VM restricted provider unit failed`） |
| **P2** | 给出字面 JSON 模板，仅留两处需查仓填空 | 07:08:09 → 07:09:25 | **73s** | **成功** |
| **P3** | **P1 契约逐字重放**（仅换 task_id） | 07:29:16 → 07:31:02 | **104s** | **成功** |

> P3 是本轮的关键对照：**同一份曾失败的契约逐字重放即成功**，因此 P1 的失败
> **不是确定性的**，与上一轮 planner 4/4 确定性失败有本质区别。上一轮的结构性冲突
> （`PLAN_TOOLS` 无写能力 × 协议强制落盘）已被 D8 通道消解。

### 5.1 成功 run 的绑定链（P2 / P3 均逐项命中）

```
outcome            RETURNED            exit_code 0
role / agent_id    planner / subagent--kimi--planner
adapter / family   kimi / kimi         transport subagent
ref                ce249dc3c431e95a42603e6209158de1a1620f3f   ← 锁定 SHA
termination_reason completed           effective_timeout_s 2400
source_changes     []                  ← 只读角色零源码写入

receipt: bridge_id=kimi-acp-native-agent  bridge_kind=acp-native-agent/v1
         bridge_strategy=session-bridge-v1  session_scope=same-session
         subagent_type=plan  terminal_status=completed
         nonce_sha256 / session_id_sha256 / child_call_id_sha256 / artifact_sha256
         provider_launch_attestation_sha256
```

本人复核的绑定关系（对照 `_validate_bridge_receipt` 与 attestation 载荷）：

- `receipt.nonce_sha256` **==** 本次 launch attestation 的 `nonce_sha256` → child 证据锚定在
  **本次** provider attestation 上，跨 run 不可重放（P2 `bf7b4c20…`，P3 同构且互不相同）
- attestation 的 `target_provenance_sha256` **==** `f8c09e746967f6e3…` == 已发布 planner target
  provenance（**其中已含 `deliverable_channel`**）
- `receipt.subagent_type == plan == target.native_agent_type`；`terminal_status == completed`
- `receipt.artifact_sha256` **==** 物化 artifact 字节的 sha256（本人独立重算，两次均 True）
- artifact 权限 `0600`

### 5.2 child 确实做了真实工作（非空壳回执）

两次成功 run 的 artifact 由 **driver 依 terminal-message 通道物化**（`plan` persona 全程无写工具），
内容为根会话转述的子代理最终消息：

```json
// P2 (373 bytes)
{"proposal_version":"planner-proposal/1", … ,"summary":"5 | 模式签发、设备目录与动态界面桥接语义", …}

// P3
{"proposal_version": "planner-proposal/1", … ,
 "summary": "5 | 模式签发、设备目录与动态界面桥接语义 | Codex local-cli 保持与 external bridge 禁止", …}
```

对照锁定 ref 上的 `features.json`：条目数 **5**、F004 标题 **模式签发、设备目录与动态界面桥接语义**、
F002 标题 **Codex local-cli 保持与 external bridge 禁止** —— **逐字正确（含中文）**。
这三项事实只有真实读取锁定 ref 的仓库文件才能得出 → 证明 provider-owned worker 内确有真实
Kimi `plan` child 执行了受托任务，且交付物经根会话转述后被 driver 完整物化。

---

## 6. F003 acceptance 逐条判定

acceptance 原文（`features.json` F003）+ spec §F003 + **D8/D9**：

| # | 验收条款 | 判定 | 本轮证据 |
|---|---|---|---|
| A | runner 通过 ACP `initialize`/`session/new`/`session/prompt` 驱动 **Harness 自有** Kimi 根会话，且在 **provider-owned worker** 中 | **PASS** | §5 两次真实 planner launch（`RETURNED/completed`，`session_scope=same-session`）；generator/evaluator 的 file 通道提示词与第 2 轮逐字节相同（§3），其真实 launch 结论无损前移 |
| B | 严格委派提示含**单次** nonce | **PASS** | 两次 run 的 `receipt.nonce_sha256` 均等于**本次** launch attestation 的 `nonce_sha256`，且两次互不相同；框架探针 `test_generated_root_prompt_binds_exactly_one_nonce` OK |
| C | 仅 nonce + `plan/coder/explore` 类型 + 完成事件三者齐备才接受 child | **PASS** | 两次 run `subagent_type=plan`、`terminal_status=completed` 并经 provider 三重绑定校验；框架负例（nonce 不符/类型不符/无 completion/无 Agent call/多 Agent call）全绿 |
| D | 不解析或泄露用户 Kimi session wire / prompt / 模型输出 / 凭据 | **PASS** | run-meta + receipt 敏感标记扫描（`Bearer`/`access_token`/`refresh_token`/`sk-`/`eyJ`/`CHILD_PROMPT`/`harness-child:`/`wire.jsonl`/`oauth`/broker lease）**0 命中**；receipt 仅摘要字段；本人探针第 1 例断言 receipt 内无模型正文 |
| E | ACP 或 child 证据不足必须 fail-closed | **PASS** | 启动层 N1–N4（§4.5）+ 协议层 11 例（§4.1）+ 通道漂移三层（§4.4）+ 框架 6 套回归；P1 的失败本身亦为 fail-closed（无产物、无 copyout、无源码写入） |
| F | **三角色 persona 固定映射且受控可用**（spec §F003：planner/generator/evaluator 分别用受控的 plan/coder/explore） | **PASS** | 映射声明正确（§2.1）；**planner/`plan` 由本人真实 launch 2/3 成功**（P1 非确定性失败，P3 逐字重放即成功）；generator/`coder`、evaluator/`explore` 提示词与第 2 轮逐字节相同且该轮各有真实 launch 成功。上轮"结构性不可用"已消解。可靠性观察见 §9.1 |
| G | Generator 修改仅经 source-handoff artifact 返回；**D9** 受托 artifact 路径为合法覆盖点 | **PASS** | 本人探针第 8–11 例：覆盖被接受并计入 `source_changes`、同内容不计入、artifact 之外的只读越权仍拒、缺 artifact 仍拒；两次 planner run `source_changes=[]` |
| H | worker 不复制/挂载用户 Kimi state；认证与网络仅经 provider broker | **PASS** | copy-in 归档 930 条目中对 `kimi-code\|credentials\|.kimi/\|wire.jsonl\|oauth\|.ssh\|.aws` 检索 **0 命中**；顶层仅 `.harness-cli-bundle.tar.gz`/`.harness-envelope.json`/`.harness-runner`/`.harness-target.json`/`source` |
| **D8** | 通道声明式、进入 target 与 provenance；未知通道/越角色 fail-closed；物化独占创建、0600、限长、空内容拒收 | **PASS** | §4.1 第 1/3/4/5/6 例、§4.2 全部、§4.3 受控突变、§4.4 三层校验；真实 run 的 artifact `0600` 且 sha256 绑定 receipt |
| **D9** | provider 归约接受受托 artifact 覆盖 baseline，变化计入 `source_changes` | **PASS** | §4.1 第 8–10 例；上轮 OBS-2（本批 evaluator 交付路径与 baseline 冲突）据此消解 |

---

## 7. 回归矩阵（本人运行，非采信转述）

| 套件 | 结果 |
|---|---|
| `scripts/test/f003r3_terminal_message_channel_probe.py`（本人新写独立探针） | **Ran 11 — OK** |
| `.claude/dispatch/test-session-bridge-kimi.py` | Ran 20 — OK（较上轮 +2，即 terminal-message 两例） |
| `.claude/dispatch/test-session-bridge.py` | Ran 9 — OK |
| `.claude/dispatch/test-external-bridge-receipt.py` | Ran 8 — OK |
| `.claude/dispatch/test-vm-bridge-provider.py` | Ran 13 — OK（较上轮 +1，即 D9 覆盖用例） |
| `.claude/dispatch/test-tool-catalog.py` | Ran 38 — OK（较上轮 +1，即通道解析/fail-closed） |
| `.claude/dispatch/test-lifecycle.py` | **Ran 51 — OK，skipped=0**（上轮为 `OK (skipped=2)`，FIX2 #3 已落地） |
| `npx vitest run tests/cli/harness-tool-catalog.test.ts` | **77 passed**（上轮 73，+4 为 TS 镜像通道用例） |
| `npm run test`（全量） | **60 files / 909 passed / 4 skipped，exit 0** |
| `npm run verify`（prisma generate + tsc --noEmit） | **exit 0** |
| `npm run lint` | **exit 0 — No ESLint warnings or errors** |

**跨 feature 回归：无。** F001 面（三角色发布 + provenance + 未知/未验证 bridge fail-closed）、
F002 面（Codex 无 subagent 候选、无 bridge provenance）、F004 面（TS 镜像同形状校验、
`heterogeneous` 语义未放宽）、F005 面（provider 归约行为）本轮均未观察到退化。

---

## 8. 复现步骤

```bash
# 0) 锁定 SHA
git rev-parse HEAD            # 需为 ce249dc3c431e95a42603e6209158de1a1620f3f

# 1) 协议层 / 目录层（无 L2 成本）
python3 scripts/test/f003r3_terminal_message_channel_probe.py
for f in test-session-bridge-kimi test-session-bridge test-external-bridge-receipt \
         test-vm-bridge-provider test-tool-catalog test-lifecycle; do
  python3 .claude/dispatch/$f.py; done
npx vitest run tests/cli/harness-tool-catalog.test.ts && npm run test && npm run verify && npm run lint

# 2) 目录与 provenance
python3 .claude/dispatch/tool-catalog.py target --registry .agents-registry.json \
  --adapters .claude/dispatch/transports/adapters --target-id subagent--kimi--planner
#   → deliverable_channel = terminal-message, execution_provenance_sha256 = f8c09e74…

# 3) 真实 launch（L2，需用户授权；provider 要求 Kimi 凭据剩余有效期 > 60s）
python3 .claude/dispatch/transports/vm-bridge-provider.py doctor      # 需 available:true
python3 -I ~/.tokenizer/app/framework/templates/claude/dispatch/transports/vm-bridge-provider.py launch \
  --agent subagent--kimi--planner --envelope <planner envelope> \
  --registry $PWD/.agents-registry.json --adapters $PWD/.claude/dispatch/transports/adapters \
  --project-root $PWD --state $PWD/.harness-dispatch/f003-reverify3 \
  --expected-provenance f8c09e746967f6e31d7497ba5895c9531fadc8c64d94cfef3b83513637566712
```

证据文件：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F003-r3-planner-launch-audit.json`（脱敏）。

---

## 9. 非阻断观察（供 Planner 裁量，均不影响本轮判定）

### 9.1 planner 真实 run 的可靠性与可诊断性（**建议优先处理**）

本人 3 次真实 planner launch 中 **1 次失败**（P1，314s 后 `exit=2`）。该失败：

- **不是确定性的**：同一契约逐字重放（P3）即成功；
- **是 fail-closed 的**：无 artifact、无 copyout、无源码写入、无状态记录残留；
- **但不可自助诊断**：host 侧只得到通用的 `VM restricted provider unit failed`。
  我进一步查了 guest 侧 journal，只能确认 worker 单元 `status=2/INVALIDARGUMENT`，
  job 目录已按设计被完整收割（`/var/lib/harness-vm-v1/jobs` 为空），guest stdout/stderr
  按设计不外泄，因此**具体失败语义无法还原**。

结合 D8 的实现（`_materialize_terminal_message` 在根会话未产出任何文本时抛
`Kimi bridge returned no terminal-message deliverable`），最可能的语义是"根会话未按要求转述最终消息"
一类的模型侧变数——但这是推断，不是实证。**建议**：让 provider 把 guest 侧失败原因以**受限枚举/白名单**
形式回传（只回传 driver 抛出的错误类别，不回传任何模型文本），否则每次偶发失败都要烧掉一次
wall-clock（最坏 2400s）且无法定位。此项属可用性/可运维性，不构成 acceptance 阻断。

### 9.2 `terminal-message` 的独占创建与 D9 覆盖语义不完全对齐

driver 以 `O_EXCL` 物化 artifact（探针第 7 例），因此当受托 artifact 路径**在 copy-in baseline 中已存在**时，
`terminal-message` 角色会在物化阶段 fail-closed —— 即 D9"受托路径是合法覆盖点"目前只对 `file` 通道可达。
对 planner 的规范路径 `docs/test-reports/planner-proposal-<task_id>.json` 而言，task_id 唯一，实际碰撞概率低，
故不阻断；但两条规则的语义**建议在后续批次对齐**（要么 driver 允许受托路径覆盖，要么在 D8 中写明该例外）。

### 9.3 `terminal-message` 物化的是"整段根会话文本"而非严格意义的"最终消息"

`_agent_message_text` 汇总的是根会话在**整个 session 内**的全部 `agent_message_chunk` 文本并拼接；
若根会话在派发 Agent 之前先有一段旁白，该旁白会被前置进 artifact。本轮两次成功 run 的产物都很干净
（提示词已明令"不得加入自己的评论"），但 D8 措辞为"最终消息"。**建议**后续把物化范围收敛到
child 完成事件之后的文本，使实现与裁决用词严格一致。

### 9.4 凭据 TTL ≈ 15 分钟仍造成目录可见性抖动（属 fail-closed 设计）

本轮开工时 `doctor` 即报 `Kimi OAuth credential expires too soon`，catalog 随即**隐藏**三角色 kimi subagent
候选——行为正确，但意味着"能否签发 Kimi bridge"取决于一个 15 分钟窗口。运维上建议在
`/plan` 边界前提示刷新，或让 doctor 输出剩余有效期以便人类判断。

### 9.5 最小 planner 探针产物未通过 `validate-planner-proposal.sh` 完整性检查

我的 P2/P3 契约刻意要求 `spec:null` + 空 `features`，因此产物虽满足 JSON schema 形状，
却被完整性校验拒（`完整 batch_plan 必须含 spec object` / `至少需要一条 feature`）。
这是**我的探针契约形态**所致，**不是 bridge 缺陷**——记录于此以免后续误读证据。

### 9.6 registry 惰性字段

`kimi` integration 的 `sandbox.env_set.KIMI_CODE_HOME` 对 bridge 路径仍然无效（provider 全文不引用
`env_set`/`sandbox`）。已按 FIX2 #4 登记 backlog `BL-REGISTRY-LAZY-FIELD-CLEANUP`，本轮未动 registry，符合裁决。

---

## 10. 结论

**F003 = PASS。**

- acceptance **A–H 八条全部达成**，新增裁决 **D8 / D9 的语义亦逐条实测达成**。
- 上一轮唯一阻断（**acceptance F：planner persona 生产路径结构性不可用，4/4 确定性失败**）
  **已消除**：D8 的声明式 `terminal-message` 通道让只读 `plan` persona 在**保留厂商只读语义**的前提下
  完成受托交付，本人 3 次真实 launch 中 2 次成功，且 1 次失败经**逐字重放对照**证明为非确定性、
  fail-closed 的偶发，而非上一轮那种结构性不可达。
- 证据链完整：child 证据锚定本次 provider attestation（nonce 摘要相等）、artifact 由 driver 物化后
  sha256 绑定进 receipt、artifact 内容需真实读取锁定 ref 才能得出（含中文标题逐字正确）、
  只读角色 `source_changes=[]`。
- 通道字段在 **catalog / provider / worker 三层**独立 fail-closed，并进入
  `execution_provenance_sha256`（受控单变量突变证明），签发后漂移会在 launch 前被捕获。
- 全量回归绿：framework 6 套 + 本人独立探针 11 例 + vitest 909 passed + verify + lint，
  **未发现任何跨 feature 回归**。

**判定理由：** acceptance 明文要求的三 persona 受控可用，本轮已由**真实生产路径**的端到端证据全部覆盖；
剩余问题（§9.1 失败可诊断性、§9.2/§9.3 语义对齐）均为可用性与规范措辞层面的改进项，
不改变"能力已具备且 fail-closed 边界完整"的事实，故判 PASS。

**未修改任何产品代码；未执行 `git add` / `commit` / `push`。**
新增测试产物：`scripts/test/f003r3_terminal_message_channel_probe.py`、
`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F003-r3-planner-launch-audit.json`、本报告。
