# BL-NATIVE-SUBAGENT-BRIDGES · F003 第二轮复验报告

> **Feature：** F003 — Kimi ACP 原生 Agent 子代理 bridge
> **阶段：** reverifying（fix_rounds = 2）
> **锁定 SHA：** `7a84b0dff94649fb617761e4e371bf872dd073aa`（已核对 HEAD 一致，工作树干净）
> **Evaluator：** fresh-context 隔离实例（Andy/evaluator-subagent）
> **日期：** 2026-08-04（UTC）
> **结论：** **PARTIAL**（本报告初版判 PASS，后经交叉证据复核**自行改判**，见 §8）
>
> 上一轮 PARTIAL 的唯一遗留项（external vm-v1 launch 路径确定性失败）**已消除**，
> 由本人在锁定 SHA 上发起的**真实 Kimi 端到端 launch** 证实（evaluator 与 generator 两个 persona
> 均 `outcome=RETURNED / terminal_status=completed / nonce 绑定 child receipt / source_changes=[]`）。
>
> **但新发现一项 acceptance 未达成：** acceptance F 要求 planner / generator / evaluator 三个
> persona 均受控可用；实测 **planner persona（`native_agent_type=plan`）确定性失败 4/4**，
> 根因已定位到厂商侧 `PLAN_TOOLS` 无任何写入能力，与 Harness bridge「必须落盘 artifact」的
> 协议契约结构性冲突。详见 §8。

---

## 1. 取证方式声明

全部结论基于磁盘实物与本人实测输出，未采信任何转述（包括 Generator 的 commit message、
session_notes 中的冒烟结论、以及上一轮报告的判定）：

- 自行读取 `progress.json`（含上轮 evaluator_feedback 与 session_notes）、`features.json`、
  `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-spec.md`、
  `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-FIX1-strict-provider-adjudication.md`、
  上轮报告 `BL-NATIVE-SUBAGENT-BRIDGES-reverify-F003-2026-08-04.md`
- 自行阅读 `abf7a6e` 全量 diff 与 HEAD 现状代码（provider / catalog / dispatch-run / runner）
- 自行执行对照实验、突变测试、真实 launch、fail-closed 负例
- **未修改任何产品代码**；工作树新增仅 `scripts/test/`（从 hold 分支还原的上轮探针）与本报告

**L2 边界：** 用户已于 2026-08-04 授权（本机已认证 Kimi 的真实 parent-child bridge probe）。
本轮**实际行使 3 次**真实 launch（evaluator 51s 成功、planner 207s 失败、generator 52s 成功）：
首次为验证上轮遗留阻断项，后两次为响应 F005 OBS-1 交叉证据所必需的 persona 对照实验，
均为最小契约；未读取/复制用户 Kimi wire/session 文件（对 CLI bundle 的检视限于 provider 自己
staged 的只读副本）；报告内所有会话标识、nonce、call id 均以 sha256 摘要形式记录。

---

## 2. 前置核对项（编排者指定，作为证据记录）

### 2.1 目录仍为三角色发布 kimi subagent

未打桩实测 `tool-catalog.py catalog --registry .agents-registry.json`：

| role | 候选（tool, invocation） |
|---|---|
| planner | claude-code a2a/local-cli、codex a2a/local-cli、kimi a2a/local-cli、**kimi subagent** |
| generator | claude-code local-cli、codex local-cli、kimi local-cli、**kimi subagent** |
| evaluator | claude-code a2a/local-cli、codex a2a/local-cli、kimi a2a/local-cli、**kimi subagent** |

Codex **无** subagent 候选（F002 面未回归）。

### 2.2 target provenance 完整（F001 PASS 面未回归）

| role | native_agent_type | agent_type(persona) | execution_provenance_sha256 |
|---|---|---|---|
| planner | `plan` | planner-proposal | `cdc7ff9254fc3e09…` |
| generator | `coder` | generator-restricted | `08dac2538f260457…` |
| evaluator | `explore` | evaluator | `b806e950653e0b05…` |

