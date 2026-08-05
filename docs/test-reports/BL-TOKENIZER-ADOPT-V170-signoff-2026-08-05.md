# BL-TOKENIZER-ADOPT-V170 Signoff 2026-08-05

> 状态：**Evaluator 已签收（全 PASS）** — 建议 progress.json 由 `verifying` 推进至 `done`（先经人工闸门）
> 触发：首轮 verifying（`fix_rounds=0`）；F001/F002 首轮即 PASS，F003 首轮判 PARTIAL 后由编排补充真机 probe 证据，经本人独立复核改判 PASS
> 签署人：**evaluator-subagent**（fresh-context 隔离实例）
> 签署 SHA：`72b207995b4cc92598800b797b213ff3e5c887c5`（签署时核对 HEAD 一致；`git diff --stat` 为空，工作树除 Evaluator/证据产物外干净）
> 上游基准：`harness-template` @ `e91fbbc`（tag `v1.7.0`，工作树干净）

---

## 变更背景

tokenizer 的框架镜像停在 v1.6.2，而 harness-template 已发布 v1.7.0（含经真机验证的 A 血统 vm-v1
provider、`deliverable_channels`、铁律13、codex `--ignore-user-config` 硬化）。同时 tokenizer 的三个 src 测试
与 1.6.2 硬耦合，直接升版会破坏它们。本批次让 tokenizer 干净采纳 v1.7.0，并在采纳过程中暴露并修复了一个
真实产品缺陷（provider 体积超过 TS 目录信任检查上限导致 subagent bridge 被静默隐藏）。

批次为普通批次，**0 轮 fixing**：`planning → building → verifying → done`。

---

## 一、三 feature 判定汇总（机械汇总，判定权归签收人）

| Feature | Executor | 判定 | 依据出处 |
|---|---|---|---|
| **F001** 采纳 v1.7.0 框架文件（dispatch runtime、releases.json、VERSION、docs、账本） | generator | **PASS** | verify 报告 §1 |
| **F002** 更新版本耦合的 3 个 vitest + provider 体积上限修复 | generator | **PASS** | verify 报告 §2 |
| **F003** 真机验收与独立签收 | evaluator | **PASS**（首轮 PARTIAL → 复核改判） | verify 报告 §3（首轮轨迹）+ **§8（改判依据，以此为准）** |

### F001 要点

- `.claude/dispatch/**` 与 `framework/templates/claude/dispatch/**` 对 v1.7.0 源 `diff -rq` **零差异**，文件集合相同；provider 三副本 sha256 均为 `d9f09430…`。本地 `agents-registry.example.json` 未被改写、内容与上游相同，无定制丢失。
- `framework/VERSION`=1.7.0；`framework-releases.json` 与上游逐字相同（29 条，末项 1.7.0 / 2026-08-05）；`harness.json` / `harness.lock` 均记 1.7.0 / `e91fbbc`。
- `harness.sh verify --from ~/project/harness-template`：**222 ok、0 conflict**、2 个允许的 local-modified（`framework/CHANGELOG.md`、`framework/harness/dispatch-mode.md`）。
- 6 处真机修复经与采纳前（`f5afaf1^`）逐条对照实证在树；铁律13 在 root 与 framework 两份 `harness-rules.md` 第 392 行逐字相同。
- 13 个 framework dispatch 套件（12 python + `test-local-state.sh`）**全部 rc=0**。

### F002 要点

- `MAX_PROVIDER_BYTES` 128KB→256KB 是**真 bug 修复**，非改数字凑绿。provider = 133,612 B > 旧上限 131,072 B；超限时 `regularFileUnder` 返回 `null` → provider proof 返回 `null` → **bridge 静默从 catalog 消失，不抛错不告警**。
- **因果隔离（决定性）：** 在 F001-only 的临时树中**只**改上限、不动任何测试文件 → `harness-tool-catalog.test.ts` 由 2 failed 变 **77/77 全绿**。故 acceptance 中"更新 `harness-tool-catalog.test.ts`"的正确解法就是改产品而非改测试，F002 未动该测试文件是对的。
- 版本耦合断言语义正确：behind 用例由 `1.6.1` 改为 `1.6.4` 是随清单重算的**必要**修正（末四项 1.6.2→1.6.3→1.6.4→1.7.0，沿用 1.6.1 应为 `behind:4`），负向断言（`not.toContain("syncHint")` 等）未削弱。

### F003 要点（改判依据）

真机 planner terminal-message launch 已执行，且**全部关键字段由签收人在本机独立取证复核**（非采信 probe JSON 自述）：

