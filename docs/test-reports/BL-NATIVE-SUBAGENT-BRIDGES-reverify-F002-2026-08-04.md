# BL-NATIVE-SUBAGENT-BRIDGES · F002 复验报告（reverify round 1）

| 项 | 值 |
|---|---|
| **Feature** | F002 — Codex local-cli 保持与 external bridge 禁止 |
| **批次** | BL-NATIVE-SUBAGENT-BRIDGES（reverifying, fix_rounds=1） |
| **锁定 SHA** | `172ed42b5c4d910c7f194a6fab835c8ac74f19e7`（已确认 HEAD 一致，tracked 文件零改动） |
| **验收日期** | 2026-08-04 |
| **执行者** | Evaluator（fresh context / 隔离上下文） |
| **结论** | **PASS** |
| **L2 授权** | 已授权（2026-08-04）；本报告执行 Codex **local-cli health** 部分，未执行任何 Codex child-bridge probe（符合 FIX1 §4 #4 canonical 口径） |

---

## 1. 复验目标与关键回归风险

F002 上一轮为 PASS。本轮的唯一问题是：**修复轮之后 PASS 是否仍成立**。

修复轮（`c5fe6be` + `ff896dd`）修好了 vm-v1 provider 的 limactl `HOME` 缺失问题。此前**所有** runtime 都被误判 not running，导致 external bridge 对**所有**工具永久隐藏。这带来一个具体的回归风险：

> 目录闸门一旦真正打开，Codex 会不会随 Kimi 一起被发布为 external subagent？

因此本轮不接受"当前目录里看不到 Codex bridge"这种**弱证据**——在 provider 不可用时，所有工具都看不到 bridge，Codex 的缺席无法与全局 fail-closed 区分。本报告用**差分实验**消除这一歧义。

### 1.1 本机环境实况（重要）

```
$ python3 .claude/dispatch/transports/vm-bridge-provider.py doctor
{"available":false,"reason":"Kimi OAuth credential expires too soon"}

$ limactl list
harness-vm-v1    Running    127.0.0.1:58659    2    4GiB    20GiB
```

VM 在跑，但 provider 因 **Kimi OAuth 凭据临近过期**而 attest 失败 → 当前 live catalog 中**所有**工具的 subagent 候选均为 0（含 Kimi）。这属于 F001/F003/F005 的范畴，不构成 F002 的判据；但它正是必须做差分实验的原因。

---

## 2. 逐条验收（spec §F002 三条 + features.json 原文）

### 验收 1 — Codex 继续使用 verified adapter / sandbox / 凭据隔离 / timeout 执行 local-cli

**PASS。**

三角色 target 全部解析成功，携带完整执行契约且**无任何 bridge 字段**：

```
$ python3 .claude/dispatch/tool-catalog.py target --registry .agents-registry.json \
    --target-id local-cli--codex--generator
{"adapter": "codex",
 "adapter_execution_contract_sha256": "e95fb9306e51b5284398d56f80472f6c6ed76691eac70e017230206f47adc5c4",
 "execution_provenance_sha256": "2f56f3956aaea30c3fe23aa441f45b1534935529cd262fbc41dee45f0909d53d",
 "sandbox": {"env_allow": [], "env_set": {"CODEX_HOME": "~/.codex"},
             "home_dir": "~/.harness-sandbox/codex"},
 "timeout_s": 2400, "invocation": "local-cli", "model_family": "codex", ...}
```

| 检查项 | planner | generator | evaluator |
|---|---|---|---|
| `adapter=codex` + contract sha | ✅ | ✅ | ✅ |
| `execution_provenance_sha256`（每角色互异） | ✅ | ✅ | ✅ |
| `timeout_s=2400` | ✅ | ✅ | ✅ |
| 专用 `home_dir=~/.harness-sandbox/codex` | ✅ | ✅ | ✅ |
| `CODEX_HOME=~/.codex`（只投喂凭据目录） | ✅ | ✅ | ✅ |
| `env_allow=[]`（宿主环境零透传） | ✅ | ✅ | ✅ |
| 无 bridge provenance 字段 | ✅ | ✅ | ✅ |

adapter `.claude/dispatch/transports/adapters/codex.json` 保持 `_verified: true`，argv 固定
`codex exec --json --ephemeral -C {{worktree}} -s workspace-write -`（显式 `-s` 覆盖用户 config，
防 `danger-full-access` 静默削弱沙箱）。