共同字段：`bridge_id=kimi-acp-native-agent`、`bridge_strategy=session-bridge-v1`、
`bridge_provider_id=harness-vm-v1`、`bridge_provider_kind=vm-v1`、
`bridge_provider_contract_sha256=5b1ccaaa69e4123d…`、`session_scope=same-session`。
三个 provenance 互不相同，且与上一轮记录**逐字一致**——round-2 代码变更未污染 provenance 计算。

### 2.3 项目 ↔ 模板一致性

F003 相关 10 个文件 `.claude/dispatch/**` 与 `framework/templates/claude/dispatch/**` **逐一 IDENTICAL**
（tool-catalog.py、dispatch_common.py、dispatch-run.sh、test-lifecycle.py、test-vm-bridge-provider.py、
transports/{vm-bridge-provider,session-bridge,session_bridge_kimi,vm-bridge-worker}.py、
transports/bridges/kimi-acp-native-agent.json）。

---

## 3. 上轮遗留阻断项的处置核验（本轮重点）

上轮 PARTIAL 的唯一原因：`vm-bridge-provider.py` launch 重解析以 `python3 -I` 调用
带同级导入的 `tool-catalog.py`，必然 `ModuleNotFoundError`，被映射为
`ProviderError: bridge target cannot be re-resolved`，导致 **F003 runner 从未在生产路径上执行过**。

### 3.1 对照实验一：生产 argv 的解释器标志（本人复现）

对**应用包**中的 catalog（生产真实使用的那一份）执行生产 argv，env 收窄为生产的三项：

```
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  /usr/bin/python3 <FLAGS> ~/.tokenizer/app/.../tool-catalog.py target \
  --registry .agents-registry.json --adapters .claude/dispatch/transports/adapters \
  --target-id subagent--kimi--<role>
```

| FLAGS | planner | generator | evaluator | 说明 |
|---|---|---|---|---|
| `-I`（修复前） | exit=1 | exit=1 | exit=1 | `ModuleNotFoundError: No module named 'dispatch_common'`（tool-catalog.py:34） |
| `-E -s`（HEAD，`TARGET_RESOLUTION_PYTHON`） | **exit=0** | **exit=0** | **exit=0** | 输出合法 target JSON |

单一变量翻转，确定性成立。`-E -s` 保留了 `-I` 的环境变量与 user-site 隔离
（`PYTHON*` 变量被忽略、user site-packages 被禁），只放回脚本目录到 `sys.path`——
即恢复同级导入而不放松注入面；且 launch 传入的 env 本身已被固定为 PATH/LANG/LC_ALL 三项。

### 3.2 突变测试：新增回归用例是真守门，而非装饰

`test-vm-bridge-provider.py::test_target_resolution_interpreter_can_run_the_real_catalog`
用**真实 catalog** + 最小 registry 跑生产 argv。我把 provider 副本的
`TARGET_RESOLUTION_PYTHON` 改回 `("/usr/bin/python3", "-I")` 后重跑该用例：

```
mutant (-I) test exit: 1
AssertionError: 1 != 0 : Traceback ... ModuleNotFoundError
FAILED (failures=1)
```

→ 该用例能捕获本次缺陷的回归，堵住了上轮"mock 全绿而生产必炸"的逃逸口。

### 3.3 对照实验二：`dispatch-run.sh` launch 预检（fix #3）

从脚本中**原样抽取**生产预检 python 块并直接执行（同一字节）：

| 版本 | 结果 |
|---|---|
| 修复前（应用包内旧副本） | `exit=2` — 无条件失败（路径双重拼接） |
| HEAD（项目副本） | `exit=0`，打印 `~/.tokenizer/app/framework/templates/claude/dispatch/transports/vm-bridge-provider.py` |

### 3.4 其余三处修复的实证

