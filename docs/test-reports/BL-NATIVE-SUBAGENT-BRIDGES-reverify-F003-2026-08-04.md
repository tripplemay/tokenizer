# BL-NATIVE-SUBAGENT-BRIDGES · F003 复验报告

> **Feature：** F003 — Kimi ACP 原生 Agent 子代理 bridge
> **阶段：** reverifying（fix_rounds = 1）
> **锁定 SHA：** `172ed42b5c4d910c7f194a6fab835c8ac74f19e7`（已核对 HEAD 一致，工作树干净）
> **Evaluator：** fresh-context 隔离 subagent（Andy/evaluator-subagent）
> **日期：** 2026-08-04（UTC）
> **结论：** **PARTIAL**
>
> 协议层验收条款（A–H）逐条实测通过；但生产启动路径存在确定性缺陷，
> 导致 F003 runner **在其规定的 provider-owned worker 中从未真正执行过**。详见 §6。

---

## 1. 取证方式声明

本报告的全部结论基于磁盘实物与实测输出，未采信任何转述：

- 自行读取 `progress.json`（含上轮 evaluator_feedback）、`features.json`、
  `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-spec.md`、
  `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-FIX1-strict-provider-adjudication.md`
- 通读 F003 实现主体：`transports/session_bridge_kimi.py`、`transports/session-bridge.py`、
  `transports/vm-bridge-provider.py`、`transports/vm-bridge-worker.py`、
  `transports/bridges/kimi-acp-native-agent.json`
- **未复用 Generator 的既有 fixture**，另写两份独立探针（见 §5）
- 未修改任何产品代码；新增文件仅限 `scripts/test/`

**L2 边界：** 用户已于 2026-08-04 授权 L2。按编排约定，真实 Kimi parent-child probe 属 F005 执行者职责，
本次复验**未发起真实 Kimi 模型调用**；F003 以代码事实 + 聚焦实测判定。

---

## 2. 上轮三个 FAIL 点的处置核验

| # | 上轮 FAIL 描述 | 本轮实测 | 处置 |
|---|---|---|---|
| 1 | Kimi subagent bridge 被设为 dormant，运行入口无条件拒绝，无法形成可用 bridge | 目录**已发布**三角色 kimi subagent（未打桩实测，§4）；`sandbox-profile.sh` 的拒绝是设计意图（真实路径为 `dispatch-run.sh` → vm-v1 provider），非死路 | **已解决** |
| 2 | 持久化 receipt 缺 nonce 标识与子代理类型 | receipt 含 `nonce_sha256` + `subagent_type`，并在 driver / run_bridge / provider 三层各自校验 | **已解决** |
| 3 | driver 复制用户 `KIMI_CODE_HOME` 凭据状态 | 复制逻辑已移除；worker env 由 provider 白名单构造，`KIMI_CODE_HOME` 必须为空目录，运行后删除 | **已解决** |

### 2.1 关于 #1 的关键澄清（本轮最重要的取证）

上轮把「bridge 不可见」判为实现缺陷。本轮实测证明这是**凭据 TTL 驱动的 fail-closed**，不是结构性禁用：

```
# 首次运行（03:05 UTC）
$ python3 .claude/dispatch/transports/vm-bridge-provider.py doctor
{"available":false,"reason":"Kimi OAuth credential expires too soon"}

# 凭据实际状态（未打印 token）
expires_at 2026-08-04T03:01:22Z / now 03:05:09Z → seconds_remaining: -228
```

`catalog_attestation()` 中 `_read_broker_credential()` 是**第一个**检查项，因此 doctor 的
reason 会掩盖后续检查是否健康。我绕过该遮蔽，直接跑其余检查（只读，无 Kimi API 调用）：

```
load_provider_configuration : OK  (contract/image/cli_bundle/broker_policy 四个摘要均解析)
_bundle_protocol_commands   : OK  {'acp-native-agent/v1': ('kimi', 'acp')}
_assert_vm_ready            : OK          ← ff896dd 修复的 limactl HOME 根因确已消除
_runner_sha256              : OK  9ca31126cc29dba1...
_broker_policy              : OK  guest_host=192.168.5.2  cred_kind=kimi-code-oauth-file-v1
```

