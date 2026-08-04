# BL-NATIVE-SUBAGENT-BRIDGES · F005 复验报告（reverifying, fix_rounds=2）

- **Feature：** F005 — 真实探针、回归矩阵与独立验收（`executor: evaluator`）
- **锁定 SHA：** `7a84b0dff94649fb617761e4e371bf872dd073aa`（执行前后均确认 HEAD 一致，tracked 文件零改动）
- **日期（UTC）：** 2026-08-04（探针窗口 05:07:51Z – 05:18:20Z）
- **执行者：** fresh-context evaluator（隔离上下文，自行从磁盘取证；未接受任何关于实现质量的转述）
- **结论：** **PASS**
- **结构化审计证据：** `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F005-r2-probe-audit-2026-08-04.json`

> 本报告只判定 F005 自身 acceptance。F003 由本轮另一 fresh-context evaluator 复验；F001/F002/F004 上轮 PASS 不由本报告重判。verifying→done 闸门不由本 evaluator 创建。
> §7 的三条 observation 中，OBS-1 落在 F003/F001 的验收面上，**可能构成批次级阻断**——请编排者在汇总时一并权衡，不要因本报告 PASS 就默认全批次可放行。

---

## 1. 验收口径

以 `features.json` F005 acceptance、`docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-spec.md` §F005 与 FIX1 裁决 `#4:A` 为准：

1. 在 strict provider 中对本机已认证 Kimi 执行**无源码写入的真实 parent-child bridge probe**，取得合格 parent-child provenance，并保存**不含 prompt / wire / 凭据**的结构化审计证据；
2. Codex **只**执行 local-cli 健康检查，不做 child-bridge probe；
3. 运行 framework 与 Tokenizer 聚焦回归，以及全量 `npm run test` / `verify` / `lint` / `build`；
4. 批准前不得推送产品部署或更新安装 Agent。

---

## 2. 判定汇总

| # | 验收项 | 结果 | 依据 |
|---|---|---|---|
| 1 | Kimi 真实 parent-child bridge probe | **PASS** | 2/2 成功，nonce-bound child receipt，见 §4 |
| 1b | 审计证据脱敏 | **PASS** | 泄密扫描 0 命中，见 §4.5 |
| 2 | Codex 只做 local-cli 健康检查 | **PASS** | 见 §5 |
| 3a | Framework 聚焦回归 | **PASS** | 10/10 套全绿（上轮 FAIL 的 `test-lifecycle` 已修复），见 §6.1 |
| 3b | 全量 test / verify / lint / build | **PASS** | 见 §6.2 |
| 4 | 无源码写入 / 未推送 / 未更新 Agent | **PASS** | 见 §8 |

上轮（fix_rounds=1）F005 的两个 FAIL 点均已消除：

| 上轮 FAIL | 本轮实测 |
|---|---|
| external vm-v1 bridge launch 结构性不可达（`-I` 重解析 → `ModuleNotFoundError: dispatch_common`） | **已修复**：`TARGET_RESOLUTION_PYTHON = ("/usr/bin/python3","-E","-s")`；生产 argv 下重解析 exit 0，端到端 launch 成功（§3、§4） |
| `test-lifecycle.py` 1 项确定性失败（过时断言） | **已修复**：53 tests OK（skipped=2），见 §6.1 与 OBS-3 |

---

## 3. 修复点定点复核（上轮阻断根因）

对照实验（其余变量完全相同，仅解释器 flag 不同）：

| 条件 | exit | 结果 |
|---|---|---|
| `/usr/bin/python3 -E -s <bundle>/tool-catalog.py target …`（当前生产用法） | 0 | 解析成功，`execution_provenance_sha256=b806e950…` |
| `/usr/bin/python3 -I …`（上轮阻断用法） | 1 | `ModuleNotFoundError: No module named 'dispatch_common'` |

**安全侧未被牺牲（我主动核对，未默认接受"换个 flag 就行"）：**

- `-E -s` 保留了 `-I` 的环境变量隔离与 user-site 隔离，只多出"脚本自身目录可导入"；
- 该目录即受信任 app bundle 的 dispatch 目录，`_trusted_app_bundle_root()`（`vm-bridge-provider.py:1734-1790`）在重解析之前逐级校验：非符号链接、非 group/other 可写、且 `APP_RUNTIME_FILES` 六个文件（现已含 `dispatch_common.py`）逐个校验为普通文件且非 group/other 可写；
- 本机实测 `~/.tokenizer/app/framework/templates/claude/dispatch` 为 `drwxr-xr-x`，满足上述约束；
- app bundle 与项目内六个 runtime 文件 sha256 **逐字节相同**（无漂移）。

