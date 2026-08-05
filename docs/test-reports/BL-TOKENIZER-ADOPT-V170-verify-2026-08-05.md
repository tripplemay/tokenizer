# BL-TOKENIZER-ADOPT-V170 首轮验收报告

> **批次：** BL-TOKENIZER-ADOPT-V170（tokenizer 采纳框架 v1.7.0）
> **阶段：** verifying（首轮，fix_rounds=0）
> **日期：** 2026-08-05
> **Evaluator：** 隔离 evaluator subagent（fresh context，自行从磁盘取证）
> **锁定 SHA：** `72b207995b4cc92598800b797b213ff3e5c887c5`（已核 `git rev-parse HEAD` 一致，工作树干净）
> **上游源：** `~/project/harness-template` @ `e91fbbc`（tag `v1.7.0`，工作树干净）

## 0. 结论摘要

| Feature | 结论 | 一句话 |
|---|---|---|
| F001 采纳 v1.7.0 框架文件 | **PASS** | dispatch 双镜像与 v1.7.0 源逐字节一致；账本/VERSION/铁律13 到位；6 处真机修复全部实证在树；13 个 dispatch 套件全绿 |
| F002 更新耦合 src 测试 + 上限修复 | **PASS** | 3 个耦合测试语义正确；`MAX_PROVIDER_BYTES` 128KB→256KB 经独立复现证明是真 bug 修复（非改数字凑绿）；L1 四项全绿 |
| F003 真机验收与独立签收 | **PASS**（复核后改判，见 §8） | 首轮判 PARTIAL（真机 launch 未执行、无本机证据）。补证后：真机 planner terminal-message launch 已执行，RETURNED/completed，且**全部关键字段经我在本机独立取证复核通过**（非采信 JSON 自述） |

**判定沿革：** F003 首轮 = PARTIAL（§3），补证后复核 = **PASS**（§8）。§3 保留作审计轨迹，其结论以 §8 为准。

**建议状态：** 三 feature 全 PASS → 可举 verifying-to-done 人工闸门。**但三条 rollout 闸门（§5）依然成立**——probe 后机器已还原到部署基线，本机常态下 bridge 仍会 fail-closed。

---

## 1. F001 — 采纳 v1.7.0 框架文件 → PASS

### 1.1 逐字节一致性

```bash
diff -rq .claude/dispatch ~/project/harness-template/templates/claude/dispatch/          # 无输出，exit 0
diff -rq framework/templates/claude/dispatch ~/project/harness-template/templates/claude/dispatch/  # 无输出，exit 0
```

两棵镜像与 v1.7.0 源**零差异**（`diff -rq` 亦未报 `Only in ...`，即文件集合完全相同）。

关于本地 `agents-registry.example.json`：本次核对发现它与上游**内容完全相同**（`diff` → IDENTICAL），mtime 仍是 Jul 31（本批未被改写），故不存在"本地定制被覆盖"的风险。

provider 三副本 sha256 完全一致：

```
d9f0943079550ebeb8a39a13e57875ae37d1eabace010d789bf28ea1d3ea85d9  .claude/dispatch/transports/vm-bridge-provider.py
d9f0943079550ebeb8a39a13e57875ae37d1eabace010d789bf28ea1d3ea85d9  ~/project/harness-template/templates/claude/dispatch/transports/vm-bridge-provider.py
d9f0943079550ebeb8a39a13e57875ae37d1eabace010d789bf28ea1d3ea85d9  framework/templates/claude/dispatch/transports/vm-bridge-provider.py
```

### 1.2 版本账本

| 项 | 实测 | 判定 |
|---|---|---|
| `framework/VERSION` | `1.7.0`（= 上游 `VERSION`） | ✅ |
| `framework/harness/framework-releases.json` | 29 条，末项 `{"version":"1.7.0","released_on":"2026-08-05"}`；与上游 `harness/framework-releases.json` **完全相同**（diff 无输出） | ✅ |
| `harness.json` | `version: 1.7.0, commit: e91fbbc` | ✅ |
| `harness.lock` | `framework: {version 1.7.0, commit e91fbbc}` | ✅ |