**[L2] 真实 local-cli health（已授权）**：本机 `codex-cli 0.146.0`，`~/.codex/auth.json` 存在。

```
$ python3 .claude/dispatch/process-timeout.py --timeout 180 -- \
    codex exec --json --ephemeral -C <isolated-git-repo> -s read-only -
exit=0   status={"reason": "process_exit", "exit_code": 0}
events: thread.started → turn.started → item.completed → turn.completed   （stderr 空）
```

Codex local-cli 路径**真实可用、凭据有效、timeout 机件正常收敛**。未运行任何 child-bridge probe。

### 验收 2 — Codex 不声明 external subagent bridge；catalog / report / 签发页面 / 模式快照均不显示 Codex bridge provenance

**PASS。**

**(a) 声明层**：`.agents-registry.json` 中 codex integration **无 `subagent` 键**（只有 `local_cli`）。
`tool-catalog.py:1253` 只把 `integration.subagent is not None` 的 integration 放入
`pending_external_bridges` → Codex 结构上无法进入 bridge 发布路径。
磁盘上 bridge manifest 目录只有 `kimi-acp-native-agent.json`，**无任何 Codex manifest**。

**(b) 差分实验（本轮核心证据）** — `scripts/test/f002_codex_bridge_exclusion.py`：

| 条件 | kimi subagent 候选 | codex subagent 候选 | claude-code（legacy `subagent:true`） |
|---|---|---|---|
| provider **不可用**（本机实况） | 0 | **0** | 0 |
| provider **已 attest**（patch 框架 hook） | **3** | **0** | 0 |

第二行是关键：闸门**真正打开**（Kimi 如期发布 planner/generator/evaluator 三个候选），
Codex **依然是 0**。这证明 Codex 的排除是**声明驱动的结构性排除**，而非被全局 fail-closed 掩盖。
同时 claude-code 的 legacy `subagent: true` 未被提升为 v2 external bridge（`tool-catalog.py:1160-1169`），
符合 spec "legacy Coordinator-native Claude 路径保持兼容，但不被误路由为 external bridge"。

**(c) target 解析**：三个 `subagent--codex--{role}` 全部 `exit 2` +
`target id is not registered`。

**(d) 设备目录镜像**（`scripts/test/f002_codex_device_mirror.ts`）：codex 5 条目
（3 local-cli + 2 a2a，A2A 为 registry 独立配置，spec 明确允许），**subagent 0 条**，
所有条目 bridge provenance 字段为空；integration inventory 中 `codex.subagent === false`。

**(e) 模式快照**（`scripts/test/f002_codex_mode_snapshot.ts`）：`buildModeSnapshot()` 产出的
`dispatch.toolCatalog` 15 条，codex 5 条全部 `bridgeId/sessionScope/bridgeKind/bridgeProtocol` 为空，
codex subagent 0 条。

**(f) 签发路径**（`scripts/test/f002_codex_issuance_refusal.ts`）：

```
控制组：kimi(local-cli) generator + codex(local-cli) evaluator → accepted   ← 证明 payload 形状合法
codex+subagent as generator → {"code":"unknown_tool","message":"tool codex cannot be invoked as subagent for generator"}
codex+subagent as evaluator → {"code":"unknown_tool", ... "for evaluator"}
codex+subagent as planner   → {"code":"unknown_tool", ... "for planner"}
```

先跑控制组再判拒绝，避免"因 payload 写错而假性拒绝"的误判（首次尝试即因缺字段被
`invalid_timestamp` / `missing_key` 拒绝，已修正后重测）。Codex local-cli 仍**可签发**——
说明这是精确禁止 bridge，而非把 Codex 整体禁用。

**(g) 无工具名特判**：`src/shared/harness-tool-catalog.ts`、`src/shared/harness-mode-intent.ts`、
`src/server/harness-mode-intent-api.ts`、`app/harness/[id]/mode-editor.tsx` 四个文件均不含
`"kimi"/"codex"/"claude-code"` 字面量（既有测试断言同样通过）。

### 验收 3 — 不把 App Server `thread/fork` 当作 child-agent 证据，也不生成 Codex bridge receipt

**PASS。**