`write_bytes`（fix #2）、guest staging `chmod a+rX`（fix #4）、`/var/lib/harness-vm-v1{,/jobs}` 711
（fix #5）均属只有在前序修复到位后才可达的链路环节——它们已由 §4 的**真实 launch 成功**
整体证实（若任一未修复，launch 会在 copy-in / worker 启动阶段失败）。

---

## 4. 真实端到端 launch（本人发起，锁定 SHA，L2）

### 4.1 前置状态

```
provider doctor: {"available":true, provider:{id:harness-vm-v1, kind:vm-v1,
                  contract_sha256:5b1ccaaa69e4123d…}}
limactl:         harness-vm-v1  Running
```

### 4.2 执行

以生产 provider 入口（应用包内、`-I` 执行 provider 自身——该文件仅标准库导入，故 `-I` 无害）
发起 evaluator 角色 launch，envelope 为最小只读任务（读 features.json，产出 3 字段 JSON）：

```
/usr/bin/python3 -I ~/.tokenizer/app/.../vm-bridge-provider.py launch \
  --agent subagent--kimi--evaluator --envelope <minimal read-only envelope> \
  --registry $PWD/.agents-registry.json --adapters $PWD/.claude/dispatch/transports/adapters \
  --project-root $PWD --state $PWD/.harness-dispatch/f003-reverify2 \
  --expected-provenance b806e950653e0b05…

launch start 2026-08-04T04:45:04Z → end 04:45:57Z, exit=0, stderr 空
```

### 4.3 run-meta（provider 落盘，与 stdout 逐字节相同）

```
task_id            BL-NSB-F003-reverify2-evalprobe
agent_id           subagent--kimi--evaluator
adapter/family     kimi / kimi
role               evaluator
transport          subagent
ref                7a84b0dff94649fb617761e4e371bf872dd073aa   ← 锁定 SHA
outcome            RETURNED       exit_code 0
duration_s         51             effective_timeout_s 2400
termination_reason completed
source_changes     []             ← 只读角色零源码写入
```

### 4.4 nonce 绑定的 child receipt（VM 内 worker 产出，provider 校验后入 run-meta）

```
bridge_id          kimi-acp-native-agent
bridge_kind        acp-native-agent/v1
bridge_strategy    session-bridge-v1
session_scope      same-session
subagent_type      explore                     ← evaluator persona 的受控原生类型
terminal_status    completed
nonce_sha256                       afbb87d840e9e3e8…
provider_launch_attestation_sha256 38a091e3e623ec88…
session_id_sha256                  062bf7ef68fc3d76…
child_call_id_sha256               5a1baa208bc634ff…
artifact_sha256                    9b2ed2572b3f4b4e…
```

launch attestation（phase=launch）：`nonce_sha256 = afbb87d840e9e3e8…`、
`target_provenance_sha256 = b806e950653e0b05…`（= evaluator target provenance）。

**关键绑定关系（我核对代码 `_validate_bridge_receipt`:1348-1393 后确认）：**
receipt 的 `nonce_sha256` 必须等于 `sha256(本次 launch nonce)`，
`subagent_type` 必须等于 target 的 `native_agent_type`，`terminal_status` 必须为 `completed`，
`provider_launch_attestation_sha256` 与 `artifact_sha256` 亦逐项绑定。
实测三者全部命中，且 receipt 的 nonce 摘要与 launch attestation 的 nonce 摘要**相等**——
即 child 证据锚定在**本次 provider attestation** 上，跨 run 不可重放。

### 4.5 child 确实做了真实工作（非空壳回执）

copy-out 的 artifact 内容：

```json
{ "batch": "BL-NATIVE-SUBAGENT-BRIDGES",
  "feature_count": 5,
  "f003_title": "Kimi ACP 原生 Agent 子代理 bridge" }
```

三个字段均需真实读取锁定 ref 上的 `features.json` 才能得出（含中文标题逐字正确）。
→ 证明 provider-owned worker 内确有真实 Kimi 模型 child 执行了受托任务，
而非仅完成协议握手。