`dispatch-run.sh` 的 launch 预检（`:307-410`，上轮修复的双重路径拼接）我按**原样抽取代码块**独立执行：exit 0，并打印出受信任 provider 路径——即生产入口的 bundle 校验现在确实可通过。

---

## 4. 验收项 1：真实 Kimi parent-child bridge probe（PASS）

### 4.1 执行方式

- 走 `dispatch-run.sh:424` 的**生产 argv**：`/usr/bin/python3 -I <trusted-bundle>/transports/vm-bridge-provider.py launch --agent … --expected-provenance …`；
  provider 路径由 §3 中原样抽取的 bundle 预检代码解析得出，非我手工指定。
- 未走 `dispatch-run.sh` 全入口的唯一原因：当前 `progress.json.mode_intent = null`，external vm-v1 路由要求"已验签 active mode 签发"，而签发 mode intent 属于人类闸门/控制台动作，不在 evaluator 权限内。该差异只影响**签发校验**，不影响 bridge 执行路径本身（provider 仍独立校验 `--expected-provenance` 与 target provenance 一致）。
- 凭据：仅在中性目录 `/tmp/f005r2-neutral` 用最小 `kimi -p` 刷新 access token（实测 TTL ≈ 13 分钟量级），launch 前确认剩余 TTL；**未读取、未复制用户 Kimi wire / session 文件**；worker 不接触 host raw credential。

### 4.2 结果：2 次成功（explore persona）

| 探针 | target | 起止（UTC） | exit | outcome | duration | subagent_type | terminal_status | source_changes |
|---|---|---|---|---|---|---|---|---|
| probe_1 | `subagent--kimi--evaluator` | 05:07:51 → 05:09:21 | 0 | RETURNED | 88s | `explore` | `completed` | `[]` |
| probe_2（控制组，另一 task_id） | `subagent--kimi--evaluator` | 05:17:01 → 05:18:20 | 0 | RETURNED | 77s | `explore` | `completed` | `[]` |

### 4.3 parent-child provenance 是否"合格"——逐条核对

以 `_validate_bridge_receipt`（`vm-bridge-provider.py:1348-1399`）与 `session_bridge_kimi.py:596-648` 的接受条件为准：

| 证据 | probe_1 实测 | 说明 |
|---|---|---|
| `nonce_sha256` | `c2e3f4a18fec…` | 与本次 **launch attestation** 的 `nonce_sha256` **完全相同** —— child 回执绑定到本次启动的一次性 nonce |
| launch attestation `phase` | `launch` | 与 catalog 阶段 attestation（`phase=catalog`, nonce `385895cc…`）是不同 nonce，证明每次 launch 重新签发 |
| `target_provenance_sha256` | `b806e950…` | 与 catalog 解析出的 evaluator target provenance 一致，且等于我传入的 `--expected-provenance` |
| `subagent_type` | `explore` | 等于 manifest 中 evaluator 的 `native_agent_type`；persona 绑定成立 |
| `terminal_status` | `completed` | 观察到 child 完成事件才接受 |
| `child_call_id_sha256` | `c34977f1…` | ACP child tool_call id 的摘要（probe_2 为 `00ed44e3…`，两次不同 → 非重放） |
| `session_id_sha256` | `9398453f…` | Harness 自有根会话；probe_2 不同 |
| `session_scope` / `bridge_kind` | `same-session` / `acp-native-agent/v1` | 与 target 协议绑定一致 |
| `provider_launch_attestation_sha256` | `b53c525b…` | 回执与本次 launch 证明互绑 |

**child 真的干了活（不是空壳回执）：** 返回的工件里，child 自述读取路径为 `/var/lib/harness-vm-v1/jobs/<guest-job-id>/source/package.json`，且报出 `name="tokenizer"`, `version="0.1.0"` —— 与 guest 侧 `guest_root` 布局一致、与仓内 `package.json` 一致。工件通过其声明 schema 的机械校验（`validate-verdict-artifact.sh` → ✓）。

### 4.4 隔离与"无源码写入"的实证