- **运行期发布边界**：`session-bridge.py:39-43`
  `PUBLISHED_PROTOCOL_KINDS = {ACP_NATIVE_AGENT_PROTOCOL}`，注释明确
  "The dormant App Server probe deliberately does not appear here"。
  `app-server-native-agent/v1` 在 `_load_protocol` 即 fail-closed（`bridge protocol kind is not published`），
  在启动任何 CLI 之前拒绝。
- **驱动自述**：`session_bridge_codex.py` 模块 docstring 明确
  "`thread/fork` creates a related *new* session … therefore deliberately **not** treated as a
  same-session subagent path"，且 "No shipped manifest marks this driver verified"。
  驱动改为要求原生 `spawnAgent` lineage，达不到即报错——保持为 fail-closed probe。
- **receipt 层**：`validate-external-bridge-receipt.py:410` 硬性要求
  `bridge_kind == "acp-native-agent/v1"`，Codex 的 `app-server-native-agent/v1` receipt 无法通过校验。
  全仓 grep `app-server-native-agent` 无任何 receipt JSON 落盘。
- **sandbox 层**：三个 `subagent--codex--{role}` 经 `sandbox-profile.sh` 全部 `exit 2`
  （`内部执行目标不可用：target id is not registered`），且**不创建 workroot / state 目录**。
  （该用例先校验探针信封本身合法，确保拒绝来自 target 而非信封瑕疵。）

---

## 3. 回归矩阵

### Framework L1

| 套件 | 结果 |
|---|---|
| `test-tool-catalog.py` | **37/37 OK** |
| `test-session-bridge.py` | **9/9 OK** |
| `test-session-bridge-codex.py` | **9/9 OK** |
| `test-external-bridge-receipt.py` | **8/8 OK** |
| `test-vm-bridge-provider.py` | **11/11 OK** |
| `test-lifecycle.py` | 53 tests，**1 failure**（见 §4，非 F002 范畴） |

### Tokenizer L1

| 项 | 结果 |
|---|---|
| `npx vitest run --exclude "tests/evaluator/**"` | **60 files / 905 passed / 4 skipped / 0 failed** |
| `npm run verify`（prisma generate + tsc） | 产品代码 **0 error** |
| `npm run lint` | **No ESLint warnings or errors** |
| 聚焦套件 | `harness-tool-catalog` 73 / `harness-modes` 22 / `harness-mode-intent` 81 / `harness-detail` 18 全通过 |

### F002 专属探针（本轮新增，Evaluator 所有）

| 探针 | 结果 |
|---|---|
| `scripts/test/f002_codex_bridge_exclusion.py` | PASS（差分实验，含 attested-provider 反证） |
| `scripts/test/f002_codex_sandbox_boundary.sh` | PASS |
| `scripts/test/f002_codex_device_mirror.ts` | PASS |
| `scripts/test/f002_codex_issuance_refusal.ts` | PASS |
| `scripts/test/f002_codex_mode_snapshot.ts` | PASS |

---

## 4. 观察项（不影响 F002 判定，供 Planner/Generator 参考）

**O1 · `test-lifecycle.py` 1 处失败 —— 属 F001/F003 范畴，非 Codex。**
用例 `test_sandbox_rejects_external_same_session_target_before_creating_runtime` 使用
`subagent--kimi--evaluator`（**Kimi** target）。行为仍**正确 fail-closed**（`exit 2`、不建 workroot/state），
只是拒绝文案在修复轮后变成
`[sandbox] ⛔ external same-session bridge does not launch here: dispatch-run.sh owns the strict vm-v1 provider route`，
而断言仍在找旧文案 `target id is not registered` → **测试断言过时**，非安全回归。建议由对应 feature 的负责人同步断言。

**O2 · Codex adapter 的 `_verified` 版本漂移（soft-watch）。**
`codex.json` 注明"已按 codex-cli **0.145.0** 实测核对……升级 CLI 后需重跑核对"，
本机实装为 **0.146.0**。本轮 L2 health check 证明该 argv 契约在 0.146.0 上仍然工作（exit 0），
故不判 FAIL；但 `_verified_note` 与实装版本已不一致，建议下批次重跑核对并更新注记。
（该漂移在上一轮即已存在，非修复轮引入。）