---

## 5. F003 acceptance 逐条判定

acceptance 原文（features.json F003）+ spec §F003：

| # | 验收条款 | 判定 | 本轮证据 |
|---|---|---|---|
| A | runner 通过 ACP `initialize`/`session/new`/`session/prompt` 驱动 **Harness 自有** Kimi 根会话，且在 **provider-owned worker** 中 | **PASS**（evaluator/generator 两 persona 实证；planner 见 F 条） | §4 真实 launch：RETURNED/completed，receipt 带 `session_id_sha256` 与 `session_scope=same-session`；artifact 内容证明真实执行。上轮唯一未达成项本轮达成 |
| B | 严格委派提示含**单次** nonce | **PASS** | 独立探针 `test_generated_root_prompt_binds_exactly_one_nonce` OK；真实 run 的 receipt nonce 摘要 = 本次 launch attestation nonce 摘要 |
| C | 只有 Agent tool_call 的**相同 nonce** + **plan/coder/explore 类型** + **完成事件**三者齐备才接受 | **PASS** | 5 个反例全部 fail-closed（nonce 不符/类型不符/无 completion/无 Agent call/多个 Agent call）；真实 run `subagent_type=explore` 且经 provider 三重绑定校验 |
| D | 不解析或泄露用户 Kimi session wire 文件 | **PASS** | run-meta/receipt 仅含 sha256 摘要；敏感标记扫描（Bearer/access_token/refresh_token/sk-/eyJ/CHILD_PROMPT/harness-child:）**全部未命中**；唯一含 "contract" 的字段是 `contract_sha` |
| E | ACP 或 child 证据不足必须 fail-closed | **PASS** | 协议层 5 例 + 启动层 3 例负测（见 §6） |
| F | 三角色 persona 固定映射且**受控可用**（spec §F003："planner / generator / evaluator 分别使用受控的 plan / coder / explore persona"） | **FAIL** | 映射声明正确（§2.2），但 **planner persona 生产路径确定性失败 4/4**（本人 1/1 + F005 3/3），根因见 §8。generator（coder）与 evaluator（explore）实测可用 |
| G | Generator 修改仅经 source-handoff artifact 返回（spec） | **PASS**（见 §7 残余风险） | `_reconcile_returned_source` 5 个角色语义用例全绿（含 protected path 拒绝、只读角色任何 delta 即拒）；本轮真实 run 为 evaluator 角色，`source_changes=[]` |
| H | worker 不复制/挂载用户 Kimi state；认证与网络仅经 provider broker | **PASS** | 真实 run 的 `copyin.tar.gz` 顶层仅 `.harness-cli-bundle.tar.gz`/`.harness-envelope.json`/`.harness-runner`/`.harness-target.json`/`source`；对 `kimi-code|credentials|.kimi|wire.jsonl|oauth` 的检索**零命中**；worker 凭据为每次运行随机 broker lease |

---

## 6. fail-closed 负例（本轮新增，启动层）

对生产 launch 入口注入错误输入，验证失败点落在**语义校验**而非基础设施故障：

| # | 注入 | 实际输出 | 结论 |
|---|---|---|---|
| N1 | `--expected-provenance` 全 0 | `bridge target provenance drifted` | 漂移检测生效 |
| N2 | envelope role=planner，agent=evaluator target | `bridge target does not allow the envelope role` | 角色越权拒绝 |
| N3 | `--registry` 指向 `agents-registry.example.json` | `bridge registry is not the project registry` | 用户 example registry 不参与发现（D2） |

三例均在触达 VM/模型**之前**拒绝，无资源消耗；且拒绝理由具体、可区分——
与上轮"一律 `bridge target cannot be re-resolved`"的黑箱失败形成对比。

---

## 7. 回归矩阵（本人运行，非采信转述）

