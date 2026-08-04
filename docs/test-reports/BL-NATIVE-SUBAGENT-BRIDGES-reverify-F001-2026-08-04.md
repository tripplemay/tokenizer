# BL-NATIVE-SUBAGENT-BRIDGES · F001 复验报告（fresh-context Evaluator）

| 项 | 值 |
| --- | --- |
| Feature | **F001 — 声明式同会话 bridge 注册与能力目录** |
| 复验轮次 | reverifying（fix_rounds = 1，上轮结论 FAIL） |
| 锁定 SHA | `172ed42b5c4d910c7f194a6fab835c8ac74f19e7`（复验期间 HEAD 一致，工作树无产品代码改动） |
| 执行者 | Evaluator（隔离上下文 subagent，署名 `Andy/evaluator-subagent`） |
| 日期 | 2026-08-04（UTC 02:58 – 03:20） |
| 主机 | macOS · Kimi Code 0.31.0 · `limactl` harness-vm-v1 · 安装包 `~/.tokenizer/app` |
| L2 使用 | 已授权范围内：仅一次最小 `kimi -p "Reply with exactly: OK"`（/tmp 下执行，无源码写入）用于刷新已过期的 OAuth 凭据，使 strict provider 可 attest。未执行 bridge 子代理 probe（F005 范围） |
| **结论** | **PASS** |

---

## 1. 复验方法与边界

- 全部结论基于**实际命令输出**，不采信任何转述。
- **未修改任何产品代码**。新增物仅在 Evaluator 允许目录：
  - `scripts/test/bl-native-subagent-bridges/f001-reverify-matrix.py`（框架侧 28 例矩阵）
  - `scripts/test/bl-native-subagent-bridges/f001-installed-mirror-probe.ts`（安装态 Tokenizer mirror 探针）
  - `scripts/test/bl-native-subagent-bridges/f001-mirror-matrix.sh`（mirror 侧合成 checkout 矩阵）
  - `scripts/test/bl-native-subagent-bridges/f001-ts-mirror-probe.ts`（源码树拓扑对照探针）
  - `docs/test-reports/evidence/BL-NATIVE-SUBAGENT-BRIDGES-F001-2026-08-04/`（原始输出）
- 所有否定用例都在私有临时目录内构造（`--adapters` / `--bridges` / 合成 repo），真实 registry、manifest、adapter 全程未被写入。

### 1.1 上轮 FAIL 的根因是否消失（关键前置观察）

上轮 FAIL 的核心是"Kimi bridge 被刻意 dormant，三角色不发布"。本轮开局先复现了 dormant 状态，并定位其为**凭据到期导致的预期 fail-closed**，而非目录实现问题：

```
# 02:58 UTC，Kimi OAuth 已过期 210 秒
$ cd ~/.tokenizer/app/framework/templates/claude/dispatch/transports && \
  env -i LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3 -I ./vm-bridge-provider.py catalog-attest
{"available":false,"reason":"Kimi OAuth credential expires too soon"}

$ python3 framework/templates/claude/dispatch/tool-catalog.py catalog --registry .agents-registry.json
… 三角色均无 invocation=subagent 条目 …
```

刷新凭据后（L2 授权范围内的最小调用），provider 输出 nonce-bound catalog attestation（`provider_kind: vm-v1`、`phase: catalog`、TTL 5 分钟），目录随即发布三角色。**这构成一次真实的"provider 不可用 → 目录隐藏 / provider attested → 目录发布"自然对照实验**，两端均由实测捕获。

---

## 2. 验收逐条判定

验收原文（features.json F001）+ spec §4 F001 四条细则，逐条对应实测证据。

### 2.1 「integration 以受限 subagent bridge 对象声明能力」 — PASS

`.agents-registry.json` 中 Kimi 声明为 `"subagent": { "bridge": "kimi-acp-native-agent" }`；Codex 无 `subagent` 键；Claude Code 保留 legacy `subagent: true`。实测约束：

| 观察 | 结果 |
| --- | --- |
| `subagent` 对象为闭合结构（加 `trusted: true`） | rc=2 `integrations[3].subagent contains unsupported fields: ['trusted']` |
| bridge id 路径穿越 `../../../etc/passwd` | rc=2 `must match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'` |
| legacy `subagent: true`（claude-code）签名为 v2 外部路由 | rc≠0 `no eligible agent for binding(s): generator=claude-code+subagent` |
| legacy `dispatch/1` registry 的 host-native subagent | 目录 v2-selectable 视图为空，但 `target` 仍可解析（`bridge_id: host-native`、`tool: claude-code`）→ **兼容且未被误路由为 external bridge** |

### 2.2 「catalog 仅为已发布且 _verified 的 bridge 展开三角色 subagent 候选」 — PASS

provider attested 期间（03:05 UTC 起）：

```
$ python3 framework/templates/claude/dispatch/tool-catalog.py catalog --registry .agents-registry.json
planner   | kimi | subagent      generator | kimi | subagent      evaluator | kimi | subagent
（codex 与 claude-code 无任何 subagent 条目；kimi/codex/claude-code 的 local-cli、a2a 条目不受影响）
```

