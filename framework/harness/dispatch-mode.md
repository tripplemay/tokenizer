# Dispatch Mode —— 自动调配异厂商 agent（第三执行形态）

> **状态：已纳入框架（默认安装，inert）。** 机件在 `.claude/dispatch/`（沙箱 + schema + 校验器 + transports）。
> **安装 ≠ 启用**：没有 `.agents-registry.json` 就完全 inert，快车道行为一字不变。
>
> **加载层级：T2（按需）。** 仅在设计/运行跨厂商派活时加载，不进「每批次必读」集。
>
> **来源：** A2A 协议 v1.0 研究（`docs/a2a-harness-research-2026-07-25.md`）+ 用户裁决四项：
> 对端=异构 CLI · 交付=规范+机件 · 自动化边界=接 autodrive 可逆内环 · 外部 CLI 放开承担 generator。

---

## 1. 定位：解决的是「派活」，不是「协议」

慢车道原本缺三样：**① 没有派活抽象**（`role_assignments` 只是字符串 id，编排者知道该谁干却不知道怎么把活递过去）、
**② 没有唤醒信号**、**③ 没有回执与超时**。

①是地基，且是纯 harness 内的抽象工作，**一行协议都不需要**。②③才需要协议栈，且只在跨机器时才值钱。
本模式做①，顺带把 A2A 的语义借过来做③的降维版；②留给未来的 A2A transport。

**核心动作：抽出 Dispatcher 层，把「车道」降级为 descriptor 里的一个 `transport` 字段。**

| `transport` | 含义 | 形态 |
|---|---|---|
| `subagent` | 同会话隔离 subagent | 快车道（默认） |
| `local-cli` | 独立进程 + 独立 worktree + 异厂商模型 | **本地异构（本模式主体）** |
| `a2a` | 自建 runner（长驻 HTTP 服务） | **真异步 / taskId 重订阅 / SSE 推送 / 跨机器**（已实装，见 `transports/a2a.md`） |

`local-cli` 提供**模型异构**（阻塞子进程，会话在任务在）；`a2a` 在其上再加**时间与空间解耦**
（派完可关会话、凭 taskId 重订阅、跨机器）。两者共用同一份信封、回执表与状态机，
差异被 `dispatch-run.sh` 吸收——**引擎侧完全不感知 transport**。

## 2. 一句话架构

```
role_assignments: { "generator": "builder-codex", "evaluator": "reviewer-claude" }
        ↓ 解析
.agents-registry.json  descriptor（L1）：transport · model_family · roles · constraints · sandbox
        ↓ 组装
dispatch-envelope（L2）：字段白名单，只传指针（batch · repo@sha · spec · features · l2_flag · 内联契约）
        ↓ 机件 #7 沙箱：env 白名单 · 独立 worktree · 禁 push · wall-clock 封顶
     外部 CLI 进程
        ↓ 产物落盘（verdict.json / worktree commit）
回执推断（L3）：exit code + 产物存在性 + schema + waiting → 6 态
        ↓ 机械回写（铁律 12 逐字）
progress.json / features.json —— 唯一真相源
        ↓
gate-arbiter：Class A 自动跨 · B 需 policy 授权 · C 硬停（L4：阶段推进键永不归引擎）
```

## 3. 四层设计

### 3.1 L1 — Agent Descriptor（`.agents-registry.json`）

harness 版 Agent Card，A2A Agent Card 的最小可用子集。schema 见
`templates/claude/dispatch/agents-registry.schema.json`，示例见同目录 `agents-registry.example.json`。

必填四项：`id` · `roles`（可分配角色白名单）· `transport` · `model_family`。
`transport=local-cli` 另需 `adapter`；`a2a` 需 `endpoint`；`subagent` 需 `agent_type`。

历史的纯 id 列表 `.agents-registry` 仍兼容读取，但只能支撑快车道默认映射——它没有派活所需的信息。

