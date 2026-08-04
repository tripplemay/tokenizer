# BL-AGENT-RELEASE-ACCEPTANCE — 首轮验收报告

> **批次：** BL-AGENT-RELEASE-ACCEPTANCE（Evaluator-only，verifying 首轮）
> **日期：** 2026-08-04 · **Evaluator：** Andy/evaluator-subagent（fresh context，隔离上下文）
> **锁定 SHA：** `f3ee2c09ee14ccebde28d23597c0a2fba4db94fb`（已确认工作树 HEAD 一致且 clean）
> **规格：** `docs/specs/BL-AGENT-RELEASE-ACCEPTANCE-spec.md`
> **生产：** `https://token.vpanel.cc` — `/api/health` 返回 `commit=a7bf5561a7a2f1c6a1201d0a13fc0ecfb3e6726c`，`ok:true`

## 0. 结论速览

| Feature | 结论 | 一句话 |
|---|---|---|
| F001 · Agent 1.2.0 / capability 8 | **PASS** | 四条 backlog 原决策逐条以独立探针复现，目录恢复确为 fail-closed |
| F002 · Agent 1.2.1 / capability 9 | **PASS** | 单实例、信号转发、reporter identity、上限、迁移均成立；设备页仅缺"肉眼观察"一环（见 §5.1） |
| F003 · 本机真实升级链路 | **PASS** | 真实 install.sh 升级，新旧两层进程全部退出无孤儿，新单实例持锁并被服务端接受 |

**L1（本地）：** `npm run test` 65 files / 1005 passed / 4 skipped；`npm run verify`（prisma generate + tsc --noEmit）清白。
**L2（生产写入/计费）：** 未触发。生产侧仅用只读 `/api/health` 与本机 Agent 自身的常规上报，未签发 mode intent、未动闸门（详见 §5.2 主动放弃的一项测试）。

---

## 1. 验收方法与独立性声明

- 本报告全部结论来自**磁盘代码、独立探针运行输出、本机真实升级实测**，未采信任何实现叙述或 commit message。
- 新写独立探针 `tests/evaluator/bl-agent-release-acceptance.test.ts`（17 例），**不是**从 `tests/cli/*` 既有用例派生，而是直接照 spec §2 的验收条款从外部断言可观测行为。目的：既有套件全绿本身不构成验收结论。
- **未修改任何产品代码。** 工作树改动仅一个新增测试文件 + 本报告与证据（`git status --short` 见 §6）。

### 1.1 一次探针自证：我的夹具错了两次，都已修正而非放宽断言

首次运行时 baseline 用例失败（`expected 'dispatch tool catalog is unavailable' to be null`）。根因是**我的夹具**缺 `local_cli.sandbox.home_dir`（`validSandbox(_, requireHome=true)` 要求），不是产品缺陷。
这一点很关键：若不修好 baseline，后面所有"fail-closed 时目录退化"的断言都会**因为一切都退化而空转通过**。修正夹具后 baseline 断言 `issue === null && entries > 0`，fail-closed 用例才具备判别力。

第二次失败在 `" 9"`（前导空格）capability 头被接受。核查后确认是 Fetch `Headers` 规范强制的头值裁剪，解析器拿到的已是 `"9"` —— **HTTP 语义，非产品缺陷**。已从用例移除并在代码注释写明理由，同时补上真正的边界断言（`MAX+1` 拒绝、`MAX` 接受）。

---

## 2. F001 — Agent 1.2.0 / capability 8（目录兼容性恢复与升级判定）→ **PASS**

对照 `backlog.json@32b4d16` 中 `BL-AGENT-CATALOG-RELEASE-RECOVERY` 的原决策逐条核。

### 2.1 决策 3：旧 parser 不重新暴露不可信 external subagent 路由 ✓

`src/cli/harness-tool-catalog.ts:816-827,853-854,889` 的行为经探针确认：

| 输入 | 观测结果 |
|---|---|
| `subagent: true` + 合法 `local_cli` | local-cli 路由保留；`integration.subagent === false`、`invocations` 不含 `subagent`、`bridgeId/bridgeKind/sessionScope/subagentProvider` 全为 null；catalog 中**无** `invocation === "subagent"` 条目、无任何 provider proof |
| `subagent: true` 且**无** `local_cli` | 整条 integration 不发布（`integrations.length === 0`、`entries.length === 0`） |