| 套件 | 结果 |
|---|---|
| `scripts/test/f003_kimi_acp_bridge_independent.py`（上轮独立探针，真实子进程 ACP peer，16 tests） | **OK**（含诱饵凭据/诱饵 wire/诱饵 env 三重隔离反证） |
| `.claude/dispatch/test-session-bridge-kimi.py` | Ran 18 — OK |
| `.claude/dispatch/test-session-bridge.py` | Ran 9 — OK |
| `.claude/dispatch/test-external-bridge-receipt.py` | Ran 8 — OK |
| `.claude/dispatch/test-vm-bridge-provider.py` | Ran 12 — OK（较上轮 +1，即 §3.2 新守门用例） |
| `.claude/dispatch/test-tool-catalog.py` | Ran 37 — OK |
| `.claude/dispatch/test-lifecycle.py` | OK（skipped=2）— 上轮那条过时断言已收敛，不再报错 |
| `npx vitest run tests/cli/harness-tool-catalog.test.ts` | 73 passed |

---

## 8. 阻断项：planner persona（`plan`）生产路径结构性不可用

> **本节是对本报告初版判定的自我更正。** 初版 §8.2 曾推断"launch 链路修复与角色无关，
> generator/planner 无需真实 launch 即可外推"。F005 复验（reverify2 §7 OBS-1）给出相反实证后，
> 我发起了**自己的**对照实验，**证明我原先的外推是错的**，据此把 F003 由 PASS 改判 PARTIAL。

### 8.1 我的 persona 对照实验（同一主机、同一时间窗口、契约文本完全相同）

planner 探针刻意复用**与我成功的 evaluator 探针逐字相同的 contract 文本**，
仅 `role` / persona / artifact 路径 / task_id 不同：

| # | role / native persona | 起止（UTC） | exit | 结果 |
|---|---|---|---|---|
| 我的 probe A | evaluator / `explore` | 04:45:04 → 04:45:57 (51s) | **0** | RETURNED / completed |
| 我的 probe B | **planner / `plan`** | 05:27:11 → 05:30:38 (207s) | **2** | `VM restricted provider unit failed` |
| 我的 probe C | generator / `coder` | 05:31:22 → 05:32:16 (54s) | **0** | RETURNED / completed，`subagent_type=coder`，nonce 绑定，`source_changes=[]`，artifact `{"probe": true}` |

probe C 在 probe B 失败**44 秒后**启动并成功 → 主机、VM、provider、凭据在该窗口均健康，
失败不可归因于环境退化。合并 F005 的 3 次 planner 失败：**planner 4/4 失败，
generator 1/1 成功，evaluator 3/3 成功（我 1 + F005 2）**。

### 8.2 根因（厂商侧证据，非推测）

只读检视 provider 自己 staged 的 CLI bundle
（`~/.tokenizer/harness/vm-v1/bundles/kimi-0.31.0-linux-arm64.tar.gz`，非用户凭据/会话文件）：

```
PLAN_TOOLS    = [ Read, ReadMediaFile, Glob, Grep, WebSearch, FetchURL ]
EXPLORE_TOOLS = [ Bash, Read, ReadMediaFile, Glob, Grep, WebSearch, FetchURL ]
CODER_TOOLS   = [ Agent, AgentSwarm, Bash, …, Edit, …, Write, mcp__* ]

registerAgentProfile({ name: "plan",
  description: "Read-only implementation planning and architecture design.", tools: PLAN_TOOLS … })
PLAN_ROLE 提示词："…do not attempt to run commands or modify files.
                   Your deliverable is the plan itself, returned as your final message."
registerAgentProfile({ name: "coder",
  description: "…the only subagent type with file-editing tools…" })
```

而 Harness bridge 协议**强制每个角色都必须把交付物落盘**：
`session-bridge.py:289-291`

```python
artifact = _artifact_path(worktree, envelope)
if not artifact.is_file():
    raise SessionBridgeError("bridge completed without the commissioned artifact")
```

