# BL-AGENT-RELEASE-ACCEPTANCE Signoff 2026-08-04

> 状态：**Evaluator 首轮验收完成，三项全 PASS**（progress.json status=verifying，fix_rounds=0）
> 触发：补做 Agent 1.2.0 / 1.2.1 两个「实现先于独立验收进入生产」发布的 fresh-context 验收。
> 签署：**evaluator-subagent**（隔离上下文，未继承任何实现过程对话）
> 锁定 SHA：`f3ee2c09ee14ccebde28d23597c0a2fba4db94fb`（HEAD 一致、工作树 clean）
> 详细报告：`docs/test-reports/BL-AGENT-RELEASE-ACCEPTANCE-verify-2026-08-04.md`

> ⚠️ **先说坏消息（首轮报告出具后新发现，见 §CI 一节）：** 本批被验收的发布提交 `a7bf556` 在 main 上的
> **Deploy VPS 工作流是红的** —— `Verify (Windows)` 作业失败。根因是 CRLF 断言脆弱性，**不改变三项 PASS
> 判定**（Deploy 作业本身 ✓ 成功、生产确在 a7bf556、产品行为已实测），但它连带**跳过了
> `install.ps1` 语法校验**。详见 §CI 与 Soft-watch S1。

---

## 变更背景

本批次不产出产品代码，是一次**追认式独立验收**：`BL-AGENT-CATALOG-RELEASE-RECOVERY`（Agent 1.2.0 / capability 8，实现 `c5fe6be`，2026-08-02 部署）与 `BL-AGENT-SINGLE-INSTANCE-LIFECYCLE`（Agent 1.2.1 / capability 9，实现 `bbb2c8b`，随 `a7bf556` 于 2026-08-04 部署，含 `device_reporter_observability` 迁移）两个发布，其实现均先于独立验收进入生产。本批消费这两条 backlog，补上 fresh-context 验收，并含一次本机真实升级链路实测。

全部三条 feature 均为 `executor: evaluator` → Evaluator-only 批次，状态流 `planning → verifying → done`（跳过 building）。

---

## 验收功能清单

### F001：验收 Agent 1.2.0 / capability 8（目录兼容性恢复与升级判定）

**Executor：** evaluator · **判定：** ✅ **PASS**

**验收对象（未改动）：**
- `src/cli/harness-tool-catalog.ts:816-828,853-854,889,1054-1065`
- `src/shared/harness-detail.ts:600-622`、`src/shared/agent-feature-version.ts`

**逐条结论（对照 `backlog.json@32b4d16` 原决策）：**

| 原决策 | 结论 | 关键证据 |
|---|---|---|
| 旧 parser 不重新暴露不可信 external subagent 路由 | ✅ | `subagent:true` 仅作兼容元数据容忍：`integration.subagent===false`、`invocations` 无 `subagent`、`bridgeId/subagentProvider` 全 null、catalog 无 subagent 条目；无 `local_cli` 时整条不发布 |
| local-cli / A2A 目录以 fail-closed 为前提恢复 | ✅ | 任一对象式 bridge 解析失败即**整份**目录退化（`issue='dispatch tool catalog is unavailable'`、`entries=0`），**连旁边完全健康的 integration 一并扣下**，不放行半解析结果 |
| capability 8 = 工具绑定 mode intent 最低门槛 | ✅ | `MIN_TOOL_BINDING_...=8`；capability-7 在 `requiresToolBindings` 时被拦，v1 路径不被拦（灰度分离正确） |
| 控制台原因互斥且有序 | ✅ | `modeIssuanceBlocker` 单出口 early-return，顺序 = 新鲜度 → 升级要求 → 版本核验 → 兼容但空目录 |

### F002：验收 Agent 1.2.1 / capability 9（单实例生命周期与 reporter identity）

**Executor：** evaluator · **判定：** ✅ **PASS**（含一处未肉眼观察项，见 Soft-watch S2）

**验收对象（未改动）：**
- `src/cli/agent-lock.ts`、`bin/tokenizer`
- `app/api/harness/report/route.ts:405-430,524-556`、`src/server/harness-relay-identity.ts:78-87,127-183`
- `app/api/devices/heartbeat/route.ts:138-170`、`app/devices/[id]/page.tsx:181-187`
- `prisma/migrations/20260802000000_add_device_reporter_observability/`