即：遗留布尔值被当作"固定 Coordinator 自己的子进程路径"这一兼容元数据容忍解析，但**不产生任何可选中的、带工具标签的公开路由，也不产生公开能力**。决策 3 的实质诉求（不重新发布不可信外部 subagent）成立。

### 2.2 决策：local-cli / A2A 目录恢复以 fail-closed 为前提 ✓

`readDispatchToolInventory` 在解析失败时返回 `{ entries: [], issue: "dispatch tool catalog is unavailable" }`（`:1054-1065`）。探针确认**退化是整体性的、不放行半解析结果**：

- 一个 integration 声明了无法解析的对象式 bridge（`subagent: { bridge: "no-such-bridge" }`）时，**连同旁边那条完全健康的 local-cli integration 一起**被扣下（`entries.length === 0`，`issue` 非空）。这正是 fail-closed 而非 fail-open。
- 畸形声明形状 `{bridge:1}` / `{bridge:"ok",extra:true}` / `{}` / `"bridge"` / `[]` 均整体退化。
- 对象式 bridge 声明**不能**在没有 `local_cli` 契约的情况下搭车（`:828`）。

### 2.3 决策 2：capability 8 = 工具绑定 mode intent 最低门槛 ✓

`MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION = 8`，且严格大于 v1 门槛 `MIN_MODE_INTENT_AGENT_FEATURE_VERSION = 4`。探针另确认 capability-7 reporter 在 `requiresToolBindings: true` 时被拦（`toolBindingAgentUpgradeRequired`），而在 v1 路径（`requiresToolBindings: false`）**不**被拦（返回 `null`）—— 这正是"既有 v1 intent 在灰度期仍可读可消费"的分离设计。

### 2.4 决策 4：控制台原因互斥且有序 ✓

`modeIssuanceBlocker`（`src/shared/harness-detail.ts:600-622`）是单出口 early-return，天然互斥。探针逐级钉住优先级：

```
signingKeyUnavailable
  → reportStale                     （报告新鲜度）
  → agentUpgradeRequired / toolBindingAgentUpgradeRequired （升级要求）
  → headNotFull                     （版本核验）
  → agentSnapshotUnavailable
  → toolCatalogUnavailable          （兼容但空目录）
```

与决策 4 要求的「报告新鲜度 → 升级要求 → 版本核验 → 兼容但空目录」顺序一致；健康的 capability-8 agent 返回 `null`（无阻塞）。

---

## 3. F002 — Agent 1.2.1 / capability 9（单实例生命周期与 reporter identity）→ **PASS**

### 3.1 agent-lock 单实例 ✓

`src/cli/agent-lock.ts`，探针独立复现四种情形：

| 场景 | 观测 |
|---|---|
| 活 PID 持锁 | 第二实例抛 `Tokenizer agent is already running (pid …)`，且**在位记录未被改写** |
| 死 PID 残锁 | 先证明 PID 确已不存在（`kill(pid,0)` → `ESRCH`），再确认新实例回收该锁 |
| 锁文件损坏 | 回收而非启动死锁 |
| **release 不误删后继锁** | 模拟"旧实例失去 PID → 后继占位 → 旧实例 release 姗姗来迟"，后继锁文件**逐字节不变** |
| release 幂等 | 二次调用无副作用 |

> 该"后继锁"用例是升级竞态的核心风险点，实现用 `current.raw === serialized` 全文比对而非按 PID 判断（`:114`），正确。

**并且这条不止是沙箱结论** —— §4.4 在真实常驻 daemon 上复现了活 PID 拒绝第二实例。

### 3.2 wrapper 信号转发并等待 Node 子进程 ✓

`bin/tokenizer` 已由 `spawnSync` 改为 `spawn` + `SIGINT/SIGTERM/SIGHUP` 转发 + `close` 处理器收尾（`:2,10,21-31,38-44`）。真实证据见 §4.3：安装器对**旧的 pre-fix wrapper** 发 TERM 后，旧 Node 子进程自己写下 `agent stopped` 日志才退出，没有留下孤儿。

### 3.3 服务端 reporter identity 拒绝过期 daemon ✓