即：**唯一阻断项就是过期 access token**。随后凭据被刷新（F005 并行作业所致），
同一条未打桩命令立即翻转为发布态（§4），双向验证了该门是活的。

---

## 3. F003 acceptance 逐条判定

acceptance 原文（features.json F003）与 spec §F003 合并核验：

| # | 验收条款 | 判定 | 证据 |
|---|---|---|---|
| A | runner 通过 ACP `initialize` / `session/new` / `session/prompt` 驱动 Harness 自有 Kimi 根会话 | **PASS** | 独立探针以**真实子进程** ACP peer 跑通全链路；`session/new` 建立 Harness 自有 session 并校验 `protocolVersion==1`、`sessionId` 合法；另发 `session/set_config_option(mode=auto)` |
| B | 严格委派提示含**单次** nonce | **PASS** | `_native_root_prompt` 中 `harness-child:{nonce}` 在 prompt 内**恰好出现 1 次**（断言）；nonce 由 provider 每次启动 `secrets.token_hex(16)` 新生成，driver 以 `^[0-9a-f]{32}$` 强校验 |
| C | 只有 Agent tool_call 的**相同 nonce** + **plan/coder/explore 类型** + **完成事件**三者齐备才接受 | **PASS** | 五种反例全部 fail-closed：nonce 不符 / 类型不符 / 无 completion / 无 Agent call / 多于一个 Agent call |
| D | 不得解析或泄露用户 Kimi session wire 文件 | **PASS** | 代码中无任何 wire/session 文件读取（仅注释提及）；receipt 只含 sha256 摘要；探针断言 receipt 不含原始 sessionId、nonce、callId、模型文本 |
| E | ACP 或 child 证据不足必须 fail-closed | **PASS** | ACP error 响应、反向权限请求（reverse RPC）、畸形 nonce、越界 env key、缺 worker state root 均抛 `KimiBridgeError` |
| F | 三角色 persona 固定映射（spec） | **PASS** | manifest + 实测 target：planner→plan / generator→coder / evaluator→explore；persona 为 planner-proposal / generator-restricted / evaluator |
| G | Generator 修改仅经 source-handoff artifact 返回（spec） | **PASS** | `run_bridge` 强制 artifact 存在、拒符号链接/硬链接、算 `artifact_sha256`；provider 侧 `_reconcile_returned_source` 按 role 收敛并记 `source_changes`，摘要与 receipt 绑定校验 |
| H | worker 不复制/挂载用户 Kimi state；认证与网络仅经 provider broker（spec） | **PASS** | 见 §3.1 |

### 3.1 凭据与网络隔离（H 条，本轮重点复核）

三层证据链一致：

1. **host provider**：`_read_broker_credential()` 把真实 OAuth token 读进**宿主进程内存**，
   注入 `_BrokerServer`，从不写入 attestation/receipt/日志（探针断言 attestation 不含桩 token）。
2. **guest worker env**（`vm-bridge-worker.py:260-267`）：
   `KIMI_MODEL_API_KEY` = **每次运行随机 broker lease**（`secrets.token_urlsafe(48)`），
   `KIMI_MODEL_BASE_URL` = broker 端点；**宿主 OAuth token 从不入 VM**。
   `KIMI_CODE_HOME` = `state_root/kimi-code`（guest 内新建目录）。
3. **driver**（`session_bridge_kimi.py:71-127`）：拒绝任何白名单外 key，
   `KIMI_CODE_HOME` 必须绝对路径、非符号链接、位于 worker state root 内、**启动时为空**，
   运行后 `_remove_ephemeral_kimi_state` 删除并校验删净。

**对抗性核查（我主动找的洞）：** 解析出的 subagent target 里带着
`sandbox.env_set.KIMI_CODE_HOME = "~/.kimi-code"`（继承自 local-cli adapter）。
核实结论：`vm-bridge-provider.py` 全文**不引用** `env_set` / `sandbox`，
guest 环境由 `provider_environment()` 从零构造；该字段对 bridge 路径**完全惰性**，
仅对 local-cli 路径生效。非缺陷，但见 §6 建议。

