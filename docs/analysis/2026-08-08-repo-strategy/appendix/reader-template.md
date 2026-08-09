# harness-template 仓库分析报告

分析对象：`/Users/yixingzhou/project/harness-template`（github.com/tripplemay/harness-template），当前 `VERSION` = **1.7.1**，HEAD = `78756ab`（fix v1.7.1，2026-08-07）。全仓 157 个文件（不含 `.git`/`.obsidian`/`.DS_Store`），约 4.9 万行。

---

## 1) 仓库定位与内容结构

**定位**：框架名 **Triad Workflow**（README.md:1-5）——「三角色 · 状态机 · 无自评」的 AI 协作开发框架模板仓。它不是可运行的产品，而是**被 consumer 项目物化复制的框架源树**：consumer 用 `degit` + `bootstrap.sh` 铺进自己项目，之后通过 `harness.sh` 账本机制升级。tokenizer 项目本身就是其 consumer（tokenizer 根目录的 `harness-rules.md` 即本仓 `harness/harness-rules.md` 的受管镜像）。

目录树与作用：

```
harness-template/
├── README.md / VERSION / CHANGELOG.md(1761 行) / INIT.md / bootstrap.sh
├── proposed-learnings.md            # 框架自迭代提案暂存区（done 阶段消费）
├── cowork-constraint-design.md      # 2026-04-04 历史设计文档（「知情自律」时代）
├── .github/workflows/release-contract.yml  # 发布契约 CI（v1.5.3）
├── harness/                # 状态机核心：10 份 md + 2 份 json
│   ├── harness-rules.md(432 行) / planner.md(749) / generator.md(202) / evaluator.md(283)
│   ├── orchestration-patterns.md / pre-impl-adjudication.md
│   ├── autonomous-mode.md / console-mode.md(370) / dispatch-mode.md(500) / framework-versioning.md(127)
│   ├── framework-releases.json      # v1 发布历史机器事实源（v1.5.3）
│   └── progress.init.json           # progress.json 初始值
├── docs/                   # 框架自身文档：01-concepts / 02-usage / 03-quickstart + a2a 研究记录
├── patterns/               # 技术域经验库 9 篇（deploy/database/ai-action/ui/i18n/testing-env…，T2 按需加载）
├── memory/                 # .auto-memory 记忆模板（T0/T1/T2：MEMORY/project-status/environment/role-context×3…）
├── templates/              # 项目级模板与全部「机件」
│   ├── CLAUDE.md / AGENTS.md        # 占位符版主实例/evaluator 实例指令
│   ├── signoff-report.md / features.template.json / dashboard.template.html
│   ├── pre-commit-hook.sh / migration-batch-checklist.md / prod-launch-audit-template.md
│   └── claude/             # → consumer 的 .claude/
│       ├── harness.sh(541 行)       # 版本化 CLI（init/status/verify/sync/resolve/adopt）
│       ├── settings.json / hooks/{session-start,validate-state-json}.sh
│       ├── agents/{evaluator,generator-restricted,planner-proposal,spec-lock-critic}.md  # subagent 定义
│       ├── skills/{plan,build,verify,autodrive,dashboard}/SKILL.md
│       ├── console/        # 项目侧闸门机件：pending-gate/mode-intent schema + 验签/批准/解析脚本 + 测试
│       ├── dispatch/       # 异厂商派活机件（最大子系统）：sandbox-profile.sh(1002 行)、
│       │                   #   validate-dispatch.sh(872)、tool-catalog.py(1717)、各 schema、
│       │                   #   transports/{local-cli,a2a,session-bridge,vm-bridge}(a2a-client 1368/vm-bridge-provider 3278)、
│       │                   #   adapters/{claude-code,codex,kimi}.json、10+ 回归测试
│       └── autonomous/     # 自主模式：gate-arbiter.workflow.js(767)、autonomy-policy/verdict schema + 校验器
├── console/                # 自托管控制台服务（通道 A 参考实现）：server.py(309) + ui.html(233) + 配置示例
├── scripts/                # validate-framework-release-contract.py + run-vm-kimi-l2-probe.py(1571)
├── tests/                  # 上述两 scripts 的测试
└── archive/                # 15 份 proposed-learnings 归档（v0.5 → v1.0.3）
```