- **report 路径**：`app/api/harness/report/route.ts:405-430,524-556` — `reporterCanWriteHatness` 逻辑在 **serializable 事务内**、且**先于**任何控制面写入执行；识别到 identity 后即使库存 capability < 9 也逐维度比较（防"有身份的旧进程降级 pre-v9 设备行"）；拒绝时 409 `stale_agent_report`。
- **relay 路径**：`src/server/harness-relay-identity.ts:127-183` — `withHarnessRelayIdentity` 同样是 Serializable，锁序与 report 一致（Device → DeviceToken），先验令牌未吊销再做单调性判断；`identityIsAtLeast` 对 release 与 feature 双维度比较，任一维度回退即拒。
- **身份原子性**：探针确认 release/feature 两个头**必须成对**——只给其一直接抛错，不会退化成"兼容路径"（这是防降级绕过的关键）。两个都不给才是合法的 pre-v9 legacy 路径。
- **腐坏值不重开旧路**：`storedFeatureRequiresIdentity`（`:78-87`）对非 null 的腐坏值仍要求 identity，注释与实现一致。

### 3.4 设备页显示被接受上报的 Token 前缀与时间（i18n 双语） ✓（渲染未肉眼观察，见 §5.1）

- schema：`Device.reporterTokenPrefix`、`Device.reportedAt`（`prisma/schema.prisma:115` 及迁移）。
- 写入：`app/api/devices/heartbeat/route.ts:166-167` —— **仅在 `accepted` 分支**写 `reporterTokenPrefix = token.prefix` 与 `reportedAt = now`，语义正确（"被接受的那次上报"而非"最后一次上报"）。
- 渲染：`app/devices/[id]/page.tsx:181-187` 两个字段都渲染，`reportedAt` 走 `formatDateTimeSeconds(…, tz)`。
- i18n 双语齐备：
  - en：`device.diagnostics.reporterTokenPrefix = "Accepted reporter token prefix"`、`reportedAt = "Accepted report time"`
  - zh-CN：`= "已接受上报 Token 前缀"`、`= "已接受上报时间"`

### 3.5 MAX_AGENT_FEATURE_VERSION 上限防畸形值 ✓

`MAX_AGENT_FEATURE_VERSION = 1_000_000`。探针确认 `99999999` / `1e9` / `-1` / `9.5` / `NaN` / `Infinity` / `0x9` / `""` 全部拒绝；**边界成立**：`1000001` 与 `9999999`（语法合法的整数）也拒绝，而 `1000000` 本身接受。服务端 `storedFeatureVersion` 亦以同一上限过滤库存值，畸形值不会让正常 reporter 永久显示过期。

### 3.6 生产 DB 已应用 `20260802000000_add_device_reporter_observability` ✓

迁移文件存在于 `a7bf556` 树内，生产运行 `a7bf556`。**运行时实证**：升级后的 capability-9 daemon 心跳持续 `success`（08:41:48Z、08:46:51Z…），而 accept 分支**必然**写 `reporterTokenPrefix` 与 `reportedAt` 两列；若生产库缺列，Prisma 会以 P2022 报错→500→Agent 记 `heartbeat failed`。持续成功即证明两列存在。

---

## 4. F003 — 本机 Agent 升级到 1.2.1 真实链路 → **PASS**

> 证据原件（已脱敏）：`docs/test-reports/evidence/BL-AGENT-RELEASE-ACCEPTANCE/`

### 4.1 升级前状态（已记录）

接手时发现 daemon **处于 stopped 状态**（`state.json`: `stoppedAt 2026-08-04T08:29:13Z`），且**本机没有任何 launchd 常驻**（`launchctl list` 与 `~/Library/LaunchAgents/` 均无 tokenizer 条目）。

> **主动披露：** 为忠实复现"升级"这一动作（升级的定义前提是有旧 daemon 在跑），我按 `install.sh:275` 同样的方式先把**旧 c5fe6be daemon 启动起来**，再执行升级。这是我引入的状态变更，特此声明，不是被动观察。旧版本本就是本机既有安装内容，且旧 Agent 走 legacy 无 identity 路径（库存 capability 8 < 9），不会污染设备状态。

| 项 | 升级前值 |
|---|---|
| `~/.tokenizer/app` HEAD | `c5fe6bee741c90b0b374b0a441cbcdab1ffbe456`（1.2.0 / capability 8） |
| wrapper 形态 | `spawnSync`（**pre-fix 的脆弱进程边界**，`git show c5fe6be:bin/tokenizer` 确认） |
| `src/cli/agent-lock.ts` | 不存在（单实例锁是 capability 9 才引入） |
| `~/.tokenizer/agent.lock` | 不存在 |
| PID 树 | wrapper `63704` → Node 子进程 `63708`（真实两层） |
| launchd | 无 |
| 心跳 | `2026-08-04T08:39:21Z success` |