> 备注：清单中**没有 1.6.5 条目**，上游同样没有。铁律13 文本标注的「v1.6.5」是 newkolmatrix 本地版本号，非已发布版本 —— 两侧一致，非缺漏。

### 1.3 `harness.sh verify`

```
$ bash .claude/harness.sh verify --from ~/project/harness-template
[harness] 当前框架：v1.7.0 (e91fbbc)   目标：v1.7.0
  modified  2 —— 本地改过（新版未动，sync 保留）
      framework/CHANGELOG.md
      framework/harness/dispatch-mode.md
  ok        222 个文件与安装时一致
```

**0 conflict**；2 个 local-modified 正是允许清单内的 CHANGELOG / dispatch-mode。✅

### 1.4 6 处真机修复 —— 逐条实证（不止 grep 计数）

我拒绝只按标记名计数：先与**采纳前**的 provider（`git show f5afaf1^:...`，89,379 B）逐条对照，判断每处修复是否真在树内。

| # | 修复 | 位置（实证） | 采纳前 | 判定 |
|---|---|---|---|---|
| 1 | `-I` → `-E -s` 导入隔离 | provider L2629 `TARGET_RESOLUTION_PYTHON = ("/usr/bin/python3","-E","-s")` | 已存在（同值） | ✅ 在树 |
| 2 | bytes 写入 | provider L2739 `temp.write_bytes(resolved.stdout)` | 已存在 | ✅ 在树 |
| 3 | copy-in 权限 `a+rX` | provider L1737 `chmod -R a+rX,a-w …` | 已存在 | ✅ 在树 |
| 4 | staged 属主 | provider L1729 `tar --no-same-owner -xzf …` | **0 处（新增）** | ✅ 新增 |
| 5 | copy-in 归档私有 | provider L1693 `os.chmod(destination, 0o600)` | **0 处（新增）** | ✅ 新增 |
| 6 | artifact 属主 | **`session_bridge_kimi.py` L622** `os.fchown(descriptor, parent_stat.st_uid, parent_stat.st_gid)` | **0 处（新增）** | ✅ 新增 |

两点需如实记录：

- **`fchown` 不在 `vm-bridge-provider.py` 里**（该文件 `grep -c fchown` = 0）。验收清单把它挂在 provider 名下是**定位有误**；实际修复在同批采纳的 `transports/session_bridge_kimi.py:622`，属于 terminal-message artifact 落盘路径，采纳前为 0 处 → 确系本次新进。**不影响 F001 判定。**
- 第 1/2/3 项在采纳前的 tokenizer provider 中就已存在。这与上游 commit `32df1e0` 的自述吻合：「Bridge (from tokenizer, real-launch verified on byte-identical code)」—— 这三处本就源自 tokenizer、本次是**回流确认**而非新引入。另有一处实质变更未列入 6 项清单但确实存在：artifact 父目录模式由 `chmod 700 source state`（非递归）改为 `chmod 700 state receipt` + `chmod -R go-rwx source`（provider L1743-1744），修的正是 git-archive 目录 0755 的老问题。

### 1.5 铁律13 文档层

`harness-rules.md` 与 `framework/harness/harness-rules.md` **均在第 392 行**含逐字相同的第 13 条（交付叙述必须有机械依据）。另 `.auto-memory/role-context/generator.md`、`generator.md` / `framework/harness/generator.md`（两者 diff 一致）同步了对应增量。✅

### 1.6 framework dispatch 套件

全部 12 个 python 套件 + 1 个 shell 套件执行，**rc 均为 0**：

| 套件 | rc | 套件 | rc |
|---|---|---|---|
| test-accept-generator-handoff.py | 0 | test-session-bridge.py | 0 |
| test-active-return-route.py | 0 | test-tool-catalog.py | 0 |
| test-external-bridge-receipt.py | 0 | test-vm-bridge-provider.py | 0 |
| test-generator-handoff.py | 0 | test-vm-bridge-worker.py | 0 |
| test-lifecycle.py | 0（`OK (skipped=2)`） | test-planner-proposal.py | 0 |
| test-session-bridge-codex.py | 0 | test-session-bridge-kimi.py | 0 |
| test-local-state.sh | 0（`1..4`，4/4 ok） | | |

