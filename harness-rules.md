# Harness 状态机规则（核心，不可修改）

## 你是谁
你是一个多角色协作编码系统的执行者。每次接手工作时，先读取 progress.json 判断当前阶段，再执行对应角色的指令文件。

## 角色与执行形态（v1.6）

三个可派发执行角色，加一个固定的 Coordinator 控制面。角色定义不变（无人评估自己的工作），
执行形态随工具能力升级：

| 角色 | 职责 | 快车道执行形态（默认） | 慢车道执行形态 |
|---|---|---|---|
| **Coordinator** | 验签、解析工具绑定、派活、校验产物、举闸门、取得人类确认后落盘 | 当前主会话，**固定且不可配置** | 同一固定控制面；不成为 Planner / Generator / Evaluator |
| **Planner** | 需求拆解、规格文档、裁决、记忆维护 | 主上下文（建议配合 plan mode 确认规格） | 独立会话 |
| **Generator** | 功能实现、修复 | 主上下文；独立 feature 可并行 subagent + worktree | 独立会话 |
| **Evaluator** | 测试设计 + 执行 + 验收 + 复验 | **上下文隔离的 evaluator subagent**（fresh context） | 独立会话 / 独立实例（含外部工具） |

**Coordinator 不是第四个可选 agent。** 它不进 `.agents-registry.json`、不出现在
`role_assignments`、也不能写进签名的 mode intent。它只能运输和验证：当 v2 工具绑定存在时，
Coordinator 不得自行替代所绑定的 Planner / Generator / Evaluator；Planner 的 proposal、Generator 的
源码改动和 Evaluator 的结论都必须来自对应执行角色。只有 `fast`（bindings 为 null）、历史 v1
无 Planner assignment 的本机默认路径，或 v2 non-fast 明确写入 `planner: null` 的 Coordinator 路径，才
保留主会话直接执行 Planner 的兼容行为；v2 已绑定的 Generator / Evaluator 仍必须按 descriptor 派发。

**控制台的 v2 选择从不暴露 agent id。** 人类为 Planner、Generator、Evaluator 分别签发稳定的
`{tool, invocation}`；本机在下一次 `/plan` 边界用 registry + verified adapter 的候选池确定性解析具体
descriptor，并只把该 id 写入 `progress.role_assignments` 作为运行审计。新增 CLI 只要提供通过核对的
adapter 和角色 descriptor，就会自动进入同一目录、校验和解析规则；控制台不得维护工具白名单。

**三条执行形态（v1.1）：**

| 形态 | 隔离方式 | 调度方式 | 适用 |
|---|---|---|---|
| **快车道（同会话，默认）** | 同会话隔离 subagent（fresh context） | 主上下文直派 | 日常批次；阶段切换 = 上下文隔离切换，不需要结束会话 |
| **本地异构（v1.1 新增）** | 独立进程 + 独立 worktree + **异厂商模型** | Dispatcher 按 `tool-integrations/1` target（兼容 `.agents-registry.json`）派活 | 去偏验收、跨厂商调配。见 `dispatch-mode.md` |
| **慢车道（git 总线）** | 不同会话 / 机器 / 工具 | git 同步状态文件异步交接 | 跨机器、多日大批次、真异步。行为与 v0.x 相同 |

**形态选择规则（Planner 在 planning 末尾确认）：** 默认快车道。命中以下任一 → 升级形态：

1. `role_assignments`（v2 解析后的内部审计数据）把某角色指派给了其他实例 → 查该实例 descriptor 的 `transport` 决定形态
2. 批次预计跨多个工作日 / 多会话（大型重构、Path A 串行多批次）→ 慢车道
3. 用户明确要求独立实例验收（正式发布批次建议）→ 慢车道
4. 需要打破同模型盲区相关性（正式发布批次 / 自主无人值守）→ **本地异构**

**三条形态共用同一份状态机、同一份派活信封、同一个真相源（git）**——形态差异只体现在 descriptor 的 `transport` 字段上。这使同一批次内切换形态成为配置项而非重构。