---

## 2) 版本化与分发机制（consumer 采纳/升级）

**采纳（新项目）**：`npx degit tripplemay/harness-template` → `bash bootstrap.sh`（README.md:70-74）。`bootstrap.sh` 自 v1.4 起是薄封装（bootstrap.sh:2）：
- 已有 `harness.lock` → 拒绝，指向 `sync`（bootstrap.sh:20-24）；有 `harness-rules.md` 无 lock → 判为 v1.4 前存量项目，指向 `adopt`（bootstrap.sh:25-31）
- 区分 flat（degit 源即 CWD）/ nested（`framework/`）两种布局；flat 布局先 tar 到临时目录再铺回，防「从自己复制到自己」自噬（bootstrap.sh:45-56）
- 真正干活的是 `templates/claude/harness.sh init --from <源树>`

**账本契约**（harness/framework-versioning.md + harness.sh 实现）：
- `harness.json`：`framework.{source,source_url,version,commit,installed_from}` + `project.name`（harness.sh:267-271）
- `harness.lock`：`lock_version:1` + 受管文件清单，每文件记**双 sha256**——`sha256`（项目内上次对齐时内容）与 `upstream`（当时对齐的上游原文）；两者不等 = 有意的本地定制。只记单 sha 会让冲突永远无出口（harness.sh:11-16、framework-versioning.md:34-41）
- **两类文件边界写死**（harness.sh:96-123）：`managed`（5 份角色文件→项目根 + `templates/claude`→`.claude/` + `FRAMEWORK_MIRROR`：harness/memory/templates/patterns/console/docs 六目录镜像进 `framework/`，保证离线可读）升级时同步；`seeded`（CLAUDE.md、AGENTS.md、progress.json、INIT.md、`memory/`→`.auto-memory/`、proposed-learnings.md）只在 init 铺一次，**永不触碰**，且 init 时已存在即保留（harness.sh:252-258）

**harness.sh 六个子命令行为**：
- `verify`：五态对账 `ok / modified / outdated / conflict / missing`（harness.sh:316-369）
- `sync`：**任一冲突则整次升级不执行**，只把新版原文放 `<file>.harness-new`（harness.sh:408-417）；新版已删的受管文件只摘出 lock 不删文件（harness.sh:434-437）；`--dry-run` 预演；🔴 自我覆盖防护——sync 会更新 `harness.sh` 自己而 bash 边读边执行，故先复制到临时文件 `exec` 过去（harness.sh:52-62，v1.4.6）
- `resolve`：冲突人工合并后重新对齐双 sha（harness.sh:502-530）
- `adopt`：存量项目补账本，只记录不改文件——`sha256` 取项目现状、`upstream` 取参考版原文（harness.sh:471-475）
- `init/adopt` 收尾跑 `check_deploy_trigger`：检测「push main 即部署且无 paths 过滤」的 workflow，打印 paths-ignore 建议清单但不代改（harness.sh:189-235，v1.4.5）
- `--from <本地源树>` 是硬要求（离线可用红线），也可 `--ref <tag>` 按 `harness.json.framework.source_url` 从 remote 浅克隆（harness.sh:75-94）

**发布契约**（v1.5.3）：`harness/framework-releases.json` 是 v1 发布历史唯一机器事实源；`VERSION` 必须等于其末项，CHANGELOG 全部 v1 标题版本+日期双向一致；`.github/workflows/release-contract.yml` 在 PR/push 时跑 `scripts/validate-framework-release-contract.py` + `tests/test-framework-release-contract.py` fail-closed。

---

## 3) v1.0 → v1.7.1 演进主线（CHANGELOG 提炼）

