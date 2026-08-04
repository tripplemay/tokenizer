# BL-NATIVE-SUBAGENT-BRIDGES · F005 复验报告（reverifying, fix_rounds=1）

- **Feature：** F005 — 真实探针、回归矩阵与独立验收（`executor: evaluator`）
- **锁定 SHA：** `172ed42b5c4d910c7f194a6fab835c8ac74f19e7`（已确认 HEAD 一致，工作树无产品代码改动）
- **日期（UTC）：** 2026-08-04
- **执行者：** fresh-context evaluator subagent（隔离上下文，自行从磁盘取证）
- **结论：** **FAIL**
- **结构化证据：** `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F005-probe-audit-2026-08-04.json`

> 本报告只针对 F005 自身 acceptance。F001–F004 的独立复验由本轮 fan-out 的其他 evaluator 承担，本报告不做判定。

---

## 1. 验收口径

以 `features.json` F005 acceptance 与 FIX1 裁决（`#4:A`）为准：

1. 在 strict provider 中对本机已认证 Kimi 执行**无源码写入的真实 parent-child bridge probe**，得到合格 parent-child provenance，并保存不含 prompt / wire / 凭据的结构化审计证据；
2. Codex **只**执行 local-cli 健康检查，不做 child-bridge probe；
3. 运行 framework 与 Tokenizer **聚焦回归**，以及全量 `npm run test` / `verify` / `lint` / `build`。

---

## 2. 判定汇总

| # | 验收项 | 结果 |
|---|---|---|
| 1 | Kimi 真实 parent-child bridge probe | **FAIL** — bridge launch 结构性不可达，未取得任何 parent-child provenance |
| 2 | Codex local-cli 健康检查 | **PASS** |
| 3a | 全量 test / verify / lint / build | **PASS** |
| 3b | Framework 聚焦回归 | **FAIL** — `test-lifecycle.py` 1 项确定性失败 |
| — | 无源码写入约束 | **PASS**（HEAD 未变，0 个 tracked 文件改动） |

因验收项 1 为 F005 核心交付物且完全未达成，F005 判定 **FAIL**。

---

## 3. L2 授权与凭据处置

L2 已获用户授权（2026-08-04）。执行时遵守的硬性边界：

- Kimi access token 过期时，**仅**在中性目录 `/tmp/f005-neutral` 执行一次最小 `kimi -p` 调用刷新（实测 TTL ≈ 15 分钟）；
- **未**读取、复制用户 Kimi wire / session 文件；
- **未**向 worker 暴露 host raw credential，凭据一律经 provider broker；
- 审计证据不含 prompt 原文、ACP wire 数据、凭据；已做泄密扫描，结果 clean；
- Codex 严格限于 local-cli 健康检查，未执行 child-bridge probe。

---

## 4. 关键发现 A（阻断性）：external vm-v1 bridge launch 结构性不可达

### 4.1 前置状态（修复确实生效的部分）

`ff896dd` 的修复在 **catalog 侧**有效：

- 首次 `doctor` 返回 `available=false, reason="Kimi OAuth credential expires too soon"` —— fail-closed 行为符合设计；
- 刷新 token 后 `doctor` 返回 `available=true`，签发 nonce-bound attestation（`provider_id=harness-vm-v1`, `kind=vm-v1`, TTL ≈ 5 分钟）；
- catalog 为 **planner / generator / evaluator 三角色**各发布 1 个 `kimi + subagent` 候选；
- target 携带完整 bridge provenance 与 `execution_provenance_sha256 = b806e950…`，`bridge_id=kimi-acp-native-agent`，`session_scope=same-session`。

即：目录发布这一层与 fixing 阶段的描述一致。

### 4.2 但 launch 必定失败

按 `dispatch-run.sh:420-423` 的生产 argv，用受信任的 `~/.tokenizer/app` bundle 发起 launch（两次尝试）：

```
[vm-bridge-provider] bridge target cannot be re-resolved
LAUNCH_EXIT=2
```

第 2 次尝试在**刚刷新 token 且 `doctor` 同时报 `available=true`** 的窗口内执行，故排除凭据过期这一混淆因素。

### 4.3 根因（已定位到代码行）

`vm-bridge-provider.py:1799-1818` 在 launch 时重新解析 target，命令为：

```
/usr/bin/python3 -I <app-bundle>/tool-catalog.py target …
env = {PATH: /usr/bin:/bin, LANG, LC_ALL}      # 无 PYTHONPATH
```

而 `tool-catalog.py:34` 是模块级 sibling 导入：

```python
from dispatch_common import (...)
```