**因果链闭合：** `plan` profile 既无 `Write`/`Edit` 也无 `Bash`，**结构上无法创建任何文件**
→ child 依设计把方案作为"最终消息"返回、不落盘 → guest 内 runner 抛
`bridge completed without the commissioned artifact` → worker unit 非零退出 →
provider 报 `VM restricted provider unit failed`（provider 按设计不外泄 guest stdout/stderr，
故 host 侧只见此通用错误）。

这条链同时解释了全部四项观测，且每项都是它的**预测**而非事后附会：

1. 为什么 F005 把契约压缩到只写 `{"probe": true}`（probe_5）仍失败 —— 写入本身才是不可达的动作，与任务复杂度无关；
2. 为什么 `explore` 虽被描述为 "read-only" 却能成功 —— 它的只读是**提示词层**的，`EXPLORE_TOOLS` 含 `Bash`，故实际可落盘（我的 probe A 确实产出了文件）；
3. 为什么 `coder` 成功 —— 厂商明示它是唯一带文件编辑工具的 subagent；
4. 为什么 planner 失败耗时（71–207s）普遍长于成功运行（51–54s）—— child 正常跑完并产出方案文本，失败发生在其后的落盘校验环节。

**这不是环境问题、不是 flake、也不是本机特有**：任何主机上 `plan` persona 都不可能满足该契约。

### 8.3 对 F003 的影响

- spec §F003 与 features.json F003 均明文要求三个 persona **受控可用**；planner 路由
  由 F001 目录**已发布为可选候选**（§2.1 三角色均在列），但生产路径 100% 失败。
- 用户可见后果：人类若为 Planner 签发 Kimi bridge，会**跑满一次 wall-clock（本次 207s，
  最坏可至 timeout 2400s）后才失败**，且 host 侧只得到通用错误，无法自助定位。
- 修复方向（**由 Planner 裁量，我不改产品代码**）三选一：
  (a) 把 planner 的 `native_agent_type` 改为具备写入能力的 profile（如 `coder` + 只读提示词约束，
      与 `explore` 的现行做法一致）；
  (b) 为 `plan` 增加"最终消息即交付物"的落盘适配（由 runner 把 child 最终消息写成 artifact），
      但需重新评估其对 D3 证据标准与 artifact 摘要绑定的影响；
  (c) 从 bridge manifest 的 `personas` / `native_agent_types` 中**下架 planner**，
      让目录只发布 generator/evaluator 两角色，F001/F004 的三角色口径同步收敛。

---

## 9. 非阻断观察（供 Planner / F005 裁量）

1. **应用包 `dispatch-run.sh` 未同步（分发链缺口）。**
   `~/.tokenizer/app/framework/templates/claude/dispatch/dispatch-run.sh`（mtime Aug 2 09:32）
   仍是**修复前**版本，与 HEAD 内容不同；同目录的 `tool-catalog.py` / provider 等运行时文件
   已同步（逐字节匹配 HEAD）。
   - **对 F003 无影响**：生产 launch 入口是**项目内**的 `.claude/dispatch/dispatch-run.sh`（已修复），
     且预检的 mirror 必比清单（6 个文件）不含 `dispatch-run.sh`；本轮真实 launch 成功即为实证。
   - **风险**：若日后由该应用包分发/覆盖项目 dispatch 文件，会把 exit-2 预检重新带回项目。
     建议在部署/安装 Agent 更新时一并同步，或把 `dispatch-run.sh` 纳入 mirror 必比清单。
   - 该事实与 session_notes 中"应用包已同步至 abf7a6e 等效字节"的表述不完全相符，据实记录。