### 3.2 独立性互斥（**放开外部 generator 后新增的洞**）

`{generator: "builder-codex", evaluator: "reviewer-codex"}` 是两个不同进程、各自 fresh context，
**完全满足铁律 4 的字面要求**——但同一个模型实现完又自己验收，独立性形同虚设。

> **规则：generator 与 evaluator 的 `model_family` 必须不同。**（harness-rules.md 独立性铁则第 5 条）

两道机制化守门：
1. `validate-dispatch.sh assignments` —— 写 `progress.json` 时的 PostToolUse hook，越界拒写
2. `gate-arbiter.workflow.js` 的 `resolveEvaluators()` —— 派活当下二次排除同 family 者（纵深防御）

副产品：去偏从「可选优化」升级为**结构性保证**——机件 #6 的档位轮换随之升级为跨厂商 family 轮换。

### 3.3 L2 — Dispatch 信封

schema 见 `dispatch-envelope.schema.json`。两个关键设计：

**① `additionalProperties: false` 是安全属性，不是风格选择。** 字段白名单意味着结构上塞不进
「这些代码已充分测试」之类的实现叙述——**铁律 12 由此从模型自觉变为机械强制**。
任何「补充说明 / 背景 / 提示」类自由文本字段的新增提案都应被拒绝。

**② 只传指针，对方自行拉仓取证。** `repo: {url, ref}` 锁定到 commit sha（不接受分支名——验收对象
必须是确定的一次快照）。这是 A2A 的 Opaque Execution 与 harness「只认实物」的兼容解：
A2A 管交接信道，git 管证据与持久化。

**可直接复制的合法信封（两个角色各一）：**

```jsonc
// evaluator：验收一次快照，产物是 verdict 工件
{ "task_id": "BL-XXX-verify-<sha12>",       // 幂等键，重复派活会被拒
  "contract_version": "harness/1.1",
  "batch": "BL-XXX", "role": "evaluator",
  "repo": { "url": "/abs/path/or/git-url", "ref": "<40 位 sha，不接受分支名>" },
  "spec": "docs/specs/BL-XXX.md", "features": ["F001"], "l2_authorized": false,
  "contract": { "task": "……逐条按规格 §4 验收；自己跑命令；不要复述提交信息……" },
  "deliverable": { "artifact": "docs/test-reports/BL-XXX-verdict.json",
                   "schema": ".claude/autonomous/verdict-artifact.schema.json",
                   "commit_to": null } }

// generator：写代码，产物是 handoff 清单（代码本身以未提交 diff 形式留在沙箱里）
{ "task_id": "BL-XXX-build-<sha12>", "contract_version": "harness/1.1",
  "batch": "BL-XXX", "role": "generator",
  "repo": { "url": "/abs/path", "ref": "<sha>" },
  "spec": "docs/specs/BL-XXX.md", "features": ["F001"], "l2_authorized": false,
  "contract": { "task": "……只许动哪些文件；不得 push；跑不动 L1 就如实写未跑……" },
  "deliverable": { "artifact": "docs/test-reports/BL-XXX-handoff.json",
                   "schema": ".claude/dispatch/generator-handoff.schema.json",
                   "commit_to": null } }
```

⚠️ **`deliverable.artifact` 由信封说了算**（v1.4.3 修）：适配器的 `artifact_relpath` 只是
该 CLI 的默认约定，信封是这一次任务的契约，契约压过约定。

⚠️ **`local-cli` 派活必须后台运行 + 轮询**：`dispatch-run.sh` 是阻塞式的，而 `timeout_s`
常以千秒计；在会超时的前台里等，会被外部 SIGTERM 打断并留下孤儿工作目录（同 `task_id`
重派又会被幂等守门拒，只能人工清理）。

### 3.4 L3 — 回执推断（中断态的降维）