| 核验项 | 独立证据 |
|---|---|
| launch 真的发生 | run 目录由 13 → **14**，新增 `adopt-v170-planner-probe-4bffc700f3e373d7eac3f257`（Aug 5 02:16），含 `copyin.tar.gz`(53,324,274 B)、`baseline/`、`copyout/`、`pipe/`、`provider.log`=`vm-v1 supervisor completed` |
| **跑的就是采纳的字节** | `inputs/runners/` 三个 staged runner 三方 sha256：**staged == 仓库 == 上游 v1.7.0**；staged `session_bridge_kimi.py` 的 `fchown` = 1（artifact 属主修复确被装载） |
| terminal-message 交付物 | `artifact_sha256=2ec86dbd…` 命中真实文件 `copyout/docs/test-reports/BL-TOKENIZER-ADOPT-V170-probe.md`；**473 B、mode 0600**；内容为真实 repo 派生的项目描述，非占位串 |
| `native_agent_type=plan` / `deliverable_channel=terminal-message` | 由**独立来源** `inputs/target.json` 实读一致（另含 `agent_type=planner-proposal`、`session_scope=same-session`、`sandbox.env_allow=[]`） |
| `source_changes=[]` | 遍历 `git ls-files` **765 个受管文件**逐一 `cmp`：**identical=765 / differs=0 / missing=0**（仅排除受托 artifact） |
| attestation 多源互证 | `contract_sha256` == `target.json` 的 `bridge_provider_contract_sha256`；`image_sha256`、`broker_policy_sha256` == 本机 `provider.json`；`phase=launch`、nonce/child_call_id/session_id 均为合法 HEX64 且原值不落盘 |
| `cli_bundle_sha256` 差异 | 已查清闭环：`99cb1f77…` 正是仍在盘上的 `.bak-20260804`，其 manifest **含** `kimi_identity`；probe 后换回基线 bundle 并同步 `provider.json`（当前声明与活动文件均为 `ebc6f026…`，配置自洽）。差异是**还原动作的正确痕迹** |
| 脱敏 | `access_token/refresh_token/bearer/authorization/secret/password/api_key/cookie` 全为 0；`prompt`/`wire` 各 1 次仅出现在 `note` 的免责说明文字中；逐值形态检查确认无凭据载荷 |
| 无源码写入 | probe artifact **未**写进仓库；`git diff --stat` 为空 |

---

## 二、证据索引

| 证据 | 路径 | 产出方 |
|---|---|---|
| 完整验收报告（三 feature 逐条取证 + §8 F003 改判依据） | `docs/test-reports/BL-TOKENIZER-ADOPT-V170-verify-2026-08-05.md` | 签收人 |
| F003 真机 probe 审计证据（脱敏 JSON） | `docs/test-reports/BL-TOKENIZER-ADOPT-V170-F003-probe-audit-2026-08-05.json` | 编排/Generator 侧产出，**经签收人独立复核** |
| provider 体积上限回归守卫（3 用例，含变异验证） | `tests/cli/harness-vm-provider-ceiling.test.ts` | 签收人（编排已确认随批入库，归属 **F002**） |
| 真机 run 产物（非 git 资产，本机可复核） | `~/.tokenizer/harness/vm-v1/runs/adopt-v170-planner-probe-4bffc700f3e373d7eac3f257/` | provider 运行时 |
| 规格文档 | `docs/specs/BL-TOKENIZER-ADOPT-V170-spec.md` | Planner |

---

## 三、L1 / L2 实测记录

### 3.1 L1（本机，签署 SHA `72b2079`，全部由签收人亲自运行）

| 命令 | 结果 | exit |
|---|---|---|
| `npx vitest run` | Test Files **65 passed (65)**；Tests **1005 passed / 4 skipped (1009)**；**0 failed** | **0** |
| `npm run verify`（`prisma generate && tsc --noEmit`） | Prisma Client 生成成功；tsc 零报错 | **0** |
| `npm run lint` | `✔ No ESLint warnings or errors`（0 error / 0 warning） | **0** |
| `npm run build` | `✓ Compiled successfully in 4.7s`，路由表正常产出 | **0** |
| framework dispatch 套件 ×13 | 12 个 python 套件 rc=0；`test-local-state.sh` `1..4` 全 ok | **0** |
| `bash .claude/harness.sh verify` | v1.7.0；222 ok；**0 conflict**；2 个允许的 local-modified | — |
| 新增回归守卫 | `harness-vm-provider-ceiling.test.ts` 3/3 passed；**变异验证**：上限改回 128KB 后 2 failed 并精确报出 `133612B exceeds 131072B` | **0** |