---

## 4. 未打桩实测输出（credential 刷新后）

```
$ python3 .claude/dispatch/tool-catalog.py catalog --registry .agents-registry.json
planner   [('kimi', 'subagent')]
generator [('kimi', 'subagent')]
evaluator [('kimi', 'subagent')]
```

三个 target 均解析成功，携带完整 bridge provenance：

| role | native_agent_type | agent_type(persona) | execution_provenance_sha256 |
|---|---|---|---|
| planner | `plan` | planner-proposal | `cdc7ff9254fc3e09…` |
| generator | `coder` | generator-restricted | `08dac2538f260457…` |
| evaluator | `explore` | evaluator | `b806e950653e0b05…` |

共同字段：`bridge_id=kimi-acp-native-agent`、`bridge_strategy=session-bridge-v1`、
`bridge_provider_id=harness-vm-v1`、`bridge_provider_kind=vm-v1`、
`bridge_provider_contract_sha256=5b1ccaaa69e4123d…`、`session_scope=same-session`。
三个角色的 `execution_provenance_sha256` 互不相同（按角色语义绑定）。

---

## 5. 独立探针（本次新增，非复用 Generator fixture）

### 5.1 `scripts/test/f003_kimi_acp_bridge_independent.py` — 16 tests, **全部 OK**

刻意不 mock `popen`，而是**真起一个 JSON-RPC ACP peer 子进程**，从 Popen、env 构造、
流解析一路走到进程组回收：

```
test_happy_path_returns_nonce_bound_receipt_without_model_text ... ok
test_all_three_manifest_personas_are_accepted ................. ok
test_unpublished_subagent_type_is_rejected .................... ok
test_nonce_mismatch_fails_closed .............................. ok
test_type_mismatch_fails_closed ............................... ok
test_missing_completion_fails_closed .......................... ok
test_absent_agent_call_fails_closed ........................... ok
test_more_than_one_agent_call_fails_closed .................... ok
test_acp_error_fails_closed ................................... ok
test_reverse_permission_request_fails_closed .................. ok
test_malformed_nonce_is_rejected_before_spawn ................. ok
test_worker_never_sees_host_kimi_home_credentials_or_wire ..... ok
test_worker_env_outside_allowlist_is_rejected ................. ok
test_missing_provider_worker_state_root_is_rejected ........... ok
test_ephemeral_worker_state_is_removed_after_the_run .......... ok
test_generated_root_prompt_binds_exactly_one_nonce ............ ok
Ran 16 tests — OK
```

其中隔离用例布了**诱饵**：宿主 `KIMI_CODE_HOME` 内放
`credentials/kimi-code.json`（含 `HOST_TOKEN_MUST_NOT_LEAK`）与
`sessions/wire.jsonl`（含 `HOST_WIRE_MUST_NOT_LEAK`），另设宿主环境变量
`HOST_ONLY_SECRET`。子进程实测所见：`KIMI_CODE_HOME` 指向 worker state root 下的
**空**私有目录，三个诱饵串在子进程 env 中**均不出现**。

### 5.2 `scripts/test/f003_bridge_publication_probe.py` — 发布路径可达性探针

用**真实** provider 配置（真 contract/image/bundle 摘要 + 真 `_assert_vm_ready`）产出 attestation，
只打桩那个当时已过期的 `_read_broker_credential`，再交由 tool-catalog **自身未修改的**解析校验链消费。
结果：解析通过 → 三角色发布 → target 带完整 provenance。据此排除「结构性 dormant」假设。

### 5.3 既有回归（我自行运行，非采信转述）

```
.claude/dispatch/test-session-bridge-kimi.py     Ran 18 tests  OK
.claude/dispatch/test-session-bridge.py          Ran  9 tests  OK
.claude/dispatch/test-external-bridge-receipt.py Ran  8 tests  OK
.claude/dispatch/test-vm-bridge-provider.py      Ran 11 tests  OK
.claude/dispatch/test-tool-catalog.py            Ran 37 tests  OK
npx vitest run tests/cli/harness-tool-catalog.test.ts   73 passed
```