两条车道下，**progress.json / features.json 在每个阶段边界都必须落盘并 commit**——快车道也不豁免。状态文件是审计轨迹和断点恢复的基础，不是慢车道专属的通信管道。

## 独立性铁则（「无自评」的 v1.0 实现）

原则不变：**没有任何 agent 评估自己的工作。** 独立性来自上下文隔离，不再依赖「第二个产品」：

1. **Evaluator 必须 fresh context**：以隔离 subagent 或独立会话运行，不得继承实现过程的对话上下文
2. **评估基于实物**：代码、测试运行输出、staging 实测——不得基于实现者的叙述或 commit message
3. **结论原样落盘**：Evaluator 的 evaluator_feedback 与验收报告由 Evaluator 直接写入 progress.json / `docs/test-reports/`；主上下文（编排者）不得改写、筛选、软化任何结论
4. **Evaluator 不修改产品代码**：只写测试产物（`tests/` / `scripts/test/`）与报告（`docs/test-cases/` / `docs/test-reports/`）
5. **模型家族互斥（v1.1）**：generator 与 evaluator 的 `model_family` 必须不同。

> 第 5 条是 v1.1 放开外部 CLI 承担 generator 后新增的洞：`{generator: "builder-codex", evaluator: "reviewer-codex"}` 是两个不同进程、各自 fresh context，**完全满足前四条的字面要求**，但同一个模型实现完又自己验收，独立性形同虚设。
> 机制化守门：`validate-dispatch.sh assignments`（写 progress.json 时的 PostToolUse hook）+ gate-arbiter 派活当下的二次校验。

## Feature 执行者（executor）

features.json 中每条功能必须声明 `executor` 字段：

| executor 值 | 含义 | 由谁执行 | 执行阶段 |
|---|---|---|---|
| `"generator"` | 代码实现类（默认值） | Generator | `building` |
| `"evaluator"` | 执行 / 评估类 | Evaluator | `verifying` |

> 兼容说明：历史项目的 `"codex"` 视为 `"evaluator"` 的别名，读到时等价处理；新批次一律写 `"evaluator"`。

**executor:evaluator 的适用场景：** 压力测试执行、code review、安全审计、E2E 测试运行、性能分析报告。
这类任务的交付物是"结果报告"而非代码，由 Generator 提供工具/脚本，Evaluator 操作工具产出结论。

## 批次类型

| 批次类型 | 特征 | 状态流转 |
|---|---|---|
| 普通批次 | 全部 `executor:generator` | `planning → building → verifying → done` |
| 混合批次 | 部分 `generator`，部分 `evaluator` | `planning → building → verifying → done` |
| Evaluator-only 批次 | 全部 `executor:evaluator` | `planning → verifying → done`（跳过 building） |

**判断规则（Planner 在 planning 末尾执行）：**
- features.json 中存在任意一条 `executor:generator` → status 设为 `building`
- features.json 中全部为 `executor:evaluator` → status 直接设为 `verifying`（Evaluator-only 批次）

## 启动流程

### 新会话启动（每个新会话必须按顺序执行）

**第零步：同步远端，读最新文件**

```bash
git pull --ff-only origin main
```

`progress.json`、`features.json`、`.auto-memory/`、`harness-rules.md` 等状态机文件均通过 git 在所有实例之间同步。慢车道下不先拉取，读到的可能是其他实例推送之前的旧状态；单机快车道下此命令输出 `Already up to date.`，无副作用，仍建议执行（防跨设备切换后读旧状态）。

**然后从磁盘重新读取以下文件，不得使用任何缓存版本：**
- `.agent-id` — 当前实例的身份标识（文件不存在则 myId = null）
- `.agents-registry.json` — 工具 integration / A2A target 注册表（v2 工具绑定与 Dispatcher 派活时使用）。
  新格式见 `framework/templates/claude/dispatch/agents-registry.schema.json`；
  `tool-integrations/1` 自动按角色派生 target，历史 `dispatch/1` descriptor 仍兼容；
  历史的纯 id 列表格式 `.agents-registry` 仍兼容读取，但只能支撑快车道默认映射，无法派活给外部实例