A2A 的 `INPUT_REQUIRED` / `AUTH_REQUIRED` 依赖「服务端挂起等你」，一次性 CLI 进程做不到。
解法是**把中断态编码进产物**，而不是编码进进程状态——`verdict-artifact.schema.json` 的 `waiting` 字段：

| `waiting` | 触发 | 编排者动作 |
|---|---|---|
| `null` | 活干完了 | 继续状态机 |
| `"auth"` | 撞 L2 边界而 `l2_authorized=false` | **硬停**等授权 |
| `"adjudication"` | 规格歧义 / acceptance 无法客观判定 | **硬停**转 pre-impl 审计 |

完整推断表见 `transports/local-cli.md` §4。其中最要紧的一条：

> **exit 0 但产物缺失 → 判 `FAILED`，不是 `COMPLETED`。**
> 外部 CLI「礼貌地失败」（打印一段说明然后正常退出）是常态。不写死这条，礼貌失败会被当成验收通过。

重派上限 1 次，仍不过 → `evaluator_cannot_verify` / `generator_cannot_deliver` 硬停 + 通知，
**绝不静默无限重跑**（沿用 autonomous-mode.md §9）。

### 3.5 L4 — 谁按阶段推进键

**编排者，永远。** transport 只运输，不推进。完全沿用 `orchestration-patterns.md` §8
「引擎拥有阶段内部怎么跑，progress.json 拥有跨阶段的真相与流转闸门；引擎永不自己按下阶段推进键」。

## 4. 组件

| 组件 | 职责 | 机制 | 状态 |
|---|---|---|---|
| **Descriptor 注册表** | 把 id 解析为「怎么找到它 + 能干什么 + 不许干什么」 | `.agents-registry.json` + schema | 已装 |
| **信封校验器** | 字段白名单（铁律 12 机械强制） | `validate-dispatch.sh envelope` | 已装 |
| **互斥校验器** | 独立性铁则第 5 条 | `validate-dispatch.sh assignments`（PostToolUse hook） | 已装 |
| **机件 #7 沙箱** | 四道锁；deny-list 在进程层的替代 | `sandbox-profile.sh` | 已装 ✅ 实测通过 |
| **回执推断器** | exit code + 产物 + waiting → 6 态 | `validate-dispatch.sh receipt` | 已装 ✅ 实测通过 |
| **适配器** | 各家 CLI 的 argv / 投递方式 / 产物约定 | `transports/adapters/*.json` | Codex ✅ 0.145.0 · Kimi ✅ 0.26.0；Gemini 未写 |
| **统一派活入口** | 按 transport 路由，对上层隐藏差异 | `dispatch-run.sh` | 已装 ✅ 实测通过 |
| **a2a runner** | 把一次性 CLI 包成长驻 A2A 服务端 | `transports/a2a-runner.py` | 已装 ✅ 实测通过 |
| **a2a client** | 编排者侧 hub client（SSE / 轮询 / 幂等） | `transports/a2a-client.py` | 已装 ✅ 实测通过 |
| **dispatcher subagent** | 跑三条机械命令取回执；**无评估权** | gate-arbiter `dispatchExternal()` | 已接线 |
| **family 轮换** | 跨厂商去偏（机件 #6 升级） | gate-arbiter `resolveEvaluators()` | 已接线 |

## 5. 安全模型

### 5.1 机件 #7：deny-list 对外部 CLI **完全失效**

> `autonomous-mode.md` §6 是自主模式的承重墙：「硬闸门在工具层强制，不在迁移层」。
> 但那份 deny-list 写在 `.claude/settings.json` 里，**只约束 Claude Code 自己的工具调用**。
> 一旦编排者拉起外部 CLI 子进程，它有自己的权限模型、自己的工具集、自己的 shell——
> 可以 `git push`、可以 `prisma migrate deploy`、可以调花钱 API。**现有机件一条都拦不住**，
> 闸门分类器更看不见（那是阶段内部的工具调用）。