上轮报告指出「相关用例明确断言 bridge 默认隐藏」——本轮核实该断言已演进为
`test_acp_bridge_is_hidden_by_default_but_auto_discovers_roles_after_provider_attestation`：
既验证无 provider 时隐藏，也验证 attested 后自动展开，且用的是通用 `future-cli` 而非 kimi 特判。

### 5.4 模板/项目一致性

F003 相关 7 个文件 `.claude/dispatch/**` 与 `framework/templates/claude/dispatch/**` **逐一 IDENTICAL**
（session_bridge_kimi.py、session-bridge.py、vm-bridge-provider.py、vm-bridge-worker.py、
kimi-acp-native-agent.json、tool-catalog.py、validate-external-bridge-receipt.py）。

---

## 6. 阻断缺陷：external vm-v1 bridge 启动路径确定性失败

> 本节结论由我**自行复现**得出（非采信 F005 报告转述）。发现契机：复验末期
> `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F005-probe-audit-2026-08-04.json` 落盘，
> 其 root_cause 指向启动路径；我随即独立跑了对照实验加以证实。

### 6.1 现象

F003 runner 的唯一生产入口是
`dispatch-run.sh`（external-vm-v1 分支）→ `exec vm-bridge-provider.py launch`。
launch 会先重新解析 target（`vm-bridge-provider.py:1798-1823`）：

```python
subprocess.run(
    ["/usr/bin/python3", "-I", str(catalog), "target", "--registry", ..., "--target-id", ...],
    env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}, ...)
...
if resolved.returncode != 0:
    raise ProviderError("bridge target cannot be re-resolved")
```

`-I`（isolated mode）会把脚本自身目录移出 `sys.path`，而 `tool-catalog.py:34` 是
模块级同级导入 `from dispatch_common import (...)`，于是必然 ModuleNotFoundError。

### 6.2 我的对照实验（同一 registry、同一 target、凭据新鲜、doctor available=true）

```
$ /usr/bin/python3 -I ~/.tokenizer/app/.claude/dispatch/tool-catalog.py target \
    --registry .agents-registry.json --adapters .claude/dispatch/transports/adapters \
    --target-id subagent--kimi--evaluator
exit=1
ModuleNotFoundError: No module named 'dispatch_common'

$ /usr/bin/python3 (无 -I) …同样参数…
exit=0
target_id: subagent--kimi--evaluator
execution_provenance_sha256: b806e950653e0b05...
```

变量仅 `-I` 一项，结果确定性翻转 → 失败**完全归因于 isolated-mode sys.path**，
与凭据、registry 漂移、attestation TTL 无关。

**不对称性说明（为何 catalog 阶段没暴露）：** catalog 探测走
`["/usr/bin/python3", "-I", str(provider), "catalog-attest"]`，调用的是
`vm-bridge-provider.py` 自身——该文件**无同级导入**（仅标准库），故 `-I` 无害。
缺陷只在「以 `-I` 调用带同级导入的 `tool-catalog.py`」时触发，因此目录发布正常、启动必炸。

### 6.3 对 F003 的影响

- 每次 external bridge 启动都在**接触 Kimi ACP 之前**失败（`ProviderError: bridge target cannot be re-resolved`）；
- 因此 spec §F003 第一条「runner **在 provider-owned worker 中**用 ACP 管理 Harness 自有 session」
  在本机**无法被证实**——F003 runner 迄今只在我的合成探针与单元 fixture 中执行过，
  从未经由产品路径驱动过一次真实 Kimi 根会话；
- 上一轮 F003 FAIL 的核心用户可见症状（「无法形成可用的 F003 bridge」）**尚未真正消除**，
  只是阻断点从「目录隐藏」转移到了「启动重解析」。

### 6.4 修复归属建议（Planner 裁量，我不改产品代码）