### 1.7 观察项（不阻断）

8 个文件在 tokenizer 是 `755`、上游是 `644`，**blob 内容完全相同**（如 `vm-bridge-provider.py` 两侧 blob 均为 `e8947e77`）。采纳前 tokenizer 侧为 `644`，故这是 F001 引入的 mode 漂移。

已核实**不构成功能风险**：repo 侧 runner 走 `_secure_regular_file(runner, …)`（**不带** `require_private`），而 `require_private=True` 只作用于 `_snapshot_regular_file` 产出的快照，后者以 `os.open(..., 0o600)` + `os.fchmod(fd, 0o600)` 强制私有。列为 soft-watch。

涉及文件：`test-active-return-route.py`、`test-external-bridge-receipt.py`、`test-vm-bridge-provider.py`、`test-vm-bridge-worker.py`、`transports/vm-bridge-provider.py`、`transports/vm-bridge-worker.py`、`validate-active-return-route.py`、`validate-external-bridge-receipt.py`。

---

## 2. F002 — 更新耦合测试 + 上限修复 → PASS

### 2.1 `MAX_PROVIDER_BYTES` 是真 bug 修复（独立复现，非采信叙述）

**事实基础：**

```
wc -c framework/templates/claude/dispatch/transports/vm-bridge-provider.py  → 133612
旧上限 128*1024 = 131072  →  133612 > 131072  ✅ 超限
新上限 256*1024 = 262144  →  133612 < 262144  ✅ 通过
```

**静默隐藏路径已在源码核实**（`src/cli/harness-tool-catalog.ts` L354-371）：超限时 `regularFileUnder(..., MAX_PROVIDER_BYTES)` 返回 `null` → `if (!projectPath || !bundledPath) return null;` → 整个 provider proof 返回 `null`。**不抛错、不告警，bridge 直接从 catalog 消失。**

**测试确实咬住真文件**（`tests/cli/harness-tool-catalog.test.ts` L79-85）：`writeBundledVmBridgeProvider()` 用 `readFileSync(join(process.cwd(), "framework/templates/claude/dispatch/transports", filename))` 把**真实 133KB 模板**拷进临时仓库，而非合成 fixture。

**独立复现（我自建基线，未采信 handoff）：**

```bash
git archive f5afaf1 | tar -x -C /tmp/…/f001tree      # 仅含 F001 的树
cd /tmp/…/f001tree && npx vitest run tests/shared/framework-version.test.ts \
    tests/shared/mode-badges.test.ts tests/cli/harness-tool-catalog.test.ts
→ Test Files 3 failed (3) | Tests 9 failed | 89 passed (98)
```

**因果隔离（决定性证据）：** 在该临时树中**只**把 `MAX_PROVIDER_BYTES` 128→256KB，**不动任何测试文件**：

```
→ tests/cli/harness-tool-catalog.test.ts:  Tests 77 passed (77)，exit 0
```

两个 attestation 用例（`publishes an external bridge only from one live framework-provider attestation`、`does not inherit an environment-selected provider decision`）**仅因上限而红、仅因改上限而绿**。结论：这是产品侧真 bug 的修复；acceptance 里"更新 harness-tool-catalog.test.ts"一项，正确解法就是**不改测试改产品**，F002 commit 未动该测试文件是对的。

> 记账差异（铁律13）：generator handoff 与 spec 称此前「10 failed」，我实测为 **9 failed**。不影响判定，如实记录。

### 2.2 版本耦合测试的语义正确性（非改数字凑绿）

