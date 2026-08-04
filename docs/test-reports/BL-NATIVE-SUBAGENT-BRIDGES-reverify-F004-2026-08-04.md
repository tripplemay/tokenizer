# BL-NATIVE-SUBAGENT-BRIDGES · F004 复验报告

| 项 | 值 |
|---|---|
| Feature | **F004 — 模式签发、设备目录与动态界面桥接语义** |
| 阶段 | `reverifying`（fix_rounds = 1） |
| 锁定 SHA | `172ed42b5c4d910c7f194a6fab835c8ac74f19e7`（已确认 HEAD 一致，tracked 文件无本地改动） |
| 验收人 | Evaluator（fresh context，隔离 subagent） |
| 日期 | 2026-08-04 |
| **结论** | **PASS** |

---

## 0. 独立性与边界声明

- 本轮结论仅基于磁盘上的代码、实际命令输出与本机实测，未采用任何他人对实现质量的转述。
- 未修改任何产品代码。新增产物仅限：
  - `tests/evaluator/bl-native-subagent-bridges-f004.test.ts`（Evaluator 自写探针，13 用例）
  - `scripts/test/f004-device-catalog-probe.ts`（只读设备目录探针）
  - 本报告
- L2 授权范围（2026-08-04）内只执行了**只读**动作：catalog-phase provider attestation 与设备目录读取；未启动任何 bridge 作业、未写源码、未推送、未部署。证据中所有摘要已脱敏（仅保留前 8 字符 + 长度）。

### L1 环境前置核对（`framework/patterns/testing-env-patterns.md`）

| 检查 | 结果 |
|---|---|
| §3 `prisma generate` 前置 | 已执行（`npm run verify`），Prisma Client v5.22.0 生成成功 |
| §4 Node 版本对齐 `.nvmrc` | 项目**无** `.nvmrc`、无 `engines` 约束；本机 Node v25.7.0。本轮无 jsdom / localStorage 用例（vitest environment = node），不触发该坑 |
| 工作树污染 | `git status` 显示 `scripts/`、`tests/evaluator/` 为 untracked，属并行 evaluator 的产物；已用 locked-SHA 干净 worktree 复算 tsc 与聚焦测试以排除干扰 |

---

## 1. F004 acceptance 逐条判定

> features.json 原文：
> 「heterogeneous 模式允许已验证的外部 same-session bridge 与 local-cli 组合、仍拒绝 a2a；Generator/Evaluator 仍须不同 model family。Tokenizer Agent 的 TypeScript catalog mirror、服务端 intent 校验和既有动态角色 UI 会一致展示 Kimi external bridge 与 Codex local-cli，不新增按工具名硬编码；Coordinator-host-native 与 bridge 路径的文案可区分。」

| # | 验收子条款 | 判定 | 关键证据 |
|---|---|---|---|
| a1 | heterogeneous 允许「已验证外部 same-session bridge + local-cli」组合 | **PASS** | §2.1 / §3 verdict 1、2 |
| a2 | heterogeneous 仍拒绝 a2a | **PASS** | §2.1 / §3 verdict 3 |
| a3 | Generator/Evaluator 仍须不同 model family | **PASS** | §2.1 / §3 verdict 4 |
| a4 | slow / A2A 约束未被放宽 | **PASS** | §2.1 / §3 verdict 5 |
| b1 | TypeScript catalog mirror 展示 Kimi external bridge、Codex 仅 local-cli | **PASS** | §3.1 |
| b2 | 服务端 intent 校验与 mirror 结论一致 | **PASS** | §3.2 |
| b3 | 既有动态角色 UI 一致展示（不新增 UI 组件） | **PASS** | §2.3 / §3.3 |
| b4 | 不新增按工具名硬编码 | **PASS** | §2.2 |
| b5 | 设备 report / 服务端 API / CLI / UI 对同一 registry 结论一致；user example registry 不参与发现 | **PASS** | §3 全表 + §3.4 |
| c1 | Coordinator-host-native 与 bridge 路径文案可区分（中英双语） | **PASS** | §2.3 |

### 与上一轮 FAIL 的差异（复验重点）

上一轮 F004 FAIL 的三条复现步骤，本轮逐条重跑，全部不再复现：