| 验收标准 | 结论 | 关键证据 |
|---|---|---|
| agent-lock 单实例 | ✅ | 活 PID 拒第二实例且在位记录不改写；死 PID（先证 `ESRCH`）与损坏锁可回收；**release 以全文比对而非 PID 判断，后继锁逐字节不变**；release 幂等 |
| wrapper 信号转发并等待子进程 | ✅ | `spawnSync`→`spawn` + 三信号转发 + `close` 收尾；真实证据见 F003 §旧进程两层全退 |
| 服务端 reporter identity 拒过期 daemon | ✅ | report / relay 双路径均 Serializable、锁序一致、先于控制面写入；release+feature 双维度单调；**两头必须成对**（只给其一直接抛错，不退化为兼容路径）；腐坏非 null 值仍要求 identity |
| 设备页显示被接受上报 Token 前缀与时间（双语） | ✅ *(代码+数据级)* | 仅在 `accepted` 分支写入（语义正确）；双字段渲染；en/zh-CN 文案齐备。**未在浏览器肉眼观察 → S2** |
| `MAX_AGENT_FEATURE_VERSION` 上限 | ✅ | 畸形值全拒；**边界成立**：`1000001`/`9999999` 拒、`1000000` 接受；服务端库存值同上限过滤 |
| 生产已应用 `device_reporter_observability` 迁移 | ✅ | 生产 `commit=a7bf556`；capability-9 心跳持续 `success`，而 accept 分支必写两列，缺列会 P2022→500 |

### F003：本机 Agent 升级到 1.2.1 的真实链路验收

**Executor：** evaluator · **判定：** ✅ **PASS**

| 验收标准 | 结论 | 关键证据 |
|---|---|---|
| 记录升级前状态 | ✅ | `c5fe6be` / `spawnSync` wrapper / 无 `agent-lock.ts` / 无锁文件 / 无 launchd |
| 执行 install.sh 升级链路 | ✅ | 取生产 `install.sh`（与仓库逐字节一致），退出码 0，凭证复用未轮换 deviceToken |
| 旧 wrapper 与旧 Node 子进程均退出、无孤儿 | ✅ | 日志对**两层**分别发信号（`63704` + `63708`）；**无** `Force-stopping`（均 TERM 下优雅退出）；Agent 自身日志 `agent stopped` 证明子进程亲自处理信号；`ps` 复核双双 GONE |
| 升级后单实例、内容等效 a7bf556 | ✅ | 产品代码与 `a7bf556` diff 为空；仅 `65451`→`65492` 一对；锁由子进程持有；launchd `cc.tokenizer.agent` 已注册；活体复验 `already running (pid 65492)` |
| 上报 capability 9 且服务端接受、不再提示升级 | ✅ | harness `success reported=9 failed=0`（该路径需过 identity 守卫，409 会计入 failed）；`agentReleaseStanding('1.2.1')={kind:'latest'}` → 横幅不触发 |
| 证据脱敏落盘 | ✅ | 4 件证据，密扫（`tok_*`/PRIVATE KEY/deviceToken）clean |

---

## 未变更范围

| 事项 | 说明 |
|---|---|
| 全部产品代码（`src/` `app/` `bin/` `prisma/` `public/` `messages/`） | Evaluator 铁律：不修改产品代码。`git diff HEAD` 对这些路径为空 |
| 状态机文件（`progress.json` `features.json` `backlog.json` `.auto-memory/`） | 按编排要求不写不提交；`evaluator_feedback` 以结构化返回值交编排者原样落盘 |
| `framework/` | 未改动；learnings 以提案形式列于本报告末节 |
| 既有测试套件 | 未修改任何既有用例；只新增独立探针文件 |

---

## 预期影响

| 项目 | 本批次前 | 本批次后 |
|---|---|---|
| 1.2.0 / 1.2.1 独立验收 | 缺失（实现先于验收进生产） | 三项全 PASS，证据落盘 |
| 本机 Agent 版本 | `c5fe6be` / capability 8 / 1.2.0 | `f3ee2c0`（产品代码 ≡ `a7bf556`）/ capability 9 / 1.2.1 |
| 本机 daemon 形态 | **stopped，且无 launchd 常驻** | launchd 常驻 `cc.tokenizer.agent`，单实例持锁 |
| 本机 harness 上报 | `degraded reported=6 failed=3` | `success reported=9 failed=0` |
| 测试用例数 | 988 passed / 4 skipped（64 files） | 1005 passed / 4 skipped（65 files） |

---

## 类型检查 / CI

**本地（macOS，LF）：**

```
$ npm run verify        # prisma generate + tsc --noEmit
✔ Generated Prisma Client (v5.22.0)
（tsc 无输出 = 通过）

$ npm run test
Test Files  65 passed (65)
     Tests  1005 passed | 4 skipped (1009)

$ npx vitest run tests/evaluator/bl-agent-release-acceptance.test.ts
Test Files  1 passed (1)      Tests  17 passed (17)
```