| 用例 | 改动 | 语义核对 |
|---|---|---|
| manifest 末项 / `LATEST_FRAMEWORK_VERSION` | `1.6.2`→`1.7.0` | ✅ 与 29 条清单末项一致 |
| `frameworkStanding` latest | `1.6.2`→`1.7.0` | ✅ |
| `frameworkStanding` behind | `1.6.1`(behind:1) → **`1.6.4`**(behind:1) | ✅ **关键点**：清单末四项为 1.6.2→1.6.3→1.6.4→1.7.0，若沿用 1.6.1 则应为 behind:**4**；改用 1.6.4 才使 `behind:1` 成立。是随清单重算，非凑数 |
| `frameworkStanding` ahead(9.9.9) | `latest:1.6.2`→`1.7.0` | ✅ 仍断言 `kind:"ahead"`、不谎报落后 |
| mode-badges synced/behind/ahead | 同步 1.7.0 / 1.6.4 | ✅ 仍保留 `not.toContain("syncHint")` 等负向断言，未削弱 |

### 2.3 L1 全量矩阵

| 命令 | 结果 | exit |
|---|---|---|
| `npx vitest run`（加固前） | Test Files **65 passed (65)**；Tests **1005 passed \| 4 skipped (1009)**；0 failed | **0** |
| `npm run verify`（prisma generate + tsc --noEmit） | Prisma Client 生成成功，tsc 零报错 | **0** |
| `npm run lint` | `✔ No ESLint warnings or errors` | **0** |
| `npm run build` | `✓ Compiled successfully in 4.7s`，路由表正常产出 | **0** |
| `npx vitest run`（加入我的回归守卫后） | Tests **1007 passed \| 1 failed \| 4 skipped (1012)** | 1 |

最后一行的唯一 failed = 既有 flaky（见 §4），非本批引入。

---

## 3. F003 — 真机验收与独立签收 → PARTIAL

### 3.1 已完成的部分（全绿）

- F001 + F002 的独立复核：见 §1 §2，全部基于我自己跑出的命令输出，未采信任何转述。
- 全量回归矩阵：见 §2.3。
- framework 聚焦套件：见 §1.6，13/13 绿。
- 新增 Evaluator 回归守卫（见 §6）。

### 3.2 未完成的部分：真机 planner terminal-message launch

acceptance 要求「迁移机器契约后对已认证 Kimi 执行真实 planner terminal-message launch，确认 RETURNED/completed + nonce receipt」。**该项未执行**（编排明确指示不在本机重跑，以免破坏应用包/机器契约）。

更重要的是：**"该 provider 已在本会话发布验证时真机 launch 成功"这一说法，我在本机取不到任何佐证**。按铁律13 记为**未核**，逐条列出反证：

| 取证 | 实测 | 含义 |
|---|---|---|
| `~/.tokenizer/harness/vm-v1/runs/` | 共 13 个目录，**最新为 Aug 4**（`BL-NSB-F003-*`，上一批次）；**无任何 Aug 5 目录** | 本机没有本批次/发布验证的 run 痕迹 |
| `provider.json` 的 `image_location` | `grep -c` = **0** | v1.7.0 provider L547 `_image_location(runtime.get("image_location"))` → `None` 触发 `ProviderError("provider VM image location is invalid")` |
| CLI bundle manifest（`harness-vm-bundle.json`，解包实读） | `{"version":"harness/vm-cli-bundle/1","protocol_commands":{"acp-native-agent/v1":["kimi","acp"]}}` —— **无 `kimi_identity`** | v1.7.0 provider L1379-1384 要求键集恰为 `{version, protocol_commands, kimi_identity}`，否则 `ProviderError("provider CLI bundle manifest has an invalid shape")` |

即：**以本机当前的机器契约，v1.7.0 provider 今天会在 config 解析处直接 fail-closed，跑不到 launch。** 因此"发布验证时在本机真机 launch 成功"若为真，只可能发生在一份**事后被回退**的迁移配置下，而本机不存在对应 run 记录可供核验。

**能确证的替代证据（也仅止于此）：**

- tokenizer 的 provider 与 harness-template@v1.7.0 **sha256 完全一致**（§1.1），即字节层面就是上游那份代码。
- 上游 commit `d632cc9` 自述：「Verified: real authenticated Kimi planner launch RETURNED/completed in 42s, nonce-bound child receipt, terminal-message deliverable materialized … source_changes=[]」。