> 加入回归守卫后的全量运行为 1007 passed / 1 failed / 4 skipped，唯一 failed 是既有 flaky（见 Soft-watch S1），非本批引入。

### 3.2 L2（真实外部服务实测）

本批次**无 staging / 生产部署环节**（未 push、未部署），故传统 staging L2（`/api/health.git_sha` 比对、浏览器走查）**N/A**。
本批次的 L2 等价物是**真实外部 CLI（已认证 Kimi）经 vm-v1 bridge 的真机 launch**，已执行并经独立复核：

| 项 | 证据 |
|---|---|
| 真实外部调用 | 真实已认证 Kimi、planner 角色、`native_agent_type=plan`、`session_scope=same-session`，`outcome=RETURNED` / `terminal_status=completed`，duration 90s |
| 关键 invariant | `source_changes=[]` 经 765 文件逐一 `cmp` 机械验证；交付物 mode **0600**、473 B、内容真实 repo 派生；nonce-bound 收据齐备 |
| 凭据安全 | brokered 凭据（`sandbox.env_allow=[]`），无 host raw credential 暴露，证据脱敏扫描通过 |
| 运行时同一性 | staged runner 三方 sha256 == 仓库 == 上游 v1.7.0 |

> **执行说明（如实记录）：** 该 probe 期间临时将 v1.7.0 provider overlay 进 `~/.tokenizer/app` 并把机器契约迁移到 v1.7.0（`image_location` + `kimi_identity`）；probe 后**已还原** app bundle 与机器契约到部署基线（B）。签收时实测还原成功：app provider 仍为 89,379 B / `20c6333e…`，`provider.json` 无 `image_location`，活动 bundle manifest 无 `kimi_identity`。**因此本机常态下 bridge launch 仍会 fail-closed** —— 见第五节 rollout 闸门。

---

## 四、未变更范围

| 事项 | 说明 |
|---|---|
| 产品业务代码（`app/`、`src/server/`、`prisma/`） | 本批次为框架采纳，唯一被改的 src 文件是 `src/cli/harness-tool-catalog.ts`（一个常量 + 注释） |
| 数据库 schema / 迁移 | 无 schema 改动，无迁移 |
| `framework/CHANGELOG.md`、`framework/harness/dispatch-mode.md` | 本地已有定制，v1.7.0 未动这两文件，sync 予以保留（`harness verify` 标 local-modified，符合预期） |
| `.claude/dispatch/agents-registry.example.json` | 本机定制文件，未被改写（内容恰与上游相同） |

---

## 五、预期影响

| 项目 | 改动前 | 改动后 |
|---|---|---|
| `framework/VERSION` | 1.6.2 | **1.7.0** |
| `LATEST_FRAMEWORK_VERSION`（控制台 framework-standing 显示） | 1.6.2 | **1.7.0**（`framework-version.ts` 构建期 import releases.json） |
| `MAX_PROVIDER_BYTES` | 128 KB（**会静默隐藏 133 KB 的 v1.7.0 provider**） | **256 KB**（bridge 可正常发布） |
| vm-v1 provider | B 血统，89,379 B | **A 血统 v1.7.0，133,612 B**，含 6 处真机修复 + `deliverable_channels` |
| 全量 vitest | 采纳 v1.7.0 后未修则 9 failed | **0 failed** |

> ⚠️ **push `main` 即部署生产**：本批次改了 `src/cli/harness-tool-catalog.ts` 与 `framework/harness/framework-releases.json`（后者被 `framework-version.ts` 构建期 import），**不在 paths-ignore 豁免范围**，push 会触发部署并改变控制台 framework-standing 显示。部署时机由用户决定。

---

## 六、类型检查 / CI

```
$ npm run verify        → prisma generate ✔ + tsc --noEmit 零报错          exit 0
$ npm run lint          → ✔ No ESLint warnings or errors                   exit 0
$ npm run build         → ✓ Compiled successfully in 4.7s                  exit 0
$ npx vitest run        → 65 files / 1005 passed / 4 skipped / 0 failed     exit 0
```

**CI（`gh run`）：本批次尚未 push，故无 CI run 可核 —— 按铁律13 记为「未核」，不代为断言 CI 结果。**
Push 后由 Generator/编排按 `generator.md` 的 CI 守门流程跟踪（`gh run watch --workflow CI` + 显式核 conclusion）。

---

## 七、Ops 副作用记录

**本批次无数据库 ops。** 未对 prod / staging 数据库执行任何 SQL；未部署、未 push。

本批次唯一的机器级副作用是 F003 probe 对本机 Agent 应用包与 vm-v1 机器契约的**临时**修改，probe 后已还原并经签收人实测确认（见 §3.2 执行说明）；该副作用不入 git。