**远端 CI（`gh run list --branch main`）—— 本批被验收提交 `a7bf556` 的运行是 ❌ 红的：**

```
$ gh run view 30891347172
X main Deploy VPS · 30891347172        （commit a7bf556）
JOBS
  X Verify (Windows)  1m57s
      ✓ Typecheck
      X Run unit tests          ←── 失败
      - Validate install.ps1 syntax   ←── 因上一步失败而【跳过】
  ✓ Verify            1m36s     （ubuntu-latest）
  ✓ Deploy            6m54s     ←── 部署本身成功

ANNOTATION
  X AssertionError: expected '#!/usr/bin/env bash\r\nset -euo pipef…'
                    to contain 'stop_existing_service\nstop_existing_…'
```

**根因（已定位，非产品缺陷）：**

- 仓库**无 `.gitattributes`** → windows-latest runner 检出时 `public/install.sh` 被 LF→CRLF 转换。
- `tests/cli/install-agent-lifecycle.test.ts:112` 断言 `toContain("stop_existing_service\nstop_existing_agents")` —— 字面 `\n` 永不匹配 `\r\n`，**在 Windows 上确定性失败**，macOS/Linux 恒过。
- 该断言正是 1.2.1 引入 install.sh 两层停止逻辑时新增的，属**本批被验收发布自带的测试可移植性缺陷**。

**为何不影响三项 PASS 判定：**

1. `deploy` 作业 `needs: verify`，**刻意不依赖 `verify-windows`**（工作流注释：「服务端只跑 Linux，Windows-only 的 CLI 回归不应阻塞服务端部署」）。故 Deploy ✓、生产确在 `a7bf556`，与我实测的 `/api/health` 一致。
2. 失败的是**测试断言的字符串比较**，`public/install.sh` 本体是 bash 脚本、只在 macOS/Linux/WSL 执行；其两层停止行为已由我在真机上以**真正 pre-fix 的 `spawnSync` wrapper** 实测通过。
3. 三条 feature 的 acceptance 条款中不含「CI 全绿」项。

**但必须记账的真实后果：** `Run unit tests` 失败使同作业后续的 **`Validate install.ps1 syntax` 被跳过** —— 本发布的 **Windows 安装脚本语法从未被校验**。项目确实支持 Windows（存在 `public/install.ps1` 与 `src/cli/service-windows.ts`），故这不是可忽略的噪声。→ Soft-watch **S1**。

> **自我披露：** 首轮验收报告的「L1」小节我只写了本地 `npm run test` 结果，**未核对该发布提交的远端 CI**，是我首轮取证的疏漏。本节为补正，判定不变。

---

## L2 实测记录

> 本项目**无 staging 环境**；生产实测严格限只读端点与本机 Agent 常规行为。

| 项 | 证据 |
|---|---|
| 生产 commit == 被验收发布 | `curl -s https://token.vpanel.cc/api/health` → `{"ok":true,...,"commit":"a7bf5561a7a2f1c6a1201d0a13fc0ecfb3e6726c"}`；`ok:true` 同时证明 DB 可达 |
| 端到端流验证（真实升级链路） | 记录旧态（`c5fe6be`/`spawnSync`/无锁/无 launchd）→ 启动旧 daemon 形成真实两层 PID（`63704`→`63708`）→ 取生产 `install.sh` 校验逐字节一致 → 执行（exit 0）→ 两层均 TERM 优雅退出、无 `Force-stopping`、`ps` 复核双双 GONE → 新单实例 `65451`→`65492`、锁由子进程持有、launchd 注册 → harness `success 9/0` |
| 关键 invariant | ①无孤儿：旧 Node 子进程自写 `agent stopped` 后退出，非被 wrapper 之死连坐 ②单实例：活体再起得 `already running (pid 65492)` 且在位锁未动 ③服务端接受 capability 9：identity 守卫路径 `failed=0` ④迁移已应用：accept 分支必写两列而心跳持续 success ⑤内容等效：产品代码 vs `a7bf556` diff 为空 |
| 浏览器手动验（UI 类） | **未执行** —— `environment.md` 为未填模板（无控制台凭证），且本 evaluator 上下文未挂载浏览器工具。设备页两字段仅验到数据链路+渲染代码+双语文案三层 → **S2** |