工具层拦不住，就在**进程层**拦。四道锁（`sandbox-profile.sh`），全部经真实 Codex 进程实测：

| 锁 | 实现 | 拦住 | 实测（codex-cli 0.145.0） |
|---|---|---|---|
| **L1 env 白名单** | `env -i` + descriptor 显式列名 **+ 专用空 HOME（硬性前置）** | prod 凭据 / 部署 token / 他家 key | ✅ 日志中 `SECRET_TOKEN` / `DATABASE_URL` 零出现 |
| **L2 独立 worktree** | `git worktree add --detach <sha>` | 污染工作区、并行互踩 | ✅ 主仓零改动，产物只落 worktree |
| **L3 禁 push** | `GIT_CONFIG_*` env 级覆盖 `remote.origin.pushurl` | 直接改 main | ✅ 9 条子进程命令中无 push |
| **L4 wall-clock 封顶** | `timeout -k 10 <timeout_s>`（无 GNU timeout 时 bash watchdog） | 跑飞挂死 | ✅ 267s 正常收敛 |

**三个实现陷阱（都是实测踩出来的，不是推演）：**

1. 🔴 **L1 依赖专用空 HOME，否则形同虚设。** 外部 CLI 普遍用**登录 shell** 执行命令
   （Codex 用 `/bin/zsh -lc`），登录 shell 会 source `~/.zshenv` 与 `~/.zprofile`——
   其中任何 `export` 都会把 `env -i` 刚剥掉的变量**原样还回子进程**。
   实测：HOME 指向含 `.zshenv` 的目录时 `DATABASE_URL` / `DEPLOY_TOKEN` 全部复活。
   故 `sandbox.home_dir` 对 `local-cli` 是**必填**（schema + 校验器 + 沙箱三处 fail-closed），
   且沙箱启动时断言该目录内无 `.zshenv/.zprofile/.zlogin/.bashrc/.bash_profile/.profile/.envrc`。
   认证靠 `sandbox.env_set` 精确投喂（如 `CODEX_HOME=~/.codex`），不再需要放行整个真实 HOME。
2. ⚠️ **禁 push 绝不能用 `git remote set-url`** —— worktree 与主仓共享 `.git/config`，
   那样会把主仓的 push 地址一起改掉。必须用 env 级 config 覆盖（只影响子进程，不落盘）。
3. ⚠️ **显式传厂商自己的沙箱参数。** Codex 的 `-s/--sandbox` 若不显式传，会读 `~/.codex/config.toml`——
   用户若在那里设了 `danger-full-access`，我们的沙箱被静默削弱。适配器显式传 `-s workspace-write` 覆盖之。

**这四道锁**不**保证什么（同样要说清）：**

- **不是文件系统沙箱。** 四道锁是 env 白名单 / 独立工作目录 / 禁 push / 时间封顶——
  没有一条阻止外部 CLI **读**主仓，也不阻止它写工作目录之外的路径。
  实测：Codex 主动 `ls` 过主仓的 `node_modules` 并复用了它（只读，且如实披露）。
  Codex 自带 `-s workspace-write` 作为第二道防线；**Kimi 在非交互模式下没有任何权限层**。
  真要文件系统隔离得靠 OS 层（macOS `sandbox-exec`、Linux bwrap/容器），那是另一档成本。
  当前设计是**用产物 schema 与回流校验兜底，不是用隔离兜底**。
- **不保证对方能跑 L1。** 一次性工作目录里没有 `node_modules`，而 Codex 的沙箱禁网
  （`npm ci` 装不了）。沙箱注入 `HARNESS_MAIN_REPO=<主仓绝对路径>` 供对方只读复用依赖；
  跑不动就该在产物里如实写「未跑」——**编排者本来就要自己重跑**（回流第 3 步）。
- **不保证超时能被重派。** 见 v1.4.1：watchdog 必须留下自己开枪的凭据，否则超时会被
  误判成失败（macOS 无 GNU `timeout` 时恒中）。