### 4.2 升级执行

按真实用户路径取安装脚本：`curl https://token.vpanel.cc/install.sh` —— 与仓库 `public/install.sh` **逐字节一致**（即 a7bf556 版安装器）。以 `bash install-served.sh --yes` 执行，退出码 **0**。未传 `--force-enroll`，凭证复用、**未轮换 deviceToken**。

### 4.3 旧进程两层全退，无孤儿 ✓（本批最有价值的一条实证）

安装器日志明确对**两个层**分别发信号：

```
[tokenizer] Stopping existing agent (pid 63704)   ← 旧 wrapper
[tokenizer] Stopping existing agent (pid 63708)   ← 旧 Node 子进程
```

- 全程**没有** `Force-stopping unresponsive agent`，即两者都在 TERM 下优雅退出，未走 KILL 兜底。
- Agent 自身日志 `2026-08-04T08:40:21.268Z agent stopped` —— 旧 **Node 子进程**收到并处理了信号（不是被 wrapper 之死连坐）。
- 复核 `ps -p`：`63704 GONE` / `63708 GONE`。

这条恰好击中被修复的原始缺陷：`pkill -f "tokenizer agent"` 只命中 wrapper、留下真正的 Node daemon 存活并在之后覆盖当前诊断。此处以**真正 pre-fix 的 spawnSync wrapper** 作被测对象，结论有效。

### 4.4 升级后为单实例、内容等效 a7bf556 ✓

| 项 | 升级后值 |
|---|---|
| `~/.tokenizer/app` HEAD | `f3ee2c0`；**产品代码（`src/ bin/ prisma/ app/ public/ package*.json messages/`）与 `a7bf556` diff 为空** → 满足"a7bf556 等效内容" |
| capability 常量 | `AGENT_FEATURE_VERSION = 9`、`MIN_AGENT_FEATURE_VERSION = 9`、`MAX = 1_000_000` |
| wrapper | `import { spawn }` + `child.kill(signal)` 转发（新版） |
| `agent-lock.ts` | present |
| `~/.tokenizer/agent.lock` | `{"pid":65492,…,"startedAt":"2026-08-04T08:40:43.210Z"}` —— 由 **Node 子进程**持锁 |
| PID 树 | wrapper `65451`(ppid 1) → 子进程 `65492`，**仅此一对** |
| launchd | `65451  0  cc.tokenizer.agent`（已注册，退出状态 0） |

**活体单实例复验：** 对着真实常驻 daemon 再起一个 `tokenizer agent`，得
`Tokenizer agent is already running (pid 65492). Stop it before starting another agent.`，且在位锁文件未被改动。

### 4.5 capability 9 被服务端接受、不再提示升级 ✓

- 升级后 harness 上报连续 `status=success reported=9 failed=0`（08:41:00Z 起，至 08:47Z 稳定）。这条路径正是**带 reporter identity 的控制面写入**，要经 `reporterCanWriteHarness` 与 serializable 事务；若身份未被接受会得 409 计入 `failed`。**0 failed 即服务端接受 capability 9**，并由 `reporterPromotesDevice` 落库 `1.2.1 / 9`。
- 顺带修复了升级前的退化：升级前最后一次 harness 为 `degraded reported=6 failed=3`（network_error），升级后恢复 `success 9/0`。
- **升级提示消除**：`agentReleaseStanding("1.2.1")` → `{kind:"latest"}`；`agentReleaseStanding("1.2.0")` → `{kind:"behind", behind:1}`。设备横幅 `shouldRenderUpgradeBanner(outdated, unknown)` 依赖 `outdatedCount>0`，本机已计入 latest，不再触发升级徽标/横幅。
- 稳定性：升级后 6 分钟以上连续心跳 `success`，进程对未变，锁未易主。

---

## 5. 边界、限制与主动披露

### 5.1 一处**未肉眼观察**：设备页实际渲染

F002 §3.4 的"设备页显示"我验到了**数据链路 + 渲染代码 + 双语文案**三层，但**没有在浏览器里实际看到那两个字段**。原因有二：