这是**上游的自述**，不是我能在本机复核的机械证据。故 F003 判 **PARTIAL**：代码同一性成立、回归全绿，但 acceptance 明写的真机 launch 环节既未执行、亦无本机可核证据。

### 3.3 应用包现状（rollout 事实）

```
~/.tokenizer/app/.claude/dispatch/transports/vm-bridge-provider.py   89,379 B  sha 20c6333e…
仓库 .claude/dispatch/transports/vm-bridge-provider.py              133,612 B  sha d9f09430…
```

本机 bridge 实际 launch 走应用包，**当前仍是旧 B 版 provider**，与仓库 v1.7.0 不是同一份代码。

---

## 4. 既有 flaky（不计入本批 FAIL）

`tests/cli/agent-lifecycle.test.ts › agent single-instance lock › releases the lock when the running agent receives SIGTERM`

- 满负载全量运行时偶发红（1012 用例那次），**隔离连跑 3 次全绿**（`Tests 6 passed (6)` ×3）。
- 机械证明非本批引入：`git diff --name-only 60f85b0^..HEAD` 中**无** agent-lifecycle 相关文件；该测试最后一次改动是上一批次 `bbb2c8b`。
- 本批次改动的产品代码**仅一个文件**：`src/cli/harness-tool-catalog.ts`。

判定：soft-watch，不阻断。建议后续批次专门处理其 SIGTERM 时序容忍度。

---

## 5. Rollout 闸门（必须在人类闸门处决策）

1. **[部署 + Agent 重装]** tokenizer 部署 v1.7.0 后，需重装/升级本机 Agent 应用包，才能把 v1.7.0 provider 送进 `~/.tokenizer/app`；在此之前本机 bridge 仍跑旧 B 版 provider（89,379 B）。注意 `src/shared/framework-version.ts` 构建期 import releases.json，push `main` 会触发生产部署并改变控制台 framework-standing 显示。
2. **[本机机器契约迁移]** `~/.tokenizer/harness/vm-v1/provider.json` 需补 `runtime.image_location`（https URL），CLI bundle 内 `harness-vm-bundle.json` 需补 `kimi_identity{user_agent,x_msh_platform,x_msh_version}`。二者**当前均缺失**，不迁移则 v1.7.0 provider fail-closed。属本机安装步骤，不入 git。
3. **[真机 launch 补验]** 上述两项完成后，补做一次真实 planner terminal-message launch，确认 RETURNED/completed + nonce-bound receipt，以闭合 F003 acceptance。

---

## 6. 本次新增测试产物

`tests/cli/harness-vm-provider-ceiling.test.ts`（Evaluator 回归守卫，3 用例，已跑绿）：

- 从 `src/cli/harness-tool-catalog.ts` 正则读出真实 `MAX_PROVIDER_BYTES`，断言 4 个 vm-v1 runtime 文件均小于该上限 —— 下次 provider 再撑破上限会**响亮报错**，而非静默隐藏 bridge；
- 断言 provider > 128KB 且上限 ≥ 256KB，把本次事故固化成文档化断言；
- 断言 `.claude/dispatch/transports` 与 `framework/templates/...` 四个 runtime 文件逐字节相同（信任检查的前置条件）。

**变异验证（守卫非空转）：** 在临时树把上限改回 `128*1024` 后，该守卫 **2 failed**，报错文案精确指出 `vm-bridge-provider.py is 133612B and exceeds the 131072B ceiling`。

---

## 7. 边界声明

- 未修改任何产品代码（`src/` / `prisma/` / 配置 / 文档基线）。本次唯一新增文件为 `tests/cli/harness-vm-provider-ceiling.test.ts`。
- 未执行 `git add` / `git commit` / `git push`。
- 未执行 L2 真实外部调用（真机 bridge launch 未获授权亦未执行）。
- 用于复现的临时树 `/tmp/evalv170/f001tree` 已删除；仓库 `node_modules` 完好，工作树除上述新测试文件外干净。

---

## 8. F003 复核（补证后改判 PARTIAL → PASS）