| 上轮 FAIL 复现步骤 | 本轮实测 |
|---|---|
| 1. `tool-catalog.py catalog` 三角色均无 `kimi + subagent` | **已修复**：三角色（planner / generator / evaluator）均发布 `kimi + subagent`（§3.0） |
| 2. `roleToolOptions` 中所有 `subagent` 被 `isV2SelectableToolCatalogEntry` 排除 | **已修复**：该谓词改为「非 subagent 直接通过；subagent 需 live VM provider proof」（`src/shared/harness-tool-catalog.ts:285-290`），带 live proof 的 bridge 进入选择器（§2.3） |
| 3. 聚焦 Vitest 断言 external bridge 签发 409、bridge heterogeneous 初始化为 null | **已修正语义**：`tests/shared/harness-mode-drilldown.test.ts:312` 的 `BRIDGE_PROFILED_TOOLS` **不带 proof**，其 `null` 是正确的 fail-closed 行为；带 live proof 时初始化可返回 bridge 组合（§2.3 自写探针实证） |

---

## 2. Evaluator 自写探针（L1，13 用例全绿）

文件：`tests/evaluator/bl-native-subagent-bridges-f004.test.ts`。刻意不复用实现方的 fixture，全部形状按公开类型自建，避免实现 fixture 的回归被自身掩盖。

```
npx vitest run tests/evaluator/bl-native-subagent-bridges-f004.test.ts --no-file-parallelism
→ Test Files 1 passed (1) · Tests 13 passed (13)
```

> 探针编写中曾出现 3 个失败，逐一定位为**探针自身缺陷**而非产品缺陷，已修正后重跑：
> 1. 用未来时刻（2026-08-04T09:00Z）签发 proof，而 `ModeEditor` 直接读 `Date.now()`，proof 不在有效窗口 → 改为锚定真实当前时间。
> 2. 同因导致 `initialNonFastBindingsForProfile` 返回 null。
> 3. 误判「stale proof 快照应抛错」：实际正确行为是 subagent 条目被剔除、local-cli 条目保留（`harness-mode-intent-api.ts:582-586` 仅在**可选目录为空**时 409）。已改为断言真实契约。

### 2.1 heterogeneous 签发语义（6 用例）

| 用例 | 期望 | 实测 |
|---|---|---|
| bridge(generator) + local-cli(evaluator) 签发 | 接受 | ✓ 接受；归一化后 execution 为 `{profile: heterogeneous, role_bindings: {planner: null, generator: kimi/subagent, evaluator: codex/local-cli}}` |
| bridge 作为 evaluator 与 planner 绑定 | 接受 | ✓ |
| heterogeneous 含 a2a | 拒绝 | ✓ `profile_transport_mismatch` |
| generator/evaluator 同 model family（kimi/kimi） | 拒绝 | ✓ `same_model_family` |
| slow 仅有 bridge + local-cli | 拒绝 | ✓ `profile_transport_mismatch` |
| proof 缺失 / 过期时签发 bridge | 拒绝 | ✓ `unknown_tool`（两种情形均是） |

签名面纯净性：接受结果的 JSON 序列化中**不含** `harness-vm-v1`、不含 `subagentProvider` —— provider 证据不越过签名边界，与「签名只保存 tool + invocation」一致。

### 2.2 无按工具名硬编码

- 断言 `src/shared/harness-tool-catalog.ts`、`src/shared/harness-mode-intent.ts`、`src/server/harness-mode-intent-api.ts`、`app/harness/[id]/mode-editor.tsx` 四个 F004 面**均不含**字面量 `"kimi"` / `"codex"` / `"claude-code"`（正则 `["'\`](kimi|codex|claude-code)["'\`]`）→ 通过。
- 反向实证：把完全陌生的 `acme-cli`（bridge + live proof）与 `zeta-cli`（local-cli）代入同一路径，heterogeneous 签发同样**接受**——门槛是 provider proof 与 protocol，不是工具名。
- `isV2SelectableToolCatalogEntry` 对 `kimi` 与 `acme-cli` 的 bridge 条目返回值一致（均 true）；对无 proof / 过期 proof 一致（均 false）。

**非阻断观察（记录，不影响 F004 判定）：** `src/cli/harness-tool-catalog.ts:44-49` 的 `VM_BRIDGE_RUNTIME_FILES` 含文件名 `session_bridge_kimi.py`，`framework/.../session-bridge.py:26` 也从该模块 import 通用 `acp-native-agent/v1` 驱动。这是 framework 侧 runner **文件命名**与完整性清单，不是目录准入的工具名白名单（准入仍由 protocol + proof 决定），因此不构成 F004 的「按工具名硬编码」。建议后续把该通用 ACP 驱动改为中性文件名，属 F001/F003 范畴的整洁性改进。

### 2.3 动态角色 UI 与文案区分