Tokenizer 侧 catalog mirror 在**安装态拓扑**（模块来自 `~/.tokenizer/app`，被检 repo 为项目 checkout）给出一致结果：18 条目，其中 `kimi/{planner,generator,evaluator}` 三条 `subagent`，每条携带 `subagentProvider = harness-vm-v1 / vm-v1 / phase=catalog / expiresAt=2026-08-04T03:18:09Z`，且三条均进入 `v2SelectableToolCatalogEntries`；`codex_subagent_routes = 0`。

> 说明（非缺陷）：在**源码树拓扑**下运行 mirror（installRoot == repoPath）时，`frameworkOwnedVmBridgeProviderPath()` 按设计拒绝"应用为自己授权目录"，故不发布任何 subagent 路由、且 integration inventory 中 `subagent:false` / `bridge_id:null`。这是有意的自授权防线，实测已在两种拓扑下分别取证。

### 2.3 「target 带不可签名的 bridge provenance 与 execution_provenance_sha256」 — PASS

三个 target 均解析成功且字段齐备（`docs/test-reports/evidence/.../targets-attested.txt`）：

| target | agent_type / native_agent_type | bridge provenance | execution_provenance_sha256 |
| --- | --- | --- | --- |
| `subagent--kimi--planner` | planner-proposal / plan | `kimi-acp-native-agent` · `session-bridge-v1` · `same-session` · `acp-native-agent/v1` · `harness-vm-v1` (`vm-v1`, contract `5b1ccaaa…`) | `cdc7ff9254fc3e09…` |
| `subagent--kimi--generator` | generator-restricted / coder | 同上 | `08dac2538f260457…` |
| `subagent--kimi--evaluator` | evaluator / explore | 同上 | `b806e950653e0b05…` |

不可签名性（三重实测）：

1. 人类签名载荷只接受 `{tool, invocation}`：带 `bridge` 字段的 binding 被拒 — `binding 'generator' must contain exactly tool and invocation; … extra=['bridge']`。
2. 合法 binding（`kimi+subagent`）可解析出该 target，且 `resolve` 返回体只含 `agent_id/tool/invocation/model_family/priority/execution_provenance_sha256`，**未泄漏任何 bridge/sandbox/adapter 字段**。
3. 项目 registry 无法伪造 provenance：注入 `bridge_provider_id` 或 `execution_provenance_sha256` 均被 `integrations[1] contains unsupported fields` 拒绝。

digest 语义绑定实测：仅改 manifest `notes`（说明性字段）→ digest 不变（`08dac2538f26`）；改 `native_agent_types.generator: coder→explore`（语义字段）→ digest 变为 `b1b04797186d`；改 `strategy` 标签 → digest 变为 `e2a823eeee87`。即**任何执行语义漂移都会使既有 checkpoint 的 provenance 失配**。

### 2.4 「未来工具只要声明同一已支持 bridge 协议即可自动进入目录」 — PASS

构造合成 `futurecli`（自有 `_verified` adapter + 自有 `future-acp-native-agent` manifest，协议同为 `acp-native-agent/v1`），**未改动任何产品代码**：

- 框架目录：`futurecli` 三角色 subagent 候选全部出现；`target subagent--futurecli--generator` 携带 `bridge_id=future-acp-native-agent` 与同一 `harness-vm-v1` provider provenance。
- Tokenizer mirror（安装态、合成 checkout）：`subagent_routes = [futurecli/{planner,generator,evaluator}, kimi/{…}]`。
- 反向确认无工具名白名单：`tool-catalog.py` 全文仅一处出现 "kimi" 字样，且是运行时完整性校验的文件名清单（`transports/session_bridge_kimi.py`）；TS mirror 中唯一的工具名分支是 legacy `dispatch/1` host-native 的 `claude-code` 归一化。
- 冒名借用被拒：把 Codex 的 `subagent` 指向 Kimi manifest → `adapter 'codex'.bridge_commands must declare the published bridge command`。

### 2.5 「未知 / 未验证 / 角色越权 / 命令不匹配 / 配置漂移均 fail-closed」 — PASS

框架侧 17 例否定矩阵（`scripts/test/bl-native-subagent-bridges/f001-reverify-matrix.py`），全部 rc=2 且零候选发布：