2. ~~Generator 角色的真实 launch 本轮未行使；launch 链路修复与角色无关~~
   **（本条已作废并被 §8 取代。）** 该推断在本报告初版中作出，事后被我自己的 persona 对照实验
   证伪：launch 链路的**基础设施**部分确与角色无关，但 **persona 能力**与角色强相关，
   不能外推。generator 角色已于本轮补做真实 launch（§8.1 probe C，成功）。
   **教训（建议沉淀）：** 对"角色/persona 维度"的可用性结论，不得由单一角色的成功外推——
   每个已发布的角色都应有至少一次真实路径实证。
3. **凭据 TTL ≈ 15 分钟仍会造成目录可见性抖动**（上轮 §7.1 观察依旧成立，属 fail-closed 设计）。
   本轮 launch 耗时 51s，远小于 TTL，未触发。
4. **`sandbox.env_set.KIMI_CODE_HOME=~/.kimi-code` 惰性继承字段仍在**（上轮 §7.2）。
   provider 全文不引用 `env_set`/`sandbox`，对 bridge 路径无效；建议后续批次剥离以免误读。

---

## 10. 结论

**F003 = PARTIAL。**

**已达成：**

- acceptance **A / B / C / D / E / G / H 七条达成**。其中 A（在 provider-owned worker 中驱动
  Harness 自有 Kimi 根会话）由本人在锁定 SHA 上发起的**两次**真实端到端 launch 证实
  （evaluator/`explore` 51s、generator/`coder` 52s），均为 `RETURNED / completed /
  nonce 绑定 child receipt / source_changes=[]`，且 child 产出的 artifact 内容需真实读取
  锁定 ref 的仓库文件才能得出。
- 上一轮 PARTIAL 的**唯一遗留项**（launch 重解析 isolated-mode 确定性失败）**已彻底消除**：
  `-I → -E -s` 单变量对照双向验证，配套回归用例经突变测试确认为真守门；
  `dispatch-run.sh` 预检由确定性 exit=2 转为 exit=0。
- 上轮已解决的三点（三角色发布、receipt 含 nonce/类型、不复制用户凭据）**未回归**，
  provenance 摘要与上轮逐字一致；启动层 3 个 fail-closed 负例通过；
  协议层 16 项独立探针与 6 套框架回归、vitest 73 全绿。

**未达成（阻断）：**

- acceptance **F**（三 persona 受控可用）不成立：**planner / `plan` persona 生产路径
  确定性失败 4/4**（本人 1 + F005 3），根因为厂商 `PLAN_TOOLS` 无任何写入能力，
  与 Harness bridge 强制落盘 artifact 的协议契约结构性冲突（§8.2 因果链闭合，
  可解释并预测全部四项观测）。目录仍把该路由发布为可选候选，人类签发后会跑满
  wall-clock 才失败。

**判定理由：** F003 的 runner 主体、协议层证据标准、隔离与 fail-closed 均已充分验证，
且三分之二的已发布 persona 端到端可用，故不判 FAIL；但 acceptance 明文要求的三 persona
受控可用有一条在生产路径上不可达，故不能判 PASS。修复应落在 persona 映射或交付物协议
（§8.3 三选一），F003 的 ACP runner 代码本身无需改动。

**与初版判定的差异说明：** 本报告初版判 PASS，其依据之一是"launch 链路修复与角色无关"的
外推。F005 的 OBS-1 提供了相反实证后，我发起自己的对照实验证伪了该外推，并据此改判。
改判由证据驱动，不受任何进度压力影响。

**未修改任何产品代码。** 工作树新增：`scripts/test/f003_kimi_acp_bridge_independent.py`、
`scripts/test/f003_bridge_publication_probe.py`（自 `evaluator-artifacts-hold` 分支还原）与本报告；
未执行任何 `git add` / `commit` / `push`。
真实 run 的证据留存于 `.harness-dispatch/f003-reverify2/run-meta-BL-NSB-F003-reverify2-evalprobe.json`
与 provider 私有 run 目录 `~/.tokenizer/harness/vm-v1/runs/BL-NSB-F003-reverify2-evalprobe-137f3a8352de0f15d058abcf/`。