---

## 八、Rollout 闸门（原样列出，请人类在闸门处一并确认）

> 这三条是**部署/安装层面的前置条件**，不是代码缺陷，不阻断本批次 done；但在它们完成前，**本机常态下 v1.7.0 bridge 仍会 fail-closed**。

1. **[部署 + Agent 重装]** tokenizer 部署 v1.7.0 后需重装/升级本机 Agent 应用包，才能把 v1.7.0 provider 送进 `~/.tokenizer/app`。签收时实测该应用包仍为 **89,379 B / `20c6333e…`**（旧 B 版），与仓库 **133,612 B / `d9f09430…`** 非同一份代码。注意 push `main` 会触发生产部署并改变控制台 framework-standing 显示。

2. **[本机机器契约迁移]** probe 后机器已还原到部署基线：`~/.tokenizer/harness/vm-v1/provider.json` **无** `runtime.image_location`，活动 CLI bundle 的 `harness-vm-bundle.json` **无** `kimi_identity`。常态下 v1.7.0 provider 会在 config 解析处 fail-closed（`_image_location` raise / manifest shape raise）。正式启用前需再次迁移（可参考仍在盘上的 `.bak-20260804` bundle，其 manifest 已含 `kimi_identity{user_agent,x_msh_platform,x_msh_version}`）。属本机安装步骤，不入 git。

3. **[真机 launch —— 已闭合]** F003 的真实 planner terminal-message launch 已执行并经独立复核（RETURNED/completed、artifact 0600 实物、`source_changes` 765/765 机械验证、attestation 多源互证）。**此项闸门已闭合**，保留在此仅作 rollout 记录。

---

## 九、Soft-watch（不阻塞 done，均已明文兜底）

| ID | 描述 | 风险等级 | 建议处置（明文兜底） |
|---|---|---|---|
| **S1** | 既有 flaky：`tests/cli/agent-lifecycle.test.ts › agent single-instance lock › releases the lock when the running agent receives SIGTERM`，满负载全量运行时偶发红，隔离连跑 **3 次全绿**。`git diff --name-only 60f85b0^..HEAD` 证明本批未触碰该测试及其 src（末次改动为上一批次 `bbb2c8b`） | low | **不计入本批 FAIL**；已记入本 signoff 与 project-status，由 Planner 在下一批次 planning 时作为独立条目排期处理其 SIGTERM 时序容忍度；在此之前 CI 若因该条偶发变红，按"重跑 + 隔离验证"处置 |
| **S2** | 8 个 dispatch 文件在 tokenizer 为 `755`、上游为 `644`（blob 内容相同；采纳前为 `644`，系本批引入的 mode 漂移）。已核实无功能风险：repo 侧 runner 走 `_secure_regular_file` **不带** `require_private`，该检查只作用于 `_snapshot_regular_file` 以 `0o600` 产出的快照 | low | 下批次采纳/同步框架时顺手对齐 `chmod 644`；已记入本 signoff，不需专门批次 |
| **S3** | 验收清单把 `fchown`（artifact 属主修复）挂在 `vm-bridge-provider.py` 名下属**定位有误**（该文件 `grep -c fchown`=0），实际在同批采纳的 `transports/session_bridge_kimi.py:622` | low | 已在 verify 报告 §1.4 与本 signoff 明确更正；建议 Planner 在下次编写同类 acceptance 时以"修复语义 + 文件:行"而非仅标记名列举 |
| **S4** | Generator handoff 与 spec 称升级前"10 failed"，签收人实测基线为 **9 failed** | low | 不影响判定；已在 verify 报告 §2.1 如实记录（铁律13），无需后续动作 |
| **S5** | 本批次未 push，故 **CI 结果未核**（第六节已声明不代为断言） | low | Push 后由 Generator/编排按 `generator.md` CI 守门流程跟踪并显式核 conclusion；CI 红则回 fixing |

---

## 十、Framework Learnings

> 以下为提案，**不直接写入 `framework/`**，由 Planner 在 done 阶段与用户确认后处理（建议先追加到 `framework/proposed-learnings.md`）。

### 新规律

- **"标记 grep 计数"不足以验收"修复已采纳"，必须与采纳前版本逐条 diff 判新旧。** 本批次 acceptance 列的 6 个标记中有 3 个（`TARGET_RESOLUTION_PYTHON` / `a+rX` / `write_bytes`）在采纳前就已存在于 tokenizer（它们本就源自 tokenizer、此次是回流），只 grep 会得出"6 处全新增"的错误结论；同时第 6 个标记 `fchown` 在被指定的文件里根本不存在（在另一个文件）。正确做法是对 `<commit>^` 取旧文件逐条比对。
  - 来源：F001 §1.4
  - 建议写入：`framework/harness/evaluator.md` §验收方法 / `framework/patterns/` 采纳类批次 pattern