| 维度 | 用例 | 拒绝信息（节选） |
| --- | --- | --- |
| 未知 | `unknown-bridge-id` | `subagent bridge 'no-such-bridge' does not exist` |
| 未验证 | `manifest-not-verified` | `is not verified; it cannot enter the catalog` |
| 未验证 | `unverified-adapter` | `adapter 'futurecli' is not verified` |
| 角色越权 | `role-persona-overreach`（planner 冒用 evaluator persona） | `personas.planner must be 'planner-proposal' under the framework role contract` |
| 角色越权 | `unknown-role-persona`（新增 coordinator 角色） | `personas contains unsupported fields: ['coordinator']` |
| 角色越权 | `persona-type-set-mismatch` | `native_agent_types must declare exactly the bridge persona roles` |
| 角色越权 | `unpublished-native-agent-type`（`root`） | `must name a published native agent type` |
| 命令不匹配 | `bridge-command-mismatch` | `protocol.command must exactly match adapter … bridge_commands[…]` |
| 命令不匹配 | `bridge-command-foreign-executable`（借用他家可执行文件） | `bridge_commands[…][0] must match adapter 'futurecli'.argv[0]` |
| 命令不匹配 | `adapter-declares-no-bridge-command` | `bridge_commands must declare the published bridge command` |
| 配置漂移 | `unpublished-protocol-kind`（`mcp-child/v1`） | `is not published by this framework` |
| 配置漂移 | `manifest-id-drift` | `filename … disagrees with bridge.id=…` |
| 配置漂移 | `session-scope-drift` | `session_scope must be 'same-session'` |
| 配置漂移 | `unknown-manifest-field`（`allow_host_fs`） | `contains unsupported fields: ['allow_host_fs']` |
| 配置漂移 | `bridge-without-local-cli` | `requires local_cli for its verified sandbox, credentials, and timeout policy` |
| 结构 | `bridge-id-path-traversal` / `subagent-declaration-extra-key` | 见 §2.1 |

Tokenizer mirror 侧（安装态 + 合成 checkout）：

| 合成 checkout | 结果 |
| --- | --- |
| control（原样） | 18 条目 / `kimi` 三角色 subagent |
| `_verified: false` | **整份目录不可用**（0 条目，issue = `dispatch tool catalog is unavailable`） |
| 项目侧 `vm-bridge-provider.py` 被追加一行（漂移） | 15 条目、**0 条 subagent**（local-cli / a2a 保留，外部 bridge 全部隐藏） |

### 2.6 「缺少项目 registry 时不读 user example registry」 — PASS

- 框架：`--registry <不存在路径>` → rc=2 `agent registry does not exist: …`，stdout 为空；同目录存在 `agents-registry.example.json` 也不被读取。
- mirror：无 `.agents-registry.json` 但放置了 example 的 repo → `{ entries: [], issue: "dispatch tool catalog is unavailable" }`。

---

## 3. 回归与既有套件（L1）

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| 框架聚焦 | `python3 .claude/dispatch/test-tool-catalog.py` | **37 passed / OK**（含 `…hidden_without_a_strict_provider`、`…auto_discovers_roles_after_provider_attestation`、`invalid_strict_provider_observation_fails_closed`、`execution_provenance_hashes_adapter_and_bridge_semantics_but_not_comments`） |
| Tokenizer mirror | `npx vitest run tests/cli/harness-tool-catalog.test.ts --no-file-parallelism` | **73 passed** |
| 本报告自建矩阵 | `python3 scripts/test/bl-native-subagent-bridges/f001-reverify-matrix.py` | **28/28 passed，failed=[]** |
| mirror 矩阵 | `scripts/test/bl-native-subagent-bridges/f001-mirror-matrix.sh` | 4/4 场景符合预期 |

> 全量 `npm test` / typecheck / lint / build 属 F005 回归矩阵范围，本报告不重复承担。

---

## 4. 观察项（不构成 F001 缺陷，供 Planner 归档）

1. **`strategy` 是标签而非驱动选择器**：manifest 的 `strategy` 仅做格式校验（安全字符、单值），任意值（如 `attacker-strategy`）不会被目录拒绝；但驱动选择由 `protocol.kind` 的已发布白名单决定，且 `strategy` 已进入 `execution_provenance_sha256`，改动会使既有签名 checkpoint 失配。因此它无法解锁未验证执行路径。若希望语义更强，可在后续批次把 strategy 也纳入已发布集合。
2. **目录发布强依赖 Kimi OAuth 有效期（约 15 分钟）**：凭据过期时 provider 返回 `available:false`，目录整体隐藏外部 bridge。这是设计内 fail-closed，但对"人类在控制台选择模式"的可用性有实际影响（选择窗口短）。建议在 backlog 记录"attestation 可用性与凭据续期"的产品化课题。
3. **target 的 `sandbox.env_set.KIMI_CODE_HOME = ~/.kimi-code`** 来自继承的 local-cli 契约，属 F003 的 worker 凭据隔离判定范围，本次未在 F001 结论中计分。

---

## 5. 结论

F001 的五项验收（受限 bridge 对象声明 / 仅 `_verified` 且 attested 时展开三角色候选 / target 携带不可签名 provenance 与 execution_provenance_sha256 / 未来工具声明式自动入目录 / 五类 fail-closed）在锁定 SHA 上**均以实际命令输出得到证实**，框架与 Tokenizer catalog mirror 判定一致，上轮 FAIL 的"bridge 永久隐藏"根因已消除（限于 provider attest 有效期内）。

**判定：PASS**

原始证据：`docs/test-reports/evidence/BL-NATIVE-SUBAGENT-BRIDGES-F001-2026-08-04/`
（`framework-matrix.json` / `catalog-attested.json` / `targets-attested.txt` / `provider-catalog-attest.json` / `mirror-*.json` / 套件尾部输出）