| 用例 | 实测 |
|---|---|
| 带 live proof 的 bridge 目录渲染 `ModeEditor` | 工具下拉同时出现 `<option value="kimi">` 与 `<option value="codex">`；invocation 下拉出现 `subagent` 与 `local-cli`；bridge 条目标注 `invocationMode.sameSessionBridge` |
| 无 proof 的同形目录渲染 | `<option value="kimi">` 与 `value="subagent"` **均不出现**，仅剩 `codex`（fail-closed） |
| bridge 路径 vs host-native 路径文案 | bridge → `invocationMode.sameSessionBridge(kind=session-bridge-v1)` 且**不含** hostNative；integration 去掉 bridgeId/bridgeKind/sessionScope 后 → `invocationMode.hostNative` 且**不含** sameSessionBridge |
| 双语文案键 | `en` / `zh-CN` 均有 `hostNative` 与 `sameSessionBridge`，二者互不相同，`sameSessionBridge` 含 `{kind}` 占位符；editor 与 integration card 两处均齐备 |

实际文案：

| key | en | zh-CN |
|---|---|---|
| `harness.editor.invocationMode.hostNative` | `Coordinator-native child` | `Coordinator 原生子代理` |
| `harness.editor.invocationMode.sameSessionBridge` | `Same-session bridge · {kind}` | `同会话 bridge · {kind}` |
| `harness.editor.invocationMode.local-cli` | `Local CLI` | `本地 CLI` |

UI 面**未新增组件**：仍是既有 `roleToolOptions` / `RoleToolBinding` / `SelectedRoleContext` / `IntegrationCard` 四处，`app/harness/[id]/mode-editor.tsx:654` 只是把既有过滤器换成共享谓词。

---

## 3. 本机实测：设备 report → 服务端 API → CLI → UI 四方一致（同一 registry）

registry：`/Users/yixingzhou/project/tokenizer/.agents-registry.json`（Codex / Claude Code / Kimi）。

### 3.0 Framework（Python）目录

```
PYTHONDONTWRITEBYTECODE=1 python3 framework/templates/claude/dispatch/tool-catalog.py \
  catalog --registry .agents-registry.json
```

- `planner` / `generator` / `evaluator` **三角色**均含 `{"tool": "kimi", "invocation": "subagent"}`。
- `codex` 仅 `local-cli` 与 `a2a`，**无** subagent；`claude-code` 同样无 subagent。

### 3.1 Tokenizer Agent 的 TypeScript catalog mirror（设备 report 面）

在**已安装应用包** `~/.tokenizer/app`（与仓库源码逐字节相同：`diff -q` → identical）中对本仓库执行只读探针：

```json
{
  "catalogIssue": null, "integrationIssue": null,
  "counts": { "total": 18, "subagent": 3, "selectableSubagent": 3 },
  "subagentEntries": [
    { "role": "evaluator",  "tool": "kimi", "invocation": "subagent", "selectable": true,
      "provider": { "id": "harness-vm-v1", "kind": "vm-v1",
                    "contractSha256": "5b1ccaaa…(64)", "phase": "catalog",
                    "nonceSha256": "5286a371…(64)", "ttlSeconds": 300 } },
    { "role": "generator", … 同上 }, { "role": "planner", … 同上 }
  ],
  "integrations": [
    { "id": "claude-code", "subagent": false, "hasProviderProof": false },
    { "id": "codex",       "subagent": false, "bridgeId": null, "hasProviderProof": false },
    { "id": "kimi", "invocations": ["local-cli","subagent","a2a"], "subagent": true,
      "bridgeId": "kimi-acp-native-agent", "bridgeKind": "session-bridge-v1",
      "sessionScope": "same-session", "bridgeProtocol": "acp-native-agent/v1",
      "bridgeRoles": ["planner","generator","evaluator"], "hasProviderProof": true }
  ]
}
```

与 §3.0 的 Python 目录**完全一致**：Kimi 三角色 bridge + provenance，Codex 仅 local-cli/a2a。

> **重要区分（避免误判）：** 直接在**仓库根**运行同一探针时 subagent 数为 0。原因是 `frameworkOwnedVmBridgeProviderPath()`（`src/cli/harness-tool-catalog.ts:336-345`）刻意禁止「运行中的 app 为自己授权目录」（installRoot 与 repoPath 同源即返回 null）。这是**设计内的 self-authorization 防线**，不是缺陷；生产形态（app 在 `~/.tokenizer/app`，项目在别处）不触发。本报告全部设备侧结论均取自安装包形态。

### 3.2 服务端 API 面（同一设备快照）

用 Agent 自己的 `buildModeSnapshot()` 产出真实上报快照，直接喂服务端校验链：

| 检查 | 结果 |
|---|---|
| `parseModeSnapshot(snapshot)` | 通过（非 null） |
| `modeToolCatalogFromSnapshot(snapshot, now)` | 18 条描述符，其中 3 条 `kimi/subagent`（planner / generator / evaluator），`model_family: kimi` |