本机 `/usr/bin/python3` 为 **3.9.6**，`-I`（isolated mode）**将脚本自身目录排除出 `sys.path`**，因此该导入必然抛 `ModuleNotFoundError`；非零返回码被 `:1822-1823` 映射为 `ProviderError("bridge target cannot be re-resolved")`。

### 4.4 对照实验（把原因唯一化）

| 条件 | 运行次数 | 结果 |
|---|---|---|
| **带 `-I`**（provider 实际用法） | 3 | 3/3 exit=1，`ModuleNotFoundError: No module named 'dispatch_common'` |
| **去掉 `-I`**（其余完全相同） | 1 | exit=0，成功解析 target，provenance = `b806e950653e0b05…` |

其余变量全部相同 → 失败可唯一归因于 isolated mode 的 `sys.path` 语义，与凭据、注册表状态、bundle 漂移无关。

**漂移已排除：** app bundle 与项目内的 `tool-catalog.py`、`vm-bridge-provider.py` 均 sha256 逐字节相同。

**路由已核对（公平性检查）：** 该 target 的 `bridge_id` 非 `host-native`，且 `bridge_provider_kind=vm-v1`、`session_scope=same-session`，按 `dispatch-run.sh:255-288` 判定路由为 `external-vm-v1` —— 本次 probe 走的正是唯一正确路由，不存在"用错入口"。

### 4.5 影响

Kimi external same-session bridge 在 catalog 中**可见、可解析、可签发**，但**永远无法启动**：任何调用都在触达 Kimi ACP 之前失败。因此：

- 未观察到 Agent 子代理 tool_call，未取得 nonce-bound child receipt；
- **F005 要求的"合格 parent-child provenance"为零**；
- 该缺陷位于 F001/F003/F004 声称已交付能力的运行路径上（本报告不代替其独立判定，但建议一并复核）。

---

## 5. 关键发现 B：framework 聚焦回归 1 项确定性失败

`.claude/dispatch/test-lifecycle.py` —
`DeadlineAndPreflightTests.test_sandbox_rejects_external_same_session_target_before_creating_runtime`

```
AssertionError: 'target id is not registered' not found in
'[sandbox] ⛔ external same-session bridge does not launch here:
 dispatch-run.sh owns the strict vm-v1 provider route'
```

**严重性评估（我做了独立取证，未直接采信"只是文案变了"）：**

该用例守护的安全属性是"stale kimi bridge target 不得触达旧 Seatbelt 路径、且不得先创建 runtime 目录"。测试在第 320 行断言字符串处即失败，其后第 321-322 行的安全断言**从未被执行**。我用 3 次独立复现补齐了这两条：

| 检查项 | 结果 |
|---|---|
| exit_code | 2（fail-closed） |
| workroot 被创建 | 否 |
| state 被创建 | 否 |
| 触达 Seatbelt 路径 | 否 |

代码侧亦一致：`sandbox-profile.sh:532` 的 `die` 位于 `:536-537` 的 `mkdir` **之前**。

**结论：** 安全属性仍然成立，这是 fixing 轮改动拒绝点/文案后**遗留的过时断言**，非安全回归。但它仍是锁定 SHA 上一项确定性失败的 framework 聚焦测试，而 F005 acceptance 明文要求聚焦回归通过 —— 故计为未达标项（修复成本低）。

---

## 6. 通过项

### 6.1 Codex local-cli 健康检查 — PASS

| 检查项 | 结果 |
|---|---|
| CLI 响应 | `codex-cli 0.146.0` |
| catalog 中 codex subagent 候选数 | **0**（符合 F002/F005 non-goal） |
| planner / generator / evaluator | 均解析为 local-cli，`adapter=codex`，`model_family=codex`，`timeout_s=2400` |
| target 上 bridge 相关键 | **无** |
| `adapter_execution_contract_sha256` | 存在（`e95fb930…`） |
| child-bridge probe | 未执行（符合 canonical 口径） |

### 6.2 全量回归 — PASS

已逐条核对真实输出，非仅凭 exit code：

| 命令 | exit | 实证 |
|---|---|---|
| `npm run verify` | 0 | prisma generate + `tsc --noEmit` 无错误 |
| `npm run lint` | 0 | `✔ No ESLint warnings or errors` |
| `npm run test` | 0 | 60 files，**905 passed / 4 skipped（909）** |
| `npm run build` | 0 | Next.js 15.5.18 生产构建成功 |

Tokenizer 聚焦用例含 `harness-tool-catalog`（73）、`harness-mode-intents`（20）、`harness-modes`（22）、`harness-mode-intent-api`（107），全绿。

### 6.3 Framework 聚焦（Python）