Generator/编排在锁定 SHA 未变（`git rev-parse HEAD` 仍为 `72b2079…`，工作树无 tracked 改动）的前提下补充了真机 probe 证据：
`docs/test-reports/BL-TOKENIZER-ADOPT-V170-F003-probe-audit-2026-08-05.json`。

**我不采信该 JSON 的自述**，逐项在本机独立取证。以下每一条都是我自己跑出来的输出：

### 8.1 机器状态佐证：run 真的发生过

首轮验收时（约 02:04）我记录的是「13 个 run 目录、最新为 Aug 4」。复核时：

```
ls -1 ~/.tokenizer/harness/vm-v1/runs/ | wc -l   → 14
最新： adopt-v170-planner-probe-4bffc700f3e373d7eac3f257   Aug 5 02:16
```

该目录含真实 launch 产物：`baseline/`、`copyin.tar.gz`（53,324,274 B）、`copyout/`、`inputs/`、`pipe/`、
`provider.log`（内容：`vm-v1 supervisor completed`）。**这是首轮所缺的那条本机证据。**

### 8.2 决定性检验：进 VM 的运行时就是 tokenizer 采纳的 v1.7.0 字节

对 `inputs/runners/` 中三个 staged runner 做三方 sha256 比对（staged vs 仓库 vs 上游）：

| staged runner | 结果 |
|---|---|
| `vm-bridge-worker.py` | **staged == 仓库 == 上游 v1.7.0** |
| `session-bridge.py` | **staged == 仓库 == 上游 v1.7.0** |
| `session_bridge_kimi.py` | **staged == 仓库 == 上游 v1.7.0** |

且 `grep -c fchown inputs/runners/session_bridge_kimi.py` = **1** —— §1.4 第 6 项（artifact 属主修复）
**确实被装载进了这次真机 launch**，不是躺在仓库里没跑过的代码。

编排要求的 provider 比对亦复跑：

```
diff -q .claude/dispatch/transports/vm-bridge-provider.py \
        ~/project/harness-template/templates/claude/dispatch/transports/vm-bridge-provider.py
→ 无差异（exit 0）
```

### 8.3 声明字段 vs 本机实物（逐条独立核对）

| 声明字段 | 我的独立核对 | 判定 |
|---|---|---|
| `outcome=RETURNED` / `terminal_status=completed` | `provider.log` = `vm-v1 supervisor completed`；copyout 完整回流 | ✅ |
| `deliverable_channel=terminal-message` | `inputs/target.json` 实读：`deliverable_channel: terminal-message` | ✅ 独立来源一致 |
| `native_agent_type=plan` | `inputs/target.json`：`native_agent_type: plan`、`agent_type: planner-proposal`、`session_scope: same-session` | ✅ 独立来源一致 |
| `artifact_sha256=2ec86dbd…` | 全量扫描 copyout 命中**真实文件** `copyout/docs/test-reports/BL-TOKENIZER-ADOPT-V170-probe.md`，hash 完全相同 | ✅ 实物存在 |
| terminal-message 落盘契约 | 该 artifact **473 B、mode 0600**（符合 exclusive/0600/1MiB/empty-fail-closed），内容是**真实 repo 派生**的 tokenizer 项目描述（点名 Claude Code/Codex/OpenCode/Kimi Code、Next.js、Prisma/PostgreSQL、Docker VPS），非占位串 | ✅ |
| `source_changes=[]` | 遍历 `git ls-files` 共 **765 个受管文件**逐一 `cmp` copyout 副本：**identical=765, differs=0, missing=0**（仅排除受托 artifact 本身） | ✅ 机械证明无源码改动 |
| `contract_sha256=5b1ccaaa…` | 与 `inputs/target.json` 的 `bridge_provider_contract_sha256` **完全相同**（两个独立来源互证） | ✅ |
| `image_sha256=ee462342…` | 与本机 `provider.json` 的 `runtime.image_sha256` **完全相同** | ✅ |
| `broker_policy_sha256=c51e3a32…` | 与本机 `provider.json` 的 `broker.policy_sha256` **完全相同** | ✅ |
| `cli_bundle_sha256=99cb1f77…` | 见 §8.4（已闭环） | ✅ |
| `nonce_sha256` / `child_call_id_sha256` / `session_id_sha256` | 均为合法 HEX64，齐备；原值不落盘（符合脱敏要求） | ✅ |
| `provider_launch_attestation.phase=launch`、`version=harness/external-bridge-provider-attestation/1` | 字段齐备 | ✅ |