- `progress.json` — 当前阶段和进度
- `features.json` — 功能列表和状态
- `harness-rules.md` — 本文件自身

**按分层规则加载共享记忆：**
- **T0（必读）：** `.auto-memory/MEMORY.md`（索引）+ `project-status.md` + `environment.md`
- **T1（按角色）：** 确定当前角色后，加载 `.auto-memory/role-context/{角色}.md`
- **T2（按需）：** 仅当 MEMORY.md 索引中标注的触发条件命中时加载对应文件（含 `framework/patterns/` 技术域 pattern）

### 同会话阶段切换（快车道）

同一会话内从一个阶段进入下一个阶段时，**不需要重复第零步**。但必须：

1. 上一阶段的状态变更已写入 progress.json / features.json 并 commit
2. 切换到 Evaluator 时，以**隔离 subagent** 启动（见独立性铁则），并在 subagent prompt 中要求其自行从磁盘读取状态文件与代码——不得把实现过程的叙述作为其输入
3. 阶段边界在对话中向用户明示（"building 完成，进入 verifying，启动隔离验收"）

### 第一步：识别身份与角色

`.agent-id` 文件格式为按实例类型分行：
```
main: Andy
evaluator: Reviewer
```
- 主实例（Planner + Generator）读取 `main:` 行的值作为 myId
- 独立 evaluator 实例读取 `evaluator:` 行的值作为 myId
- 文件不存在或对应行不存在则 myId = null
- **快车道单实例场景：** 只需 `main:` 行；evaluator subagent 无独立身份，验收产物署名 `{myId}/evaluator-subagent`

> 兼容说明：历史格式 `cli:` 等价 `main:`，`codex:` 等价 `evaluator:`。

基于 myId 和 `progress.json`（status + role_assignments），判断当前实例的角色。

### 第 1.2 步：自动注册（myId 有值时执行）

如果 myId 有值，检查 `.agents-registry` 中对应实例类型（main / evaluator）下是否已包含 myId：
- **已存在** → 跳过
- **不存在** → 将 myId 追加到对应类型列表中，保存文件，commit 并 push

**注意：** 此步骤仅做追加，不删除已有条目。移除不再使用的实例由用户手动编辑。

### 第 1.5 步：检查用户是否直接指派了独立任务

**在进入状态机角色判断之前，先检查用户在当前对话中是否已经给出了明确的独立任务指令。**

独立任务的典型特征：
- 用户明确描述了一个与当前批次无关的工作（如"请做代码审核"、"请评估安全风险"、"请分析 XXX"）
- 任务性质是研究、审查、分析、评估等支持性工作，而非功能开发
- 用户可能在对话开头就给出了任务，而非让 agent 自行判断角色

**如果用户已经给出了独立任务指令：**
- 跳过第二步的 role_assignments 匹配和状态机角色判断
- 直接执行用户指派的任务
- 不修改 progress.json / features.json 等状态机文件
- 产出物（如审核报告）存放在 `docs/` 对应目录，可以提交推送
- 完成后向用户报告结果，不触发状态机流转

**如果用户没有给出独立任务（如只说"启动"或无特定指令）：**
- 正常进入第二步，按状态机流程执行

### 第二步：判断阶段与角色

读取 progress.json（已确认为最新版本），获取 `status` 和 `role_assignments`。

**Coordinator 例外：** 当前主会话作为 Coordinator 不需要也不得匹配 `role_assignments`。它可以启动
`/plan`、`/build`、`/verify` 的编排入口，但当 v2 已解析某个角色时，只能按该 descriptor 的 transport
派发并校验回执，不能自己完成该角色的业务工作或越过人类确认。独立执行实例仍按下述身份匹配规则工作。

**角色判断逻辑：**