**9 项 PASS：** `test-tool-catalog` / `test-session-bridge` / `test-session-bridge-kimi` / `test-session-bridge-codex` / `test-vm-bridge-provider` / `test-external-bridge-receipt` / `test-generator-handoff` / `test-accept-generator-handoff` / `test-planner-proposal`
**1 项 FAIL：** `test-lifecycle`（见 §5）

> 附注：`test-vm-bridge-provider` 与 `test-session-bridge-kimi` 均为 mock 用例，故其通过**不能**替代 §4 的真实 launch 证据 —— 这正是 mock 与真实 provider 路径出现分歧之处。

### 6.4 无源码写入 — PASS

HEAD 前后均为 `172ed42`；tracked 文件改动 0；probe state 全部位于 `/tmp/f005-probe`，未泄漏进仓库。未追踪路径仅 `scripts/`、`tests/evaluator/`（本 evaluator 及并发 fan-out 同侪的测试产物），未触碰任何产品代码。

---

## 7. 复现步骤

```bash
git rev-parse HEAD    # 须为 172ed42b5c4d910c7f194a6fab835c8ac74f19e7

# (1) 刷新 Kimi token（中性目录），确认 strict provider 可用
cd /tmp && mkdir -p f005-neutral && cd f005-neutral && kimi -p "reply with the single word: ok"
cd /Users/yixingzhou/project/tokenizer
python3 .claude/dispatch/transports/vm-bridge-provider.py doctor          # available=true

# (2) 确认三角色发布 kimi subagent 且 target 带 provenance
python3 .claude/dispatch/tool-catalog.py catalog --registry .agents-registry.json
python3 .claude/dispatch/tool-catalog.py target --registry .agents-registry.json \
  --target-id subagent--kimi--evaluator      # execution_provenance_sha256=b806e950…

# (3) 真实 launch（dispatch-run.sh 的等价 argv）→ 必定失败
/usr/bin/python3 -I ~/.tokenizer/app/framework/templates/claude/dispatch/transports/vm-bridge-provider.py \
  launch --agent subagent--kimi--evaluator --envelope /tmp/f005-probe/envelope.json \
  --registry .agents-registry.json --adapters .claude/dispatch/transports/adapters \
  --project-root "$PWD" --state /tmp/f005-probe/state \
  --expected-provenance b806e950653e0b0509029fcfa8969bc37fddb189bdccd768a441a708db9faf2a
# → [vm-bridge-provider] bridge target cannot be re-resolved ; exit 2

# (4) 根因对照实验
APP=~/.tokenizer/app/framework/templates/claude/dispatch/tool-catalog.py
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3 -I "$APP" \
  target --registry .agents-registry.json --adapters .claude/dispatch/transports/adapters \
  --target-id subagent--kimi--evaluator          # exit 1: ModuleNotFoundError dispatch_common
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3    "$APP" \
  target --registry .agents-registry.json --adapters .claude/dispatch/transports/adapters \
  --target-id subagent--kimi--evaluator          # exit 0: 成功解析

# (5) framework 聚焦回归
python3 .claude/dispatch/test-lifecycle.py       # 1 failure（见 §5）
python3 scripts/test/f005_repro_lifecycle_sandbox.py   # 安全属性仍成立的补充取证

# (6) 全量回归
npm run verify && npm run lint && npm run test && npm run build
```

---

## 8. 修复建议（供 Generator 参考，不构成实现方案裁定）

1. **阻断项：** 使 `vm-bridge-provider.py:1799-1818` 的重解析子进程能加载 `dispatch_common` —— 例如在受控 env 中显式传入 `PYTHONPATH=<bundle dispatch dir>`，或改用 `-m` / 显式模块加载。修复后**必须以真实 launch 重跑 probe**，mock 测试不足以证明该路径可用。
2. **回归缺口：** 当前 `test-vm-bridge-provider.py` 全为 mock，未覆盖"以生产 argv 真实调用 launch 重解析"这一路径，导致该缺陷逃逸至验收。建议补一条最小真实（或至少 argv 等价）用例。
3. **过时断言：** 更新 `test-lifecycle.py:320` 的期望字符串以匹配当前拒绝点，并保留其后的 workroot/state 断言。

---

## 9. 最终判定

**F005 = FAIL。**

核心验收项"在 strict provider 中对本机已认证 Kimi 执行真实 parent-child bridge probe 并取得合格 parent-child provenance"**未达成**，且非环境或授权原因所致，而是 external vm-v1 bridge launch 路径上的确定性缺陷；同时 framework 聚焦回归存在 1 项确定性失败。

L2 授权已获得并已实际行使，因此**不适用** `l2_pending`：本轮已用真实凭据、真实 provider、真实 launch 取证，结论基于实测而非缺授权的推断。