缺陷位于 `vm-bridge-provider.py`（provider 基础设施），**不在** F003 的 runner 主体
（`session_bridge_kimi.py` / `session-bridge.py` 经全面验证为正确）。可选方向：
去掉该处 `-I`；或为子进程设 `PYTHONPATH` 指向 bundle dispatch 目录；
或把 `tool-catalog.py` 的同级导入改为可在 isolated mode 下工作的形式。
需注意 `-I` 原意是防环境变量注入，去掉前应确认 env 已被显式收窄（当前已固定为三项）。

---

## 7. 非阻断观察

1. **凭据 TTL ≈ 15 分钟导致 bridge 可见性抖动。** 目录发布与否取决于探测那一刻 token 是否
   还有 >60s 寿命。行为符合 fail-closed 设计，但对使用者表现为「时有时无」。
   建议（供 Planner 裁量，勿在本批次改）：doctor/目录在因凭据过期而隐藏时给出可区分提示，
   与「provider 缺失」「VM 未就绪」区分开，避免后续再被误判为实现缺陷。
2. **subagent target 内 `sandbox.env_set.KIMI_CODE_HOME=~/.kimi-code` 属惰性继承字段**（§3.1）。
   当前无安全影响，但字面上与「worker 不挂载用户 Kimi state」相冲突，易引起后续误读。
   建议后续批次在 bridge target 解析时剥离 local-cli 专用 sandbox 字段。
3. **真实 parent-child receipt 尚未存在**（`~/.tokenizer/harness/vm-v1/runs/` 无 run-meta）。
   F003 的 receipt **结构**已在三层代码与探针中验证满足 nonce/类型/fail-closed 要求；
   真实回执的**内容**校验因 §6 缺陷而无法进行。
4. **`test-lifecycle.py` 出现凭据敏感的脆弱断言。**
   `test_sandbox_rejects_external_same_session_target_before_creating_runtime` 断言
   stderr 含 `target id is not registered`，但凭据新鲜时 target 已注册，实际返回
   `[sandbox] ⛔ external same-session bridge does not launch here…`。
   两种输出**都是 fail-closed**，测试意图（不得走旧 Seatbelt 路径）仍满足，
   属断言与环境耦合的脆弱用例，非产品缺陷。建议后续改为断言「被拒绝」而非具体文案。

---

## 8. 结论

**F003 = PARTIAL。**

**已达成（协议层，全部实测通过）：**

- acceptance A–H 八条逐条验证通过，其中 nonce 单次绑定、nonce+类型+completion 三重接受条件、
  ACP 错误 / 反向权限请求 / 证据不足的 fail-closed，均由**真实子进程级**独立探针（16 tests）证实；
- 上轮 FAIL 点 #2（receipt 缺 nonce/类型）、#3（复制用户凭据状态）**确已修复**，
  并以诱饵凭据 + 诱饵 wire + 诱饵环境变量三重反证隔离有效；
- 上轮 FAIL 点 #1 的「目录隐藏」部分已澄清为凭据 TTL 驱动的正确 fail-closed，
  凭据新鲜时三角色正常发布且 target 携带完整 bridge provenance 与 execution_provenance_sha256。

**未达成（阻断项）：**

- spec §F003 要求 runner **在 provider-owned worker 中**驱动 Harness 自有 Kimi 根会话。
  受 §6 缺陷（launch 重解析在 isolated mode 下必然 ModuleNotFoundError）影响，
  该路径在本机**确定性失败于接触 ACP 之前**，无法证实；
- 亦即上轮「无法形成可用 F003 bridge」的症状尚未真正消除，阻断点仅发生位移。

**判定理由：** F003 runner 主体实现正确且证据充分，故不判 FAIL；但其核心验收动作
（驱动真实 Kimi 根会话）在产品路径上不可达，故不能判 PASS。修复应落在
`vm-bridge-provider.py` 的 launch 重解析（§6.4），F003 runner 代码本身无需改动。

**未修改任何产品代码**；新增产物仅 `scripts/test/` 下两份探针与本报告。