**残余风险（诚实列明）：**

- ~~**R1 — HOME 凭据外溢**~~ **已关闭**：`home_dir` 升为硬性前置 + `env_set` 精确投喂认证目录后，
  子进程既拿不到 `~/.aws` / `~/.config/gcloud`，也不会经 dotfile 还原被剥离的变量。
- **R2 — 该 CLI 自身推理凭据的花费不受 harness 管控。** 它拿到的仅此一项（拿不到项目的生产与部署凭据），
  但这笔钱的上限在厂商账户侧，`autonomy-policy.json` 的 budget 管不到。**未解决，设计上接受。**
- **R3 — 出网未限制。** macOS 上做进程级网络隔离成本过高，当前依赖「无凭据」而非「无网络」。**未解决。**
- ~~**R4 — 沙箱在 `a2a` 下整体失效**~~ **对自建 runner 不成立**：runner 在自己所在机器调本地
  `sandbox-profile.sh`，四道锁一条不少。R4 仅适用于**我们不控制的第三方对端**——
  接非自建对端前必须人工确认其机件在位（Agent Card 的 `x-harness.sandboxed` 是声明，不是证明）。
- **R5 — `env_set` 指向真实 `CODEX_HOME` 时，子进程对该目录有写权限**（会话库、config）。
  以 `--ephemeral` 缓解（不落会话文件）；彻底隔离需为沙箱复制一份独立的认证目录。

### 5.2 信任模型：不信任对方守规矩，只信任产出能过 schema

Claude 读 `CLAUDE.md`，Codex 读 `AGENTS.md`，Gemini 读 `GEMINI.md`。给每家维护一份指令文件
必然漂移，且**无法验证对方是否读过、是否遵守**。所以信任点必须挪：

1. 契约**随信封走**（`contract` 字段内联，常量模板，不由模型撰写），不依赖对方读仓内任何文件
2. 产出**必须过 `deliverable.schema`**；不合规就机械拒收，重跑上限 1 次，仍不过则硬停

这是框架自己那句信条的跨厂商版本：**装进工具链的规则才是强制。**

## 6. 外部 generator 的四道锁与回流

v1.1 放开外部 CLI 承担 generator（v1.0 原规则是「外部工具只能 evaluator」）。前提是四道锁全部装配：

1. `descriptor.roles` 白名单含 generator
2. 独立沙箱且 `constraints.push=false`（`write_src=true` 的角色用 **`git clone --shared`**
   而非 worktree —— 见下方「为什么外部 generator 不提交」）
3. **spec-lock critic 稽核 diff**（机件 #2），稽核时机从「writeback 前」前移到**「拉回主仓前」**——
   产物还在 worktree 里，拦得住才不会污染 main
4. L1（lint / tsc / test）全绿 —— 代码 diff 比 verdict 更好机械核验，这是外部 generator 的硬证据

**回流四步（编排者执行，外部实例永不直接 push）：**

1. **diff 与 handoff 清单对账** —— 实际改动的文件必须落在 `generator-handoff.json` 的
   `files_touched` 与规格边界之内；多出来的即 **scope 漂移**，拒收
2. **spec-lock critic 稽核**（机件 #2）
3. **L1 全绿，由编排者亲自重跑** —— handoff 里的 `l1_ran` 只是对方的自称，不作数
4. **编排者按 `features.json` 打 tag 并提交**（`feat(<batch>-F<num>):`，铁律 10），统一 push

### 🔴 为什么外部 generator **不提交**（v1.4.4 设计订正）

v1.1 起这里写的是「tag 归属校验：外部 CLI 自己打 tag，不合规就拒收」。**首次真派 Codex
写代码时才发现这条根本走不通**：厂商沙箱（Codex `-s workspace-write`）禁止写 `.git`，
`git commit` 连 `index.lock` 都建不出（实测原话 `Operation not permitted`）；改用独立克隆
把 `.git` 挪进沙箱内**同样被拒**——它禁的是 `.git` 本身，与位置无关。