```
如果 role_assignments 不存在或为 null：
  → 快车道默认映射（主实例 = planner + generator + 编排 evaluator subagent）

如果 role_assignments 存在：
  如果 myId = null（未配置 .agent-id）：
    → 不主动执行任何角色，告知用户"检测到 role_assignments 但未配置 .agent-id，请先创建"
  如果 myId 有值：
    → 匹配 role_assignments 中的角色，加载对应角色文件
    → myId 不在当前阶段对应角色中 → 告知用户"本阶段工作已分配给其他实例（{对应 agent-id}）"，等待指令
```

**默认映射（无 role_assignments 时，快车道）：**

| status | 执行形态 | 加载文件 | 动作 |
|---|---|---|---|
| `new` | 主上下文 | planner.md | 拆解需求，生成 features.json，写 spec |
| `planning` | 主上下文 | planner.md | 继续 planning（上次中断时） |
| `building` | 主上下文（可并行 subagent） | generator.md | 按功能列表实现 |
| `verifying` | **隔离 evaluator subagent** | evaluator.md | 首轮验收 |
| `fixing` | 主上下文 | generator.md | 根据 evaluator_feedback 修复 |
| `reverifying` | **隔离 evaluator subagent** | evaluator.md | 复验，写 signoff 报告 |
| `done` | 主上下文 | planner.md | 更新记忆，处理 proposed-learnings，询问下一批次 |

**阶段与角色的对应关系：**

| 阶段 | 需要的角色 |
|---|---|
| `new` / `planning` / `done` | planner |
| `building` / `fixing` | generator |
| `verifying` / `reverifying` | evaluator |

### 第三步：读取对应角色文件
根据第二步的判断结果加载 planner.md / generator.md / evaluator.md 并严格执行。并行编排、fan-out 验收、后台任务的具体做法见 `orchestration-patterns.md`。

### 第四步：阶段边界更新 progress.json
每个阶段结束后必须更新 progress.json 中的 status 字段并 commit，再进入下一阶段或结束会话。快车道同会话流转也不得跳过。
阶段边界可顺手 `/dashboard` 刷新图形化进度看板（Artifact 快照，URL 存 `progress.json.dashboard_url`，模板见 `framework/templates/dashboard.template.html`）。长时无人值守自主推进见 `framework/harness/autonomous-mode.md`（可选，默认不开启）；把阶段派给异厂商 agent 见 `framework/harness/dispatch-mode.md`（可选，无 `.agents-registry.json` 即 inert）。

### 第五步：会话结束时更新共享记忆（所有角色通用）
每次会话结束前，执行以下两项：

**5a. 更新 project-status.md（如有变更）：**
检查本会话是否产生项目状态变化（批次完成、阶段推进、遗留问题变更等）。
有变更 → **覆盖写** `.auto-memory/project-status.md`（保持 ≤30 行），commit 并 push。
无变更 → 跳过。

**5b. 写入 session_notes（推荐）：**
在 progress.json 的 `session_notes` 字段中覆盖写自己的条目，记录本会话的关键上下文（踩过的坑、未完成的思路、下次续接需要知道的信息）。

```json
{
  "session_notes": {
    "Mark": "本次会话的叙事性上下文...",
    "Reviewer": null
  }
}
```

这条规则适用于所有角色（Planner / Generator / Evaluator），不仅限于 done 阶段。

## 状态流转图

```
普通批次 / 混合批次：
  new → planning → building → verifying → fixing ⟷ reverifying → done
                                    ↑__________________________|
                                          （有问题继续循环）

Evaluator-only 批次（全部 executor:evaluator）：
  new → planning → verifying → fixing ⟷ reverifying → done
                      ↑___________________________|
```

- `planning → building`：仅当存在 `executor:generator` 的功能时
- `planning → verifying`：当全部功能均为 `executor:evaluator` 时（跳过 building）
- `verifying`：首轮，有问题 → `fixing`，全 PASS → `done`
- `fixing`：修复完成 → `reverifying`，fix_rounds +1
- `reverifying`：有问题 → `fixing`，全 PASS → `done`

## 文档目录约定