- **"上游已真机验证"不能替代本机证据；但"字节同一 + 本机 run 产物"可以构成可复核的等价证据链。** F003 首轮判 PARTIAL 的关键是：本机 `runs/` 无对应记录，且机器契约缺 `image_location`/`kimi_identity` 会 fail-closed —— 说明当时的"已验证"说法在本机不可复核。补证后可 PASS 的关键不是那份 JSON，而是 **staged runner 三方 sha256 相同 + artifact 实物 + 765 文件 cmp**。
  - 来源：F003 §8
  - 建议写入：`framework/harness/evaluator.md`（外部/真机验收的证据分级）

### 新坑

- **体积上限类常量会把"校验失败"降级成"静默隐藏"。** `MAX_PROVIDER_BYTES` 超限时返回 `null` 而非抛错，导致合法 provider 被无声丢弃、bridge 从目录里消失。凡"信任检查 + 返回 null"的组合，都应配一条断言真实资产仍在阈值内的回归测试（本批次已补 `harness-vm-provider-ceiling.test.ts`，并做了变异验证）。
  - 来源：F002
  - 建议写入：`framework/README.md` §经验教训 / `framework/patterns/testing-env-patterns.md`

### 模板修订

- 建议 `framework/templates/signoff-report.md` 的「L2 实测记录」一节补一句：**无 staging 的批次（框架采纳 / CLI / 本机 agent 类）应填写其 L2 等价物（真实外部服务调用、真机 launch 等），而非直接写 N/A** —— 本批次即属此类。
  - 建议修改：`framework/templates/signoff-report.md` 第 61 行附近

---

## 十一、Harness 说明

本批改动经 Harness 状态机流程（`planning → building → verifying`）交付，**0 轮 fixing**。
建议将 `progress.json` 的 `status` 置为 `done`、`docs.signoff` 填为
`docs/test-reports/BL-TOKENIZER-ADOPT-V170-signoff-2026-08-05.md`，并清除 `role_assignments`。

签收人执行边界：未修改任何产品代码，未执行 `git add` / `commit` / `push`；本次仅新增
`tests/cli/harness-vm-provider-ceiling.test.ts`（编排已确认随批入库，归属 F002）与本报告、verify 报告。

---

## 十二、签署意见：是否同意举 verifying-to-done 闸门

**同意举闸门。**

依据：

1. 三个 feature 的 acceptance 逐条对照均 PASS，且每条判定都有签收人亲自跑出的命令输出作依据（铁律13）。
2. 满足 `evaluator.md` §14「首轮 verifying PASS（`fix_rounds=0`）」的三条硬条件：
   - **(a) Acceptance 全代码层 PASS** —— §1 / §2 / §3；
   - **(b) L1 + L2 全 PASS** —— L1 四项全绿 + 13 个 framework 套件全绿；L2 等价物（真实 Kimi 真机 bridge launch）已执行并独立复核；
   - **(c) 所有 Soft-watch 均有明文兜底** —— S1~S5 逐条在第九节写明处置路径与责任方。
3. F003 的改判基于签收人独立取证（run 目录增量、staged runner 三方哈希、artifact 实物、765 文件 `cmp`、attestation 多源互证、脱敏扫描），**未采信任何实现方叙述**。

**签署附带的知情条件（请人类在闸门处一并确认）：**

- **(a)** 本批次**未 push**，故 **CI 结果未核**；done 之后首次 push 会触发**生产部署**并改变控制台 framework-standing 显示（1.6.2 → 1.7.0）。部署时机由用户决定。
- **(b)** 第八节 rollout 闸门 1、2 **仍未完成**：本机应用包仍是旧 B 版 provider，机器契约已还原为不含 `image_location`/`kimi_identity` 的基线。**在完成"部署 + Agent 重装 + 机器契约迁移"之前，本机常态下 v1.7.0 bridge launch 会 fail-closed**，这不是回归，而是既定的 rollout 顺序。
- **(c)** S1 的既有 flaky 在满负载全量 vitest 下仍可能偶发变红（隔离必绿），首次 push 后的 CI 若因该条变红，属已知项而非本批引入。

**签署人：** evaluator-subagent（fresh-context 隔离实例）
**签署 SHA：** `72b207995b4cc92598800b797b213ff3e5c887c5`
**签署时间：** 2026-08-05（UTC）