要求外部 CLI 提交，等于**把交付能力绑死在厂商沙箱策略上**，而这条绑定换不来任何安全收益：
它本来就 `push=false`，提交与否不改变任何风险面。真正防 scope 漂移的是「diff 与清单对账」，
那件事编排者做得更好，也更难被绕过（对方写什么 commit message 都不影响实际 diff）。

故：**外部 generator 交未提交的改动 + handoff 清单；tag 与提交归编排者。**
`handoff.commits` 因此转为可选字段（多数厂商沙箱下它必然为空）。

> **副产品：** 一次 30 分钟的实现不会再因为 commit message 写错格式而被整轮拒收。

**机件未装齐时仍按 v1.0 从严，只许 evaluator。**

## 7. 与 autonomous-mode 的接线

`gate-arbiter.workflow.js` 的改动（无 `args.registry` 时全部回退 v1.0 行为，存量项目零影响）：

- `build` 分支：generator 解析到 `local-cli` → `dispatchExternal()`；否则原 `generator-restricted` 路径
- `verify` 分支：`resolveEvaluators()` 按 family 轮换（已排除与 generator 同 family 者）；
  主 evaluator 为外部时走 dispatch，否则原 `EVAL_TIERS` 档位轮换
- `dispatchExternal()` 派的 **dispatcher subagent 无评估权**：其返回 schema 里结构性地没有装结论的字段，
  只有 receipt state + 两个路径 + 纯数值的 `verdict_summary`。**模型在这条链路上永不携带结论**，
  完整判定由耐久层从产物文件逐字读取回写 —— 铁律 12 的又一处结构强制

**耐久层（`/autodrive`）需承担的新职责：**

| 职责 | 说明 |
|---|---|
| 注入 `args.registry` | Workflow 无文件系统权限，注册表须由耐久层读盘注入 |
| 注入 `state.head_sha` / `state.spec_path` / `state.l2_authorized` | 信封组装所需 |
| **外部主验时的去偏比对** | 引擎返回 `stepResult.debias = {feature_id, second_result, compare_at:'durable'}`；耐久层与产物中该 feature 的 result 比对，不一致 → `debias_conflict` 硬停 |
| 外部 generator 回流 | §6 的四步 |

## 8. 红线（任何情况不得违反）

1. **阶段推进键归人或归 policy 预授权**，transport 不得自动翻 status（§3.5）
2. **git 是唯一真相源**，外部进程与 A2A task 都是瞬态；`progress.json` / `features.json` 一个字段不能少
3. **独立性**：generator 与 evaluator 不同 id **且**不同 `model_family`（§3.2）
4. **信封字段白名单不得放宽**（§3.3 ①）
5. **deploy / prod / 花钱**永远硬停；且**不得依赖 deny-list 拦外部进程**——那是无效的（§5.1）

## 9. 仍待建

| 项 | 状态 | 说明 |
|---|---|---|
| Codex 适配器端到端演练 | ✅ **已完成**（2026-07-25, codex-cli 0.145.0） | 见 `local-cli.md` §7 核对记录；`_verified: true` |
| `/autodrive` 耐久层四职责 | ✅ **已接线** | 步骤 0 断言 / 步骤 1 注入 / 步骤 6a 收割与去偏比对 / 6a-3 回流 |
| 外部 generator 回流的 tag 策略 | ✅ **已定：拒收不重写** | 重写 = 未经取证的归属判定，且掩盖 scope 漂移信号（`/autodrive` §6a-3 注） |
| 第二家适配器 | ✅ **Kimi 已转正**（0.26.0） | 轮换池 claude × codex × kimi 三个 family。Gemini 因本机未装而暂缺——未实测的适配器不写进模板 |
| `a2a` transport | ✅ **已实装**（2026-07-25） | 自建 runner + client + SSE + task store；真实 Codex 经 a2a 演练通过（198s，SSE 全程保活）|
| a2a 真实跨机器演练 | ⬜ 未做 | 全部在 loopback 完成；网络路径与 Bearer 鉴权已验证，未在两台物理机之间跑过 |
| a2a 协议完整性 | ⬜ 刻意不做 | 只做 JSON-RPC 绑定；无 gRPC/REST、无扩展协商、无签名 Card、无 OAuth/mTLS、无 push webhook |
| 端到端**自主**演练（`/autodrive` 全循环带外部派活） | ⬜ 未做 | 单步派活已验证；多轮唤醒 + 闸门 + 回流的整链需接真实项目 |