- **copy-in 成分核对（probe_1）**：归档共 926 条、725 个普通文件，其中 `source/` 下 **719 个文件与锁定 ref 的 `git ls-tree` 719 个 tracked 文件完全一一对应**（多出 0、缺失 0）；其余仅 6 个 harness 控制文件（3 个 runner、envelope、target、CLI bundle）。**没有任何凭据 / OAuth / session 材料被投入 guest。**
- **read-only 归约**：evaluator 角色下 `_reconcile_returned_source` 对任意源码 delta 抛错；两次探针 `source_changes=[]`。
- **工件落点**：child 工件只落在 provider 私有 staging（`~/.tokenizer/harness/vm-v1/runs/…/copyout/…`），**从未进入仓库**。
- provider state 仅写 `.harness-dispatch/f005r2/run-meta-*.json`（该目录已在 `.gitignore`）。

### 4.5 审计证据脱敏

`…-F005-r2-probe-audit-2026-08-04.json` 只含摘要、退出码、时间、provider 自产的 run-meta。机械扫描结果 **0 命中**：

- 凭据文件中的 `access_token` / `refresh_token` / `id_token` 值均**不出现**在证据中（程序内比对，未打印明文）；
- 无 `Bearer `、无 `HARNESS_ENVELOPE_JSON`、无 `CHILD_PROMPT`、无 `sessionUpdate` / `jsonrpc` 等 ACP wire 片段；
- envelope 内容只以 sha256 引用，不内联；guest job token 与 home 路径已脱敏。

---

## 5. 验收项 2：Codex local-cli 健康检查（PASS）

| 检查项 | 实测 |
|---|---|
| CLI 版本 | `codex-cli 0.146.0` |
| catalog 中 codex subagent 候选数 | **0**（planner/generator/evaluator 均只有 local-cli 与 a2a） |
| 三角色 target 解析 | 均 `invocation=local-cli`、`adapter=codex`、`model_family=codex`、`timeout_s=2400` |
| target 上 bridge 相关键 | **无**（`bridge_*` / `session_scope` / `native_agent_type` 全部缺席） |
| `adapter_execution_contract_sha256` | 存在（`e95fb9306e51…`） |
| `subagent--codex--evaluator` | **exit 2** — `target id is not registered`（fail-closed） |
| bridges 目录 | 仅 `kimi-acp-native-agent.json` |
| child-bridge probe | **未执行**（符合 FIX1 `#4:A` canonical 口径） |

---

## 6. 验收项 3：回归矩阵（PASS）

### 6.1 Framework 聚焦（Python）— 10/10 套通过

| 套件 | 用例数 | 结果 |
|---|---|---|
| `test-tool-catalog` | 37 | OK |
| `test-session-bridge` | 9 | OK |
| `test-session-bridge-kimi` | 18 | OK |
| `test-session-bridge-codex` | 9 | OK |
| **`test-vm-bridge-provider`** | 12 | OK（含新增用例 *"The launch re-resolution argv must execute tool-catalog.py itself."*） |
| `test-external-bridge-receipt` | 8 | OK |
| `test-generator-handoff` | 12 | OK |
| `test-accept-generator-handoff` | 11 | OK |
| `test-planner-proposal` | 7 | OK |
| **`test-lifecycle`** | 53 | OK（skipped=2，见 OBS-3） |

> 我不把 mock 套件通过当作真实路径可用的证据——§4 的真实 launch 才是。这里只确认 mock 层无回归。

### 6.2 Tokenizer 全量 — 全绿（逐条核对真实输出，非仅退出码）

| 命令 | exit | 实证 |
|---|---|---|
| `npm run verify` | 0 | prisma generate + `tsc --noEmit` 无错误 |
| `npm run lint` | 0 | `✔ No ESLint warnings or errors` |
| `npm run test` | 0 | 60 files，**905 passed / 4 skipped（909）** |
| `npm run build` | 0 | Next.js 生产构建成功 |

---

## 7. Observation（不改变 F005 判定，但须进入批次决策）

### OBS-1（**跨 feature，可能是批次级阻断**）planner persona 3/3 launch 失败，evaluator persona 同窗口 2/2 成功