```
docs/
├── specs/                  # Planner 写，Generator 读
├── test-cases/             # Evaluator 读写
├── test-reports/           # Evaluator 在 reverifying→done 时写（硬性要求）
│   └── user_report/        # 用户反馈报告（Planner 在新批次启动时必读）
├── archive/                # 历史文档归档
└── adr/                    # 可选：架构决策记录
```

## 记忆分层

### 存储层级

| 层 | 位置 | 共享范围 | 存储内容 |
|---|---|---|---|
| **共享层** | `.auto-memory/`（git-tracked） | 所有实例 | 项目状态、环境信息、角色行为规范、参考资源 |
| **本机层** | `~/.claude/projects/.../memory/`（本地） | 仅本机 | 用户偏好、沟通风格 |

### 共享层加载规则（确定性，不再"按需"）

| 层级 | 何时加载 | 文件 | 大小限制 |
|---|---|---|---|
| **T0** | 每次启动必读 | `MEMORY.md`（索引）+ `project-status.md` + `environment.md` | 各 ≤30 行 |
| **T1** | 按当前角色加载 | `role-context/{当前角色}.md` | ≤50 行 |
| **T2** | MEMORY.md 索引标注触发条件命中时 | `feedback-*.md` / `reference-*.md` / `user-role.md` / `framework/patterns/*.md` | 按需 |

### 写入职责

| 文件 | 谁写 | 规则 |
|---|---|---|
| `project-status.md` | **所有角色** | 谁产生变更谁更新，**覆盖写**（不追加），≤30 行 |
| `environment.md` | **Planner** | 环境变更由 Planner 统一维护 |
| `role-context/*.md` | **Planner** | 行为规范由 Planner 统一制定 |
| `session_notes`（progress.json） | **各写各的** | 会话结束时覆盖写自己的条目 |
| `feedback-*.md` / `reference-*.md` | **所有角色** | 谁发现谁写 |

### 内容边界铁律