## 10. 建造顺序（机制化先于自动化）

1. **机件 #7 沙箱**（四道锁）—— 地基，没它护栏是纸面 ✅
2. **descriptor / 信封 schema + 校验器** ✅
3. **回执推断表** ✅
4. **`waiting` 中断态** ✅
5. **接 gate-arbiter**（dispatch 分支 + family 轮换）✅
6. 适配器实测核对 → 置 `_verified: true` ✅（Codex）
7. `/autodrive` 耐久层四项职责 ✅
8. `a2a` transport（真异步 / 重订阅 / SSE）✅
9. 先在 evaluator 单点放开，跑稳后再放开 generator ⬜ ← **当前位置**

## 11. 与现有机制的关系

**复用（不重造）：** progress.json/features.json 状态机脊椎、`orchestration-patterns.md` §8 日志契约、
`verdict-artifact.schema.json` + `validate-verdict-artifact.sh`（机件 #3，兼作跨厂商交付契约）、
`spec-lock-critic` subagent（机件 #2）、gate-arbiter 纯函数 governor/闸门（机件 #4）、`/loop` 自排程。

**新增件（`bootstrap.sh` 默认铺入 `.claude/dispatch/`）：**

> - `sandbox-profile.sh` — 机件 #7 四道锁
> - `agents-registry.schema.json` + `agents-registry.example.json` — L1
> - `dispatch-envelope.schema.json` — L2
> - `validate-dispatch.sh` — registry / envelope / assignments / receipt / hook 五合一校验器
> - `dispatch-run.sh` — 统一派活入口，按 transport 路由
> - `transports/local-cli.md` + `transports/adapters/codex.json` — 首家适配器
> - `transports/a2a.md` + `a2a-runner.py` + `a2a-client.py` — a2a transport（已实装）
>
> 另修改：`verdict-artifact.schema.json`（+`waiting`）、`gate-arbiter.workflow.js`（dispatch 分支）、
> `harness-rules.md`（三形态 / 独立性铁则第 5 条 / 角色约束修订 / 守门表）。

---

## 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-07-25 | 初版（v1.1）：四层设计 / 机件 #7 沙箱 / 回执推断 / waiting 中断态 / family 互斥 / 外部 generator 放开 / gate-arbiter 接线 | A2A 协议研究（`docs/a2a-harness-research-2026-07-25.md`）+ 用户四项裁决 |
| 2026-07-25 | v1.2：`a2a` transport 实装（自建 runner + client + SSE + 落盘 task store + 幂等 + 断线重放）；`dispatch-run.sh` 统一入口使引擎 transport 无关；R4 对自建 runner 不成立 | 真实 Codex 经 a2a 演练（198s） |
| 2026-07-25 | v1.1.1：Codex 适配器实测转正；**发现登录 shell 经 .zshenv/.zprofile 还原被剥离变量 → `sandbox.home_dir` 升为硬性前置**（R1 关闭）；新增 `sandbox.env_set`；`/autodrive` 四职责接线；tag 策略定为拒收不重写 | codex-cli 0.145.0 端到端演练 |