| 版本段 | 日期 | 主题 |
|---|---|---|
| **v1.0.0-1.0.3** | 07-09~13 | **Claude Code 时代重构**：独立性从「第二个产品（Codex）」改为**上下文隔离**（fresh-context subagent）；快/慢两车道；hooks+skills+subagent 定义把「知情自律」变技术强制；patterns/ 目录分层；1.0.3 默认安装自主模式（gate-arbiter）与进度看板 |
| **v1.1.0-1.1.1** | 07-25 | **Dispatch Mode**：异厂商 CLI 派活。sandbox-profile 四道锁（env 白名单/独立 worktree/禁 push/wall-clock）；独立性铁则第 5 条 model_family 互斥；信封 schema 白名单；实测发现登录 shell 击穿 env 白名单 → `home_dir` 升硬性；Codex 适配器实测转正 |
| **v1.2.0-1.2.1** | 07-25 | **a2a transport 实装**（自建 stdlib runner/client，SSE+taskId 重订阅）+ Kimi 适配器接入，凑齐 claude×codex×kimi 三 family 去偏轮换池 |
| **v1.3.0-1.3.3** | 07-25 | **Console Mode**：`pending_gate` 闸门契约（人类批准的机器可读槽位）→ Ed25519 验签模式（信任从传输路径移到内容）→ 通道 B device-agent 中继实装（**实现在 tokenizer 工程**）→ 1.3.3 本机批准自足，控制台降回辅助工具 |
| **v1.4.0-1.4.6** | 07-26~27 | **框架版本化**（harness.json/lock 双 sha 账本 + harness.sh，见上节）；1.4.1-1.4.4 外部 generator 真派系列修正（macOS 超时误判/handoff schema/厂商沙箱下无法 commit → `git clone --shared`/外部 generator 不提交改由编排者对账打 tag）；1.4.5 部署副作用自检 + runner 生命周期；1.4.6 sync 自我覆盖修复 |
| **v1.5.0-1.5.3** | 07-27~30 | **签名模式意图**（`harness.json.project.mode_defaults` Ed25519 签名，`/plan` 边界消费）；dispatch deadline/生命周期收束（确定性 lifecycle matrix）；macOS LibreSSL 兼容；**发布清单契约** framework-releases.json + CI |
| **v1.6.0-1.6.4** | 07-31~08-03 | **工具绑定角色 v2**：人类只签 `{tool, invocation}` 不签 agent id；**Coordinator 固定控制面**概念确立；tool-catalog 可扩展 CLI 目录；适配器目录 pinning 与 A2A 安全修正；同会话 bridge fail-closed（sandbox-exec 不是安全边界）；**vm-v1 strict Kimi bridge provider**（Lima VM + attestation + systemd 降权闭环）；PostToolUse registry pinning |
| **v1.7.0-1.7.1** | 08-05~07 | **三向分叉收敛**：tokenizer 三轮真机 bridge 修复 + newkolmatrix 铁律 13（交付叙述必须有机械依据）+ codex `--ignore-user-config` 硬化一次性回流；1.7.1 修该 flag 引入的自定义 provider 断认证——sandbox-profile 加 fail-closed 派活前置 |

主线一句话：**v1.0 立骨架（隔离+守门）→ v1.1-1.2 向外派活（异厂商+网络）→ v1.3 向上接人（控制台+闸门签名）→ v1.4-1.5 可版本化可签名分发 → v1.6-1.7 把外部执行收进可证明的严格沙箱（attestation/VM/fail-closed）**。几乎每个 patch 版本都由下游项目（tokenizer / newkolmatrix / aigcgateway）真机踩坑回流驱动。

---

## 4) console/ 目录与 tokenizer 控制台的关系

本仓有**三个**「console」，职责不同：

1. **`console/`（仓库根）= 通道 A 的参考实现，是代码**：`server.py`（309 行，Python3 stdlib 零依赖）+ `ui.html`（233 行自包含，无 CDN）+ `console.config.example.json`。自托管小服务：维护各项目本地克隆、定时 `git pull` 读 progress.json 做只读镜像、人批准时写 `pending_gate.decision` 并 commit+push（server.py 顶部 docstring:4-18）。**不随 bootstrap 铺进项目**（console-mode.md:288 组件表标 ❌ 自托管），但会作为 `FRAMEWORK_MIRROR` 之一镜像进 consumer 的 `framework/console/` 供离线阅读（harness.sh:114）。
2. **`templates/claude/console/` = 项目侧闸门机件**（随 bootstrap 铺进 `.claude/console/`）：`pending-gate.schema.json`、`validate-pending-gate.sh`（schema/guard/hook）、`approve-gate.sh`（本机批准 CLI，双模式自足）、`gen-console-key.sh`、mode-intent 全套（schema+验签器+resolver+1325 行测试）。
3. **`harness/console-mode.md` = 契约文档**：闸门契约、两条通道、红线。