**主动放弃的一项生产测试：** 原可用 relay GET 携 capability-8 头直接证明生产 409 拒绝过期 daemon；核查 `app/api/harness/mode-intents/relay/route.ts` 后发现该 GET 自带 `harnessModeIntent.updateMany` 投递标记副作用，属控制面状态变更，越过本批「只读端点 + 设备页观察、不动 Harness 闸门」边界，**故放弃**，改以代码审读 + 单调守卫探针覆盖。

---

## Ops 副作用记录

**本批次无任何数据库 SQL ops**（未连生产/staging DB，未执行任何 SQL）。

但本批次**有真实本机系统状态变更**，据实记录：

| Agent | 阶段 | 操作摘要 | 副作用对齐 | 授权 |
|---|---|---|---|---|
| evaluator-subagent | verifying | **启动旧 c5fe6be daemon**（`nohup tokenizer agent`），以构造真实升级前态 | 该进程已被随后的 install.sh 完全停止（`63704`/`63708` 双双 GONE）；旧 Agent 走 legacy 无 identity 路径（库存 8<9），未污染设备状态 | 批次 spec §1 授权 F003 真实升级；**此步为 Evaluator 主动引入，非被动观察，特此披露** |
| evaluator-subagent | verifying | **执行 `install.sh` 升级本机 Agent** 1.2.0→1.2.1 | 幂等可重跑；未传 `--force-enroll`，**未轮换 deviceToken**；升级后单实例稳定运行 >6 分钟 | 批次 spec §1 + features.json F003 acceptance 明确授权 |
| evaluator-subagent | verifying | `install.sh` 注册 launchd 常驻 `cc.tokenizer.agent` | **本机此前无 launchd 条目且 daemon 处于 stopped**，本批将其变为常驻 | 属 install.sh 既定行为；**若此前停用系有意为之，请人工确认** → S3 |
| evaluator-subagent | verifying | `install.sh:233` `checkout --force` 丢弃安装目录 2 个本地改动文件 | 升级前已备份至 `/tmp/eval-release-acceptance/install-dir-backup/`；其余 16 个「已修改」文件内容与 origin/main 一致无损失 | 属安装器托管目录的设计意图，不计缺陷 |

---

## Harness 说明

本批经 Harness 状态机 **Evaluator-only** 流程交付：`planning → verifying`（跳过 building，全部 `executor: evaluator`）。
本轮为 `verifying` **首轮**，三项全 PASS、`fix_rounds` 保持 0，未进入 `fixing`/`reverifying`。

`progress.json` 的 `status` 置 `done`、`docs.signoff` 填入本文件路径、`features.json` 三条置完成 —— **均由编排者在人工闸门通过后落盘**；Evaluator 按边界不写状态机文件、不 git add/commit。

---

## Soft-watch（不阻塞 done，需后续跟进）

| ID | 描述 | 风险等级 | 建议处置 |
|---|---|---|---|
| **S1** | **`a7bf556` 的 Deploy VPS 工作流红**：`Verify (Windows)` 因 `tests/cli/install-agent-lifecycle.test.ts:112` 的 `toContain("...\n...")` 断言遇 CRLF 检出而确定性失败；连带 **`Validate install.ps1 syntax` 被跳过，本发布 Windows 安装脚本语法从未校验**。项目确实支持 Windows（`install.ps1` + `service-windows.ts`） | **medium** | 建议入 backlog 由 Generator 修：①加 `.gitattributes`（`*.sh text eol=lf`）固定 LF；②或把断言改为换行不敏感（如 `toMatch(/stop_existing_service\r?\nstop_existing_agents/)`）。**修复前 main 的 CI 徽标持续为红，会稀释「红=真问题」的信号价值** |
| **S2** | 设备页 `reporterTokenPrefix` / `reportedAt` 两字段**未在浏览器肉眼观察**，仅验到数据链路 + 渲染代码 + 双语文案。原因：`.auto-memory/environment.md` 仍是未填模板（控制台地址为 `[https://example.com]` 占位、测试账号为 `[email]/[password]`，生产地址系我从 `~/.tokenizer/config.json` 取得），且本上下文无浏览器工具 | low | 下次有控制台凭证时补一次 UI 观察即可闭环。**根治项是补齐 `environment.md`** —— 否则每轮 Evaluator 都要靠旁路手段自行发现生产地址 |
| **S3** | 本机 Agent 在本批**由「stopped 且无 launchd 常驻」变为「launchd 常驻」**。若此前停用系有意为之（如为避免干扰某项调试），需人工决定是否回退 | low | 请用户确认；如需回退：`tokenizer uninstall-service` |
| **S4** | `~/.tokenizer/app` 曾带 16 个与 origin/main 同内容、2 个不同内容的本地改动，说明该托管目录被当作可编辑工作区使用过。`install.sh` 的 `checkout --force` 会无声丢弃 | low | 提示不要把唯一副本放在 `~/.tokenizer/app`；备份见 `/tmp/eval-release-acceptance/install-dir-backup/` |