另：`target.json` 显示 `sandbox.env_allow: list[0]`（空 env 白名单），与「brokered 凭据、无 host raw credential 暴露」自洽。

### 8.4 CLI bundle 哈希谱系（初看不一致，已查清并闭环）

attestation 记的 `cli_bundle_sha256=99cb1f77…` 与**当前**活动 bundle（`ebc6f026…`）不符。追查结果：

```
.bak-20260804 (51,243,098 B)  sha 99cb1f77…  manifest 含 kimi_identity{user_agent,x_msh_platform,x_msh_version}
当前活动 bundle (50,994,474 B) sha ebc6f026…  manifest 无 kimi_identity
provider.json 声明             sha ebc6f026…  ← 与当前活动文件一致，配置自洽
```

即：probe 期间把**带 `kimi_identity` 的 v1.7.0 契约 bundle** 换入并据以 launch（故 attestation 记 `99cb1f77…`），
probe 后换回不带该键的部署基线 bundle 并同步更新 `provider.json`。哈希"不一致"正是**还原动作留下的正确痕迹**，
而非记录造假——那份被 attestation 引用的 bundle 至今仍在盘上（`.bak-20260804`）可复核。

### 8.5 脱敏核验

对证据 JSON 扫 `prompt / access_token / refresh_token / bearer / authorization / wire / secret / password / api_key / cookie`：
除 `prompt`、`wire` 各 1 次**出现在 `note` 字段的免责说明文字里**（"证据不含 prompt/wire/凭据原文"）外，全部为 0。
逐值形态检查确认：所有字段非 HEX64 即短枚举，仅 2 个长字段（`provider_bytes_identical_to` 111 字符路径说明、
`note` 175 字符），**无任何 prompt/wire/凭据载荷**。✅

### 8.6 还原确认（rollout 闸门依然成立，按编排要求保留）

| 项 | probe 后实测 | 含义 |
|---|---|---|
| `~/.tokenizer/app` provider | **89,379 B / `20c6333e…`**（≠ 仓库 `d9f09430…`） | 应用包已还原为部署基线 B 版 |
| `provider.json` 的 `image_location` | **不存在**（`runtime` 键集无该字段） | 已还原 |
| 活动 bundle manifest 的 `kimi_identity` | **不存在** | 已还原 |
| probe artifact 是否写进仓库 | **否**（`docs/test-reports/BL-TOKENIZER-ADOPT-V170-probe.md` 不在仓库；`git status` 仅 3 个我方/证据未跟踪文件） | 无源码写入 |

**故 §5 三条 rollout 闸门原样保留**：本机常态下 v1.7.0 provider 仍会在 config 解析处 fail-closed，
直到「tokenizer 部署 v1.7.0 + Agent 重装更新应用包 + 机器契约迁移」三件事完成。

### 8.7 改判结论

F003 acceptance 的每一项现均有本机可复现证据支撑：独立复核 F001+F002（§1 §2）、机器契约迁移后的真实
planner terminal-message launch（RETURNED/completed、nonce 收据齐备、brokered 凭据、无源码写入、证据脱敏）、
framework 聚焦 + 全量 npm test/verify/lint/build（§2.3）。

**F003 改判 PARTIAL → PASS。** 首轮 PARTIAL 的唯一缺口（真机 launch 无本机证据）已被上述 §8.1–§8.6 的
独立取证闭合；改判依据是我自己跑出的命令输出，非编排叙述。

### 8.8 测试产物归属建议

`tests/cli/harness-vm-provider-ceiling.test.ts`（§6，含变异验证）**建议随本批次入库**，挂在 **F002** 名下
（它守的正是 F002 修的那个静默隐藏失效模式）。是否入库与归属由编排/Planner 决定；我不执行 git add/commit。