| 探针 | role / persona | 起止（UTC） | exit | 结果 |
|---|---|---|---|---|
| probe_3 | planner / `plan` | 05:10:52 → 05:12:37 (105s) | 2 | `VM restricted provider unit failed` |
| probe_4（同信封重试） | planner / `plan` | 05:13:31 → 05:14:55 (84s) | 2 | 同上 |
| probe_5（**最小契约对照组**） | planner / `plan` | 05:15:25 → 05:16:36 (71s) | 2 | 同上 |
| probe_2（**persona 对照组**） | evaluator / `explore` | 05:17:01 → 05:18:20 (77s) | 0 | RETURNED / completed |

排除的混淆因素：

- **任务复杂度**：probe_5 的契约被压缩到"只写 `{"probe": true}`"，仍失败；
- **主机/provider 退化**：probe_2 在三次 planner 失败**之后**执行并成功；
- **凭据过期**：每次 planner launch 前剩余 TTL > 400s，且失败耗时 ≤105s；
- **签发漂移**：三次均传入 catalog 当场解析出的 planner provenance `cdc7ff92…`，provider 未报 provenance 类错误。

根因在 guest 内，**按设计不可从 host 侧观测**（provider 刻意不外泄 guest stdout/stderr，失败时不产出 bridge-result）。因此我只能断定：**catalog 发布了 planner 的 kimi subagent 候选、manifest 把它绑定到 `native_agent_type=plan`，但该路由在本机一次都没跑通。** generator（`coder`）persona 本次未探（属 F003 复验面）。

对批次的含义：F003 acceptance 明文要求"planner / generator / evaluator 分别使用受控的 plan / coder / explore persona"。是否据此判 F003 不达标，由 F003 的 evaluator 判定；但编排者在汇总"全 PASS 才举闸门"时必须看到这条。

### OBS-2（次要 / 可用性）本批次自己的 evaluator 交付路径与 baseline 冲突，两条规则互斥

- `validate-dispatch.sh` 把 evaluator 的 `deliverable.artifact` 锁死为 `docs/test-reports/<batch>-verdict.json`；
- `vm-bridge-provider._reconcile_returned_source:1686` 在"工件已存在于 baseline"时抛 `VM returned artifact conflicts with the commissioned base`；
- 而 `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-verdict.json` 在锁定 ref 上**已被 tracked**。

后果：若真把本批次的 evaluator 通过 bridge 派出去，会**跑完整轮、烧完 wall-clock，最后在 copy-out 归约阶段才失败**。
确定性复现（不启动 VM、不改产品代码）：`scripts/test/f005r2_artifact_baseline_collision.py`（exit 0 = 复现；对照组换新工件路径即被接受）。
本次探针因此使用 batch id `BL-NSB-PROBE-R2`，使受托工件路径为新路径。

### OBS-3（信息性）`test-lifecycle` 仍 skip 两条严格 bridge 用例

跳过理由字符串仍为 *"strict external same-session execution is unavailable until a VM/ephemeral-principal provider is integrated"*，而 vm-v1 provider 现在已存在并可执行。这两条守护的属性（"contained bridge 不得写主 checkout / 不得留存 raw ACP state"、"可信超时组必须收割 contained ACP child 树"）目前**只有本报告 §4.4 的人工探针证据**覆盖，自动化套件未覆盖。非失败项。

---

## 8. 无源码写入 / 未推送 / 未更新 Agent（PASS）

| 检查项 | 结果 |
|---|---|
| HEAD（执行前 / 后） | `7a84b0df…` / `7a84b0df…` 一致 |
| tracked 文件改动 | **0** |
| 本 evaluator 新增的未追踪文件 | `scripts/test/f005r2_artifact_baseline_collision.py`、本报告、审计 JSON（均在允许的测试产物路径内） |
| 产品代码 / `src/` / `prisma/` / 配置 / 框架文件 | 未触碰 |
| `git push` / 部署 / 更新安装 Agent | **未执行** |
| `git add` / `commit` | **未执行**（按编排者要求，提交由主上下文统一处理） |
| provider state | `.harness-dispatch/f005r2/`（gitignored） |

---

## 9. 复现步骤