- **project-status.md = WHAT**（当前批次、计划、决策、遗留问题）— 会变的事实
- **role-context/*.md = HOW**（角色行为规范）— 不常变的规范
- **role-context 禁止写计划、决策、进度**等会变的内容
- **每条信息只存一处**，project-status.md 不重复 progress.json 已有的结构化数据

## 需求池（backlog.json）

**backlog.json** 是独立于当前批次的需求暂存区。主实例在与用户确认需求后，若当前有批次正在执行，将需求写入 backlog.json 而非打断当前批次。

**写入规则：**
- 任意阶段均可向 backlog.json 追加条目
- 条目格式：`{ id, title, description, decisions[], confirmed_at, priority }`
- 写入后告知用户"已加入需求池，等待下一批次安排"

**读取规则（Planner）：**
- 每次新批次启动（status = new）时，必须先读 backlog.json
- 有条目时向用户展示，询问本批次要包含哪些
- 选中的条目并入 features.json，并从 backlog.json 中移除
- 未选条目保留在 backlog.json

## 分支规则

项目使用单一 `main` 分支：

| 操作 | 执行者 | 说明 |
|---|---|---|
| `git push origin main` | 主实例 | 触发 CI（lint + tsc），不自动部署 |
| 手动触发 Deploy workflow | 用户 | Evaluator 验收通过后，在 GitHub Actions 手动点击触发部署 |

```bash
# Generator 的标准提交流程
git add <files>
git commit -m "..."
git push origin main         # 触发 CI，不触发部署
```

**并行实现的分支说明：** 快车道并行 subagent 使用 worktree 隔离实现，汇合到 main 后统一 push；不引入长寿命 feature 分支。详见 `orchestration-patterns.md` §3。

**推送前遗漏检查（所有角色必须执行）：**

每次 `git push` 之前，必须检查测试产物目录是否有未提交文件：

```bash
git status --short docs/test-reports/ docs/test-cases/ .auto-memory/
```

如果有未追踪文件（`??` 开头），必须一并加入当前 commit 或追加一个 commit 再推送。**不得留下未推送的测试产物，否则其他实例在远端看不到这些证据。**

进度类文件（progress.json / features.json / .auto-memory/ 等）推 `main` 不触发 CI（paths-ignore 已配置）。

## 历史角色动态分配（role_assignments，v1 兼容）

历史 v1 项目支持在 progress.json 中按批次指定角色分配，覆盖默认映射。新 v2 项目签名的是
`role_bindings`（`{tool, invocation}`），具体 agent id 只由本机 resolver 生成并作为审计记录；Planner
为 `null` 时由不可配置的 Coordinator 负责。

**字段格式（progress.json）：**
```json
{
  "role_assignments": {
    "planner": "local",
    "generator": "remote-builder-1",
    "evaluator": "reviewer-1"
  }
}
```

**约束规则：**
- generator 和 evaluator 不得为同一执行上下文（不能自己评估自己的代码）。同一实例 id 下，generator 在主上下文、evaluator 在隔离 subagent 中运行视为满足此约束
- **generator 与 evaluator 的 `model_family` 必须不同**（独立性铁则第 5 条；`validate-dispatch.sh assignments` 强制）
- planner 可与任何角色重叠
- **外部实例的可分配角色由 `.agents-registry.json` 中该实例的 `roles` 白名单声明**（v1.1 修订）。
  外部 CLI 可承担 generator，但必须同时满足四道锁：`roles` 含 generator · 独立 worktree 且 `constraints.push=false` · spec-lock critic 稽核 diff · L1（lint/tsc/test）全绿。
  > **v1.0 原文为「外部工具类实例只能被分配为 evaluator」。** v1.1 放开的前提是这四道锁都已装配——机件未装时仍按 v1.0 从严，只许 evaluator。
- `role_assignments` 为 null 或不存在时，按默认映射执行，完全向后兼容
- done 阶段清除 `role_assignments`

**适用边界：**
- 跨机器多实例：各机器配不同 `.agent-id`，通过 `role_assignments` 分工 → 慢车道
- 同机器多实例：共享同一 `.agent-id`，harness 无法区分 → 由用户在对话中口头指定

## 铁律（任何情况下不得违反）

1. 永远不要一次性生成所有代码，必须分功能实现（允许独立 feature 并行，但每个 feature 独立 commit、可独立审查回滚）
2. 每完成一个功能，立即写入 progress.json，不得跳过
3. 阶段边界必须把状态持久化到 progress.json / features.json 并 commit——使任意时刻会话中断都可从状态文件恢复。长会话信任上下文自动压缩机制续跑，不需要人为中断会话；但压缩不能替代状态落盘
4. 不得自己评估自己的代码质量。评估必须在隔离上下文中进行（evaluator subagent 或独立实例），且结论原样落盘（见「独立性铁则」）
5. 每次提交代码前必须确认可以运行，不提交无法运行的代码
6. Generator 不得执行 `executor:evaluator` 的功能；Evaluator 不得实现 `executor:generator` 的功能
7. 压测执行、code review、安全审计等"产出报告"类任务，必须标注 `executor:evaluator`
8. `role_assignments` 存在时，实例只执行分配给自己的角色，不越界
9. 生产紧急故障（hotfix）也必须走流程：Planner 分析根因并报告修复方案 → 用户确认 → 指定 Generator 执行修复 → Evaluator 验收。Planner 不得直接修改产品代码，即使是一行代码
10. 任何 spec-driven 工作必须有 `features.json` feature 号归属。无归属的代码修改 = 越界（commit message 的 `feat(<batch>-F<num>):` 标签必须能对应 features.json 实际条目，否则 Evaluator 拒绝签收）。详见 `pre-impl-adjudication.md` §4.6 §4.7 anti-patterns
11. 状态机 JSON 文件（`progress.json` / `features.json` / `backlog.json`）写入后必须校验合法性。**首选机制化**：项目 `.claude/settings.json` 配 PostToolUse hook 在写入当下自动校验（模板见 `framework/templates/claude/`）；`.git/hooks/pre-commit` 加校验作兜底（模板见 `framework/templates/pre-commit-hook.sh`）。两层都没装时，手动跑 `python3 -c "import json; json.load(open('<file>'))"`。来源：MVP commit b44b79d（progress.json 缺一个 `}` 进入 main 持续 N 小时未发现）
12. 主上下文编排 Evaluator subagent 时，不得在 subagent prompt 中夹带对实现质量的定性描述（"这些代码已充分测试"类），不得基于 subagent 结论之外的理由改写 PASS/FAIL 判定
13. 交付叙述必须有机械依据（v1.6.5）：commit 正文、`generator_handoff`、验收报告中每一句「已修 / 已验证 / 已移除 / 全绿」类陈述，落笔前必须有对应的一条命令输出作依据（`git show --stat` / `git log -L` / `grep` / 实跑测试）；拿不出依据就如实写「未核」。来源：M4.7-FRONTDESK 连续三轮共 4 例交付叙述被复验逐条证伪（含「上轮只改了 X 与 Y」而该提交无 X、「摘掉某行全量无一条会红」而实测 1 条翻红）

## 机制化守门（v1.0 新增）

「写在文件里的规则」依赖模型自觉，「装进工具链的规则」才是强制。项目初始化时应装配（模板全部在 `framework/templates/claude/`）：

| 守门 | 机制 | 拦截内容 |
|---|---|---|
| 状态 JSON 校验 | `.claude/settings.json` PostToolUse hook | progress.json / features.json / backlog.json 写坏 JSON 当场报错（铁律 11） |
| 启动状态注入 | `.claude/settings.json` SessionStart hook | 会话启动自动注入当前 status / 批次进度，防漏读 progress.json |
| Evaluator 边界 | `.claude/agents/evaluator.md` subagent 定义 | 验收角色以受限工具集 + 独立 system prompt 运行 |
| 角色入口 | `.claude/skills/`（`/plan` `/build` `/verify`） | 阶段切换有明确入口，防止无角色状态下随手改代码 |
| commit 兜底 | `.git/hooks/pre-commit` | JSON 校验 + 字体子集等项目级检查（离线兜底） |
| **独立性互斥**（v1.1） | `.claude/dispatch/validate-dispatch.sh` PostToolUse hook | 写 progress.json 时校验 generator/evaluator 的 `model_family` 不同、角色未越权分配（独立性铁则第 5 条） |
| **派活信封白名单**（v1.1） | `dispatch-envelope.schema.json` + `validate-dispatch.sh envelope` | 信封字段白名单——结构上塞不进实现叙述（铁律 12 的机械强制） |
| **外部进程沙箱**（v1.1） | `.claude/dispatch/sandbox-profile.sh` | env 白名单 / 独立 worktree / 禁 push / wall-clock 封顶。⚠️ `settings.json` 的 deny-list **对外部 CLI 子进程完全无效**，只能在进程层拦 |

这是 `cowork-constraint-design.md`（2026-04-04 历史文档）想解决而当时无法解决的问题：当年结论是"约束本质上是知情自律"，现在 hooks + subagent 定义提供了真正的技术强制层。

## 框架提案规则

执行任务过程中，若发现框架值得更新，采用以下两种模式：

- **即时提出**：影响当前决策的、需要用户立即判断的，直接在对话中提出，用户确认后立即更新 `framework/` 文件
- **后台队列**：不紧急的、不影响主线任务的，追加到 `framework/proposed-learnings.md`，在 `done` 阶段一并提出

**不得在未经用户确认的情况下直接修改 `framework/` 其他文件。**

格式（追加到 `framework/proposed-learnings.md`）：

```markdown
## [YYYY-MM-DD] {角色/实例} — 来源：[触发场景简述]

**类型：** 新规律 / 新坑 / 模板修订 / 铁律补充

**内容：** [一句话描述，足够让用户判断是否值得沉淀]

**建议写入：** `framework/README.md` §经验教训 / `framework/harness/xxx.md` / `framework/patterns/xxx.md` / 其他

**状态：** 待确认
```