1. `.auto-memory/environment.md` 仍是**未填写的模板**（控制台地址写着 `[https://example.com]`、测试账号为 `[email]/[password]` 占位），无可用登录凭证；生产地址是我从 `~/.tokenizer/config.json` 里取到的。
2. 本 evaluator 上下文未挂载浏览器工具。

风险评估：低。字段来自已证明在生产被写入的列，渲染代码路径直白（两个 `label/value` 行），i18n 两语齐备。但严格说这一条是**代码级 + 数据级**通过，不是 UI 级通过，如实记录。

### 5.2 一项**主动放弃**的生产测试

原本可用一次 relay GET 带 capability-8 头去直接证明"生产会 409 拒绝过期 daemon"。核查 `app/api/harness/mode-intents/relay/route.ts` 后发现 GET **本身带 `harnessModeIntent.updateMany` 副作用**（投递标记），属控制面状态变更，越过了本批"只读端点 + 设备页观察、不动 Harness 闸门"的边界，**故放弃**。该条改以代码审读 + 单调守卫探针覆盖（§3.3）。

### 5.3 install.sh 的 `checkout --force` 会丢弃安装目录本地改动（**非缺陷**，但需知会）

`install.sh:233` 的 `git checkout --force origin/main` 丢弃了 `~/.tokenizer/app` 中两个本地改动文件：
`framework/templates/claude/dispatch/test-lifecycle.py`、`test-vm-bridge-provider.py`。
其余 16 个"已修改"文件内容与 origin/main 一致，无实际损失。我已在升级前把这两个文件备份至 `/tmp/eval-release-acceptance/install-dir-backup/`。
判定：`~/.tokenizer/app` 是安装器托管目录，强制对齐是**设计意图**，不计入缺陷。仅提示：不要把唯一副本放在该目录。

### 5.4 观察项（不影响本批结论，建议入 backlog）

1. **`.auto-memory/environment.md` 是未填写模板**，与"生产已上线、常态验收"的项目现状不符。建议 Planner 补齐（地址、部署路径、只读验收入口），否则每轮 Evaluator 都要靠旁路手段自行发现生产地址。
2. 本机在验收开始前**既无 launchd 常驻、daemon 也处于 stopped**。经此次 `install.sh` 已恢复为 launchd 常驻（`cc.tokenizer.agent`）。若此前是有意停用，请留意本批已把它拉起。

---

## 6. 产物与可复现步骤

**新增（仅测试产物，未动产品代码）：**

```
tests/evaluator/bl-agent-release-acceptance.test.ts                  # 17 例独立探针
docs/test-reports/BL-AGENT-RELEASE-ACCEPTANCE-verify-2026-08-04.md   # 本报告
docs/test-reports/evidence/BL-AGENT-RELEASE-ACCEPTANCE/              # 脱敏证据 4 件
  ├── F003-pre-upgrade.txt
  ├── F003-install-run.log
  ├── F003-post-upgrade.txt
  └── F003-steady-state.txt
```

证据包已过密扫（`tok_*` / PRIVATE KEY / deviceToken）—— clean。

**复现：**

```bash
git rev-parse HEAD                 # 须为 f3ee2c09ee14ccebde28d23597c0a2fba4db94fb
npm run verify                     # prisma generate + tsc --noEmit
npm run test                       # 65 files / 1005 passed / 4 skipped
npx vitest run tests/evaluator/bl-agent-release-acceptance.test.ts   # 17 passed
curl -s https://token.vpanel.cc/api/health                           # commit=a7bf556…

# F003 真实链路（会改本机状态；重复执行安全）
curl -s https://token.vpanel.cc/install.sh -o /tmp/install.sh
diff /tmp/install.sh public/install.sh && bash /tmp/install.sh --yes
ps -axww -o pid=,ppid=,command= | grep -E "cli/index.ts agent|bin/tokenizer agent" | grep -v grep
cat ~/.tokenizer/agent.lock && launchctl list | grep tokenizer
~/.local/bin/tokenizer agent       # 期望：already running (pid …)
```

**签收前置：** 三个 feature 全 PASS，`fix_rounds` 保持 0。按 `role-context/evaluator.md`，本轮为 `verifying` 首轮全 PASS，signoff 报告应在置 `done` 前按 `framework/templates/signoff-report.md` 补写并填 `progress.json.docs.signoff`。