---

## Framework Learnings

### 新坑

- **fail-closed 类断言必须先钉住一个「健康 baseline」，否则整组用例会因「一切都退化」而空转通过。**
  本批首次运行探针时 baseline 用例失败，根因是我方夹具缺 `local_cli.sandbox.home_dir`。若当时顺手放宽断言而不修夹具，则后续所有「解析失败 → 目录退化」的用例都会在「目录本来就退化」的前提下**假通过**，验收形同虚设。
  规律：**任何"异常时应退化/拒绝"的测试组，必须包含一条断言"正常时不退化"的对照用例**，且该对照必须先绿。
  - 来源：F001 fail-closed 验收
  - 建议写入：`framework/README.md` §经验教训 / `.auto-memory/role-context/evaluator.md`

- **验收"已部署发布"时，必须核对该发布提交的远端 CI，不能只跑本地测试。**
  我首轮只跑了本地 `npm run test`（macOS/LF）全绿即下 L1 结论，漏看 main 上该提交的 Deploy 工作流是红的（Windows 作业失败 + `install.ps1` 校验被跳过）。本地全绿与 CI 全绿是**两个不同事实**，跨平台断言尤其容易只在一侧成立。
  - 来源：本批 §CI 一节（S1）
  - 建议写入：`.auto-memory/role-context/evaluator.md` 签收报告小节（增「远端 CI 核对」为硬性项）

- **"某步失败导致同作业后续校验步骤被跳过"是隐形覆盖率损失。**
  Windows 作业里 `Run unit tests` 失败使 `Validate install.ps1 syntax` 根本没跑——红色 CI 掩盖的不只是那一个断言，还有它下游所有未执行的校验。看 CI 失败时应连带确认**被跳过了什么**。
  - 来源：S1
  - 建议写入：`framework/README.md` §经验教训

### 新规律

- **验收"升级链路"必须自行构造出真实的升级前态。**
  本批接手时 daemon 恰好是 stopped，若就地跑 install.sh，则"旧 wrapper 与旧 Node 子进程均退出"这条 acceptance **根本无从观察**（没有旧进程可退）。主动启动旧版本 daemon 构造两层 PID 后，才真正验到了 pre-fix `spawnSync` wrapper 被两层停止。
  代价是引入了状态变更，故须在报告中显式披露"这是我做的，不是我看到的"。
  - 来源：F003
  - 建议写入：`framework/patterns/` 新增或并入升级/生命周期验收 pattern

### 模板修订

- `framework/templates/signoff-report.md` 目前形态是 **Generator 批次专用**（「变更功能清单/文件/改动」假定有代码产出），Evaluator-only 批次套用时需大幅改写字段语义。
  建议：补一段说明或提供 Evaluator-only 变体（「验收功能清单 + 判定 + 证据索引」替代「变更功能清单」）。
  - 建议修改：`framework/templates/signoff-report.md` 第 14-32 行附近

---

## 签署意见

**同意举 `verifying → done` 人工闸门。**

依据：

1. 三条 feature 的 acceptance 条款**逐条**以磁盘代码、17 例独立探针、本机真实升级实测取证，**全部满足**，无一条 PARTIAL/FAIL。
2. 独立性满足铁则：fresh context、未继承实现叙述、结论基于实物、未修改任何产品代码（`git diff HEAD` 对产品路径为空）。
3. 生产状态健康且与被验收发布一致（`commit=a7bf556`、`ok:true`、迁移已应用、本机 Agent 升级后稳定 >6 分钟）。

**附带条件（不构成阻塞，但请在置 done 时一并处置）：**

- **S1 须落为 backlog 条目**，不可随本批 done 一并湮灭。理由：它是**本批被验收发布自带**的缺陷，虽不违反任何一条 acceptance，但使 main 的 CI 持续为红并让 Windows 安装脚本失去校验。让红色 CI 长期存在的代价，是团队逐渐不再把红色当回事。
- **S3 请用户确认**本机 Agent 由 stopped 变为 launchd 常驻是否符合预期。
- 若用户认为「设备页 UI 肉眼确认」是本批必须闭环项，则本签署应降级为**待补 UI 观察**——请明示，我可在拿到控制台凭证后补验（S2）。

**签署：** evaluator-subagent · 2026-08-04 · 隔离上下文首轮验收