```bash
git rev-parse HEAD    # 须为 7a84b0dff94649fb617761e4e371bf872dd073aa

# (0) app bundle 与项目一致性
for f in tool-catalog.py dispatch_common.py transports/vm-bridge-provider.py \
         transports/session-bridge.py transports/session_bridge_kimi.py transports/vm-bridge-worker.py; do
  shasum -a 256 ".claude/dispatch/$f" "$HOME/.tokenizer/app/framework/templates/claude/dispatch/$f"
done

# (1) provider 可用性与三角色发布
python3 .claude/dispatch/transports/vm-bridge-provider.py doctor          # available=true
python3 .claude/dispatch/tool-catalog.py catalog --registry .agents-registry.json \
  --adapters .claude/dispatch/transports/adapters                          # kimi subagent × 三角色；codex 无
python3 .claude/dispatch/tool-catalog.py target --registry .agents-registry.json \
  --adapters .claude/dispatch/transports/adapters --target-id subagent--kimi--evaluator
# → execution_provenance_sha256=b806e950653e0b0509029fcfa8969bc37fddb189bdccd768a441a708db9faf2a

# (2) 上轮阻断点的定点对照（-E -s 通过 / -I 失败）
APP="$HOME/.tokenizer/app/framework/templates/claude/dispatch/tool-catalog.py"
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3 -E -s "$APP" target \
  --registry "$PWD/.agents-registry.json" --adapters "$PWD/.claude/dispatch/transports/adapters" \
  --target-id subagent--kimi--evaluator     # exit 0
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3 -I    "$APP" target \
  --registry "$PWD/.agents-registry.json" --adapters "$PWD/.claude/dispatch/transports/adapters" \
  --target-id subagent--kimi--evaluator     # exit 1: ModuleNotFoundError dispatch_common

# (3) 刷新凭据（中性目录），构造信封并校验
mkdir -p /tmp/f005r2-neutral && (cd /tmp/f005r2-neutral && kimi -p "reply with the single word: ok")
#   信封见审计 JSON 的 envelopes.*.sha256；role=evaluator, batch=BL-NSB-PROBE-R2,
#   artifact=docs/test-reports/BL-NSB-PROBE-R2-verdict.json, l2_authorized=false
bash .claude/dispatch/validate-dispatch.sh envelope /tmp/f005r2/envelope-evaluator.json

# (4) 真实 launch（dispatch-run.sh:424 的生产 argv）
/usr/bin/python3 -I "$HOME/.tokenizer/app/framework/templates/claude/dispatch/transports/vm-bridge-provider.py" \
  launch --agent subagent--kimi--evaluator --envelope /tmp/f005r2/envelope-evaluator.json \
  --registry "$PWD/.agents-registry.json" --adapters "$PWD/.claude/dispatch/transports/adapters" \
  --project-root "$PWD" --state "$PWD/.harness-dispatch/f005r2" \
  --expected-provenance b806e950653e0b0509029fcfa8969bc37fddb189bdccd768a441a708db9faf2a
# → run-meta JSON：outcome=RETURNED, subagent_type=explore, terminal_status=completed, source_changes=[]

# (5) planner persona 对照（OBS-1，把 --agent 换成 subagent--kimi--planner，
#     --expected-provenance 换成 cdc7ff92…，信封 role=planner）→ exit 2, "VM restricted provider unit failed"

# (6) OBS-2 确定性复现
python3 scripts/test/f005r2_artifact_baseline_collision.py    # exit 0

# (7) 回归
for t in test-tool-catalog test-session-bridge test-session-bridge-kimi test-session-bridge-codex \
         test-vm-bridge-provider test-external-bridge-receipt test-generator-handoff \
         test-accept-generator-handoff test-planner-proposal test-lifecycle; do
  python3 .claude/dispatch/$t.py; done
npm run verify && npm run lint && npm run test && npm run build
```

---

## 10. 最终判定

**F005 = PASS。**

F005 自身的四项 acceptance 全部以实测证据达成：strict provider 下对本机已认证 Kimi 的真实 parent-child bridge probe 两次成功并取得合格、nonce 绑定、persona 绑定、attestation 互绑的 provenance；审计证据脱敏后落盘且泄密扫描 0 命中；Codex 严格限于 local-cli 健康检查；framework 与 Tokenizer 回归全绿；全程无源码写入、未推送、未部署、未更新安装 Agent。

**但 PASS 仅限 F005。** OBS-1（planner persona 3/3 不可用）落在 F003/F001 的验收面上，且 F005 acceptance 里"全 PASS 后举闸门"的前置条件因此**尚未自动满足**——闸门是否可举，取决于本轮 F003 复验结论与编排者的汇总，不由本报告决定。