**O3 · 本机用户 Codex 配置与沙箱 HOME 替换存在交互隐患（本机环境，非产品缺陷）。**
`~/.codex/config.toml` 含 `model_instructions_file = "~/.codex/codex_ctf_unrestricted_profile.md"`。
沙箱按设计以 `env -i` 替换 `HOME`，`~` 因而展开到沙箱 HOME，导致
`failed to read model instructions file …: No such file or directory`。
这是**本机个人配置**与凭据隔离机制的交互，不是本批次代码缺陷（Codex 相关文件在修复轮零改动，见 §5），
但会让本机上真实的 Codex local-cli 派活失败。建议：改用绝对路径，或在 descriptor 评估
`--ignore-user-config`（adapter 已在 `_not_used` 中记录该选项的取舍）。

**O4 · 并发同伴产物（非本轮 SHA 内容）。**
执行期间 `tests/evaluator/bl-native-subagent-bridges-f004.test.ts` 与
`scripts/test/bl-native-subagent-bridges/*` 由并行运行的其他 evaluator 实时写入（时间戳 23:11+），
**均为 untracked**，不属锁定 SHA。其中 F004 用例有 3 处失败、f001 探针有 5 处 tsc 报错——
**均为同伴在途工作，已排除在本报告判据之外**（全量 vitest 因此加 `--exclude "tests/evaluator/**"`）。
特别说明：F004 那 3 处失败中，`expect(html).not.toContain('value="subagent"')` 一侧是**通过**的，
失败在 `toContain('value="local-cli"')`——即便按最严口径看，也**不构成 Codex bridge 泄漏**。

---

## 5. 修复轮对 F002 的影响面

```
$ git diff --stat f20b1e2287cafc75fd3a3d36966c769a3e858949 172ed42 -- \
    .claude/dispatch/transports/adapters/codex.json \
    .agents-registry.json \
    .claude/dispatch/transports/session_bridge_codex.py
(empty)
```

修复轮**未触碰**任何 Codex 面（adapter、registry codex 块、Codex session bridge 驱动）。
F002 的主体行为不变；唯一的实质回归风险（provider 打开后 Codex 被连带发布）已由 §2 验收 2(b)
的差分实验证伪。

---

## 6. 结论

**F002 = PASS。** 三条 acceptance 全部满足，且本轮以差分实验把"Codex 未发布 bridge"从
弱证据（可能被全局 fail-closed 掩盖）提升为**强证据**（闸门打开时 Kimi 发 3 个、Codex 仍发 0 个）。
Codex 的 verified adapter、专用沙箱 HOME、`CODEX_HOME` 凭据隔离、`env_allow=[]`、2400s timeout
全部保持；已授权的 L2 local-cli health check 实测 exit 0。App Server fork 在
catalog / 运行期协议 / receipt / sandbox 四层均保持 fail-closed，未生成任何 Codex bridge receipt。

**未修改任何产品代码**；本轮仅新增 `scripts/test/f002_*` 五个 Evaluator 探针与本报告。

---

## 附：复现步骤

```bash
git rev-parse HEAD   # 必须为 172ed42b5c4d910c7f194a6fab835c8ac74f19e7

# 1) 结构性排除差分实验（核心证据）
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test/f002_codex_bridge_exclusion.py

# 2) sandbox 边界 + local-cli 契约
bash scripts/test/f002_codex_sandbox_boundary.sh

# 3) 设备目录镜像 / 签发拒绝 / 模式快照
npx tsx scripts/test/f002_codex_device_mirror.ts
npx tsx scripts/test/f002_codex_issuance_refusal.ts
npx tsx scripts/test/f002_codex_mode_snapshot.ts

# 4) 回归
python3 .claude/dispatch/test-tool-catalog.py
python3 .claude/dispatch/test-session-bridge-codex.py
python3 .claude/dispatch/test-external-bridge-receipt.py
npx vitest run --exclude "tests/evaluator/**"
npm run verify && npm run lint

# 5) [L2] Codex local-cli health（需已认证 Codex）
W=$(mktemp -d); git init -q "$W"; (cd "$W" && git commit -q --allow-empty -m init)
printf 'Reply with exactly: HEALTHY\n' > "$W/p.txt"
python3 .claude/dispatch/process-timeout.py --timeout 180 -- \
  codex exec --json --ephemeral -C "$W" -s read-only - < "$W/p.txt"
```