**与 tokenizer 的关系——tokenizer 是通道 B（中继）的实现方，不属于本框架仓**。console-mode.md:291 组件表原文：「中继实现（通道 B）| 另一工程（tokenizer）：服务端签发 + device agent 验签落盘 | ❌ 不属于本框架 | 已实装 ✅ 生产往返实测」；:293-296 明确「框架这边只规定**契约**：签名载荷规范化方式（§3.2）、`decision` 字段白名单（schema）、机器侧验签守门。任何持有出站 agent 的系统都能按这份契约接上，不必是那一个工程」。即：**框架仓出契约 + 通道 A 极简参考实现；tokenizer 出通道 B 生产实现**（服务端 Ed25519 签发 + device agent 出站轮询验签落盘，对应 tokenizer CLAUDE.md 所述「v1.3 起同时是 harness 编排控制台」与 `HARNESS_CONSOLE_SIGNING_KEY` fail-closed 约定）。CHANGELOG v1.3.2（:509-576）记录了这条跨仓接缝的生产往返实测。

---

## 5) 模板内容分类与比例

按文件性质三分（全仓 157 文件 ≈ 48,950 行；md 70 文件/11,342 行、sh 27/7,734、py 31/26,046、json 22/2,075、js+mjs 2/1,303、html 2/451、其余 VERSION/.gitignore/CI yml 3 个）：

**A. 规则/文档类 md（约 48 文件 / ~9,300 行，文件占比 ~31%，行占比 ~19%）**
`harness/` 10 篇状态机与模式文档、`docs/` 4 篇、`patterns/` 9 篇、`archive/` 15 篇、根部 README/CHANGELOG/INIT/cowork-constraint-design/proposed-learnings 5 篇，以及藏在 templates 里的 4 篇 transport 说明（`transports/{a2a,local-cli,session-bridge,external-bridge-provider}.md`）与 `autonomous/progress.autonomy-fields.md`。其中 CHANGELOG 一份就 1,761 行——它同时承担「设计决策档案」职能。

**B. 可执行机件（60 个代码文件 + 11 个 schema + 9 个机件性 md ≈ 80 文件 / ~37,600 行，文件占比 ~51%，行占比 ~77%）**
- 脚本/程序：sh 27 + py 31 + js/mjs 2（`gate-arbiter.workflow.js` 767 行 + 测试 536 行），合计 ~35,100 行。重头是 `templates/claude/dispatch/`（sandbox-profile.sh 1,002、validate-dispatch.sh 872、tool-catalog.py 1,717、vm-bridge-provider.py 3,278、a2a-client/runner 2,565…）
- schema 11 份（`*.schema.json`：dispatch 6 + console 2 + autonomous 2 + transports 1）
- 机件性 md 9 份：`agents/` 4 个 subagent 定义 + `skills/` 5 个 SKILL.md——形式是 md、功能是可加载执行单元
- **其中回归测试约 20 个文件 / ~13,000 行，占全部可执行代码约 37%**——这个比例本身是仓库特征：每个机件带负向测试（fail-closed 路径全覆盖）
- 另含 CI：`.github/workflows/release-contract.yml` + `scripts/` + `tests/`

**C. 模板/种子文件（约 20 文件 / ~1,900 行，文件占比 ~13%，行占比 ~4%）**
占位符与 seeded 内容：`templates/{CLAUDE,AGENTS}.md`、`signoff-report.md`、`migration-batch-checklist.md`、`prod-launch-audit-template.md`、`features.template.json`、`dashboard.template.html`、`pre-commit-hook.sh`、`settings.json`/`settings.autodrive.json`、`harness/progress.init.json`、`memory/` 8 份记忆种子、adapters 3 份 + bridges 1 份 + `agents-registry.example.json`、`console.config.example.json`。

**结论性观察**：按行数看这已不是「文档模板仓」而是**机件仓**——可执行代码占 ~77%，且 v1.1 之后新增行数几乎全部落在 dispatch/console/autonomous 机件与其测试上；md 规则层自 v1.0 后主要是增量修订（铁律 10→13、模式文档补节），印证了仓库自述的路线「写在文件里的规则依赖模型自觉，装进工具链的规则才是强制」（harness-rules.md §机制化守门）。