对同一描述符集做签发校验：

| 场景 | 结果 |
|---|---|
| heterogeneous：generator = kimi/subagent，evaluator = codex/local-cli | **接受** |
| heterogeneous：generator = codex/local-cli，evaluator = kimi/subagent | **接受** |
| heterogeneous：evaluator = codex/**a2a** | 拒绝 `profile_transport_mismatch` |
| heterogeneous：kimi/subagent + kimi/local-cli（同家族） | 拒绝 `same_model_family` |
| **slow**：仅 bridge + local-cli | 拒绝 `profile_transport_mismatch` |
| heterogeneous：generator = **codex/subagent**（从未发布） | 拒绝 `unknown_tool` |

### 3.3 控制台 UI 面（同一设备快照）

`parseHarnessDetailModes(snapshot)` → 传给 `ModeEditor` 的 `tools` / `integrations`：

```
toolCatalogUsable: true
editorCatalog (18): …
  planner:kimi:subagent+proof:selectable
  generator:kimi:subagent+proof:selectable
  evaluator:kimi:subagent+proof:selectable
  （codex / claude-code 仅 local-cli 与 a2a，无 subagent）
editorIntegrations:
  claude-code → subagent:false → 无 subagentPath 行
  codex       → subagent:false → 无 subagentPath 行
  kimi        → subagent:true, sessionScope:"same-session", bridgeKind:"session-bridge-v1"
                → subagentPath 文案 = sameSessionBridge
```

四方（Framework Python 目录 / Agent TS mirror / 服务端 API / 控制台 UI 输入）对同一 registry 的接受—拒绝集合完全一致。

### 3.4 user example registry 不参与发现

- TS mirror 的 registry 读取只有一处：`src/cli/harness-tool-catalog.ts:964` 读 `<repo>/.agents-registry.json`；全文件无 `agents-registry.example.json` 引用。
- `.claude/dispatch/agents-registry.example.json` 存在且被 git 跟踪，但从未进入发现路径；上述实测中它对结果无任何影响。

---

## 4. 回归与 L1

| 命令 | 结果 |
|---|---|
| `npx vitest run`（8 个 F004 相关聚焦套件） | **376 passed / 8 files**（harness-mode-drilldown / harness-mode-intent / harness-mode-intent-api / harness-detail / harness-tool-catalog / harness-mode-intents / harness-mode-intents-route / harness-report-mode-intent） |
| 锁定 SHA 干净 worktree 中重跑（含自写探针） | **299 passed / 6 files** |
| `npx tsc --noEmit`（锁定 SHA 干净 worktree） | **0 error** |
| `npm run verify`（当前共享工作树） | 报 6 个 error，**全部位于并行 evaluator 的 untracked 探针脚本** `scripts/test/bl-native-subagent-bridges/f001-ts-mirror-probe.ts`、`scripts/test/f002_codex_issuance_refusal.ts`；`git ls-files scripts/test/` 为空，证明不属 HEAD。产品代码本身 tsc 干净（见上一行）。**提示编排者：这些 F001/F002 探针脚本若要提交，必须先修好类型，否则会红 CI。** |

---

## 5. 结论

**F004 = PASS。**

heterogeneous 的签发语义（bridge + local-cli 可组合、a2a 仍拒、family 互斥仍在、slow 仍需 a2a）、TypeScript catalog mirror 与服务端 intent 校验的一致性、既有动态三角色 UI 的展示与 Coordinator-host-native / same-session bridge 的中英双语文案区分，均按 acceptance 逐条实测通过；准入门槛是 strict VM provider 的 live attestation 与 bridge protocol，而非工具名（陌生 `acme-cli` 走通同一路径可证）。上一轮 FAIL 的三条复现步骤全部不再复现。

### 非阻断观察（供 Planner 参考，不改变本轮判定）

| # | 观察 | 建议归属 |
|---|---|---|
| S1 | 通用 ACP 驱动模块名为 `session_bridge_kimi.py`，并被完整性清单固定。功能上中立，但命名易被误读为工具特判 | F001/F003 后续整洁性改进 |
| S2 | `ModeEditor` 的 `SelectedRoleContext`「可用工具」面板直接用传入的 `tools`，不再自行过滤 proof；当前生产路径上游 `parseHarnessDetailModes` 已过滤，故一致。若未来有调用方绕过 detail 解析直传目录，该面板会显示不可选的 bridge | 组件健壮性 soft-watch |
| S3 | 并行 evaluator 的 untracked 探针脚本使共享工作树 `npm run verify` 变红 | 编排者在合并/提交前处理 |
