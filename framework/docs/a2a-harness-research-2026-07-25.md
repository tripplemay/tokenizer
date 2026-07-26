# A2A 协议 × Harness 编排——研究结论与升级开发指引

> **文档性质**：独立研究任务产物（2026-07-25，KOLMatrix M4 done 归档后旁路任务，不属任何批次）。
> **目标读者**：harness 模板仓库中承接开发的**独立 agent**——本文自足，不依赖产出会话的上下文；所有主张附判断依据，落地项以「候选 feature + acceptance 草案」形态给出，**最终拆批与裁决权归该仓库的 Planner 与用户**。
> **信息来源**：a2a-protocol.org 规范 v1.0（specification / what-is-a2a / extensions 三页，2026-07-25 抓取）+ adk.dev（ADK 集成面）。协议尚年轻，实装前应复核规范最新版。

---

## 1. A2A 协议技术摘要（v1.0）

**定位**：Agent2Agent Protocol，Google 发起、现归 Linux Foundation（Apache 2.0）。解决「把 agent 封装成 tool 从根本上受限」的问题——tool 无状态、预定义；agent 间需要多轮、有状态、可协商的协作。与 MCP 分工：**MCP 连模型与工具/数据（垂直），A2A 连 agent 与 agent（水平）**。

**设计原则**：复用现有标准（HTTP/JSON-RPC/SSE）· 企业就绪（认证/授权/监控）· 原生异步长任务 · 模态无关 · **Opaque Execution**（协作不暴露内部逻辑/记忆/专有工具）。

### 1.1 核心机制

| 机制 | 要点 |
|---|---|
| 传输 | 分层绑定：JSON-RPC 2.0 / gRPC / REST 三种官方绑定功能等价；规范真相源 `spec/a2a.proto` |
| 发现 | **Agent Card**（JSON，发布于 `/.well-known/a2a-agent-card` 或注册中心）：`provider` / `capabilities`（streaming·pushNotifications·extendedAgentCard）/ `skills` / `security`（API Key·OAuth2·mTLS 等声明）/ `interfaces` / `extensions` / `signature`（RS256 JWS，卡可验真）。认证后另有 Extended Agent Card |
| 任务生命周期 | 8 态：`SUBMITTED → WORKING → COMPLETED/FAILED/CANCELED/REJECTED`（四终态）+ 两个**中断态** `INPUT_REQUIRED`（等对方补充）与 `AUTH_REQUIRED`（等凭据授权）。服务端发 `taskId`（UUID），客户端凭其轮询/订阅/多轮续接（配 `contextId`） |
| 数据模型 | `Message`（role + parts + taskId/contextId）→ `Part`（text / raw / url / data + mediaType）→ **`Artifact`**（任务产物，落 `Task.artifacts[]`，与会话历史强制分离） |
| 异步三通道 | 流式（`SendStreamingMessage` / `SubscribeToTask`，事件 `TaskStatusUpdateEvent`/`TaskArtifactUpdateEvent`）· 推送（webhook，**at-least-once 投递**——消费端必须幂等）· 轮询（`GetTask` 兜底） |
| RPC 面 | `SendMessage` / `SendStreamingMessage` / `GetTask` / `ListTasks` / `CancelTask` / `SubscribeToTask` + 推送配置 CRUD + `GetExtendedAgentCard`；错误语义跨绑定统一（401/403/400/404/5xx + `@type` 结构化明细）；版本与扩展协商走 `A2A-Version` / `A2A-Extensions` 头 |
| 扩展机制 | 四类：Data-Only（只加元数据）/ **Profile**（在核心消息上叠加约束与子状态）/ Method（新增 RPC）/ **State Machine**（给任务状态机加状态/转移）。`required: true` 扩展客户端必须理解否则被拒。已有示例：Timestamp、Traceability（审计）、Secure Passport、AGP |

### 1.2 ADK 侧集成（当前唯一成熟对端生态）

ADK（Google 多语言 agent 框架）双向支持：把 ADK agent 暴露为 A2A 服务端（Python/Go/Java quickstart 齐备），或以 `RemoteA2aAgent` 形态把远程 A2A agent 当作本地编排图节点消费。**Claude Code 目前不原生说 A2A**——Claude 侧接入需自写桥。

---

## 2. 与 harness 编排设计的对照结论

两者不同层：**A2A/ADK 是运行时编排引擎与互操作协议，harness 是坐在引擎之上的契约纪律 + 持久骨架层**。概念映射整齐：

| A2A | harness 对应物 | 差异要点 |
|---|---|---|
| Agent Card + skills + 签名 | `.agents-registry` + `role_assignments` | harness 是散文+JSON 约定，无验真 |
| Task 8 态状态机 | 批次/feature 状态流转 | `REJECTED` ≈ Evaluator 拒收 |
| `INPUT_REQUIRED` | pre-impl 审计等 Planner/用户裁决 | harness 该态只活在 prompt 约定 |
| `AUTH_REQUIRED` | L2 授权门 / deploy 人闸门 | 同上——**实战已出过 evaluator 误跑 L2 套件的越界**（KOLMatrix M4 复验，靠自觉拦截失败一次） |
| `Artifact` 与 Message 分离 | verdict/signoff 落盘文件 vs 通知 | harness 在 M4 实战中因**通知通道截断 verdict** 被迫临时改为「写盘 + 通知传指针」——A2A 把这个教训做成了协议 |
| push at-least-once | 编排通知（存在重复/丢失） | M4 实战：4 个 subagent 因基础设施故障中断需手动复活；A2A 有 taskId 重订阅 |
| Traceability 扩展 | git 落盘审计轨迹 | 方向同、深度不及 git |

**一个关键张力**：A2A 的 Opaque Execution（不暴露内部）服务跨组织 IP 保护；harness 独立性铁则方向相反——Evaluator 必须看**实物代码**而非实现方叙述。不冲突的解法：A2A 消息只传「批次名 + repo ref + 状态文件路径」，evaluator 自行拉仓取证。**A2A 管交接信道，git 管证据与持久化**。

---

## 3. 升级收益评估（三档）

### 真实且可兑现
1. **跨模型对抗验收从定制题变集成题**。同模型 Generator/Evaluator 共享盲区（M4 实战：Generator 漏的文档残留，12 个同模型 evaluator 首轮同样漏，靠对抗复核才咬住）。异构模型（如 ADK+Gemini）当 evaluator，盲区相关性下降是真实质量增益；A2A 是唯一有现成对端的标准接法。
2. **两个散文护栏协议化**：L2/授权等待 → `AUTH_REQUIRED`；等裁决 → `INPUT_REQUIRED`。呼应 harness 自己的信条「写在文件里的规则靠自觉，装进工具链的规则才是强制」。
3. **交接可靠性语义标准化**：taskId 重订阅（对中断复活）、Artifact/Message 分离（对通知截断）、at-least-once 显式化（逼幂等设计）。

### 有条件
4. 过程与产品同构复利——仅当宿主产品自身走 agent 互操作生态（如 KOLMatrix 的 PendingAction 7 态与 A2A task 态几乎同构、Handoff 信封 ≈ Opaque Execution 反向孪生）。
5. 审计链增强（签名 Card + Traceability）——仅正式发布批次的最强隔离验收值钱。

### 幻觉（升级论证中须明确排除）
- **快车道零收益**：同会话隔离靠 fresh context 不靠传输层；包成 A2A 服务 = 平添服务进程与认证基建，隔离性一分不涨。快车道占日常 95%。
- **持久化骨架不可替代**：A2A task 是服务端瞬态；断点恢复铁律、审计轨迹、跨机总线压在 git 落盘文件上。升级后 progress.json/features.json 一个不能少。
- **纪律层协议管不了**：「只认实物」「结论原样落盘」「汇总是机械合并」是行为约束，协议运输状态、运输不了操守。
- **桥接成本是真的**：Claude Code 无原生 A2A，桥代码是新 bug 面；单机单人项目跑 OAuth/mTLS 基建为负资产。

---

## 4. 多厂商 agent 自动交接推进——可行性判断

**机械层：能。** 发现（Agent Card）、委托（SendMessage）、推进信号（状态事件/webhook）、产物传递（Artifact）、卡点上浮（两个中断态）协议全备——「A 家干完自动触发 B 家」不需要人盯。

**但「自动推进得对」取决于三样协议外的东西：**
1. **共享工作契约**：A2A 规定信封不规定信——spec 在哪、acceptance 怎么判、verdict 格式、PASS/PARTIAL/FAIL 语义要自己立。harness 的状态文件 + spec 文档就是这份契约，A2A 消息传引用；可用 `required` profile extension 把契约正式化（不认契约的 agent 协议层被拒）。
2. **状态机唯一持有者**：A2A 是点对点委托，无全局工作流概念。链式转委托无人持有全局真相、崩了无法对账；**对有审计与断点恢复要求的流程，hub 编排是唯一正确形态**——编排者持有 progress.json/features.json，A2A 只是派活信道。
3. **分布式可靠性**：at-least-once + 跨厂商重试 → 幂等键必须进任务契约（harness 闸门以 PendingAction.id 作幂等键的经验直接平移）；多家结论冲突协议不裁决，裁决归编排者/人（对抗复核机制即为此准备）。

**两条刻意不自动化的硬边界（设计选择，非能力缺陷）：**
- 阶段推进键归人：`→verifying`/`→done` 无人值守不得自动翻（orchestration-patterns §8「引擎永不自己按阶段推进键」）。
- deploy/prod/花钱永留人手；`AUTH_REQUIRED` 恰是这条线的协议化落点——流转至此必须停。

**结论一句话**：A2A 让多厂商自动交接从集成工程问题降级为配置问题；推进正确性仍取决于共享契约、唯一状态机持有者、保留的人闸门——harness 三样都已具备，缺的是桥不是骨架。

---

## 5. 给模板仓库的开发建议（候选 feature，供 Planner 拆批裁决）

### Tier 1 — 零协议采纳（建议现在做；无外部依赖，纯 harness 内语义升级）

**T1-a 显式中断态**
把「等授权 / 等裁决」从 prompt 约定升为结构化状态位（借 `AUTH_REQUIRED`/`INPUT_REQUIRED` 语义）。落点建议：evaluator/generator 交接信封（如 evaluator_feedback / generator_handoff 内 `waiting: 'auth' | 'adjudication' | null` 字段）+ 角色协议文件相应条款；**是否动 progress.json 顶层 status 枚举由 Planner 裁决**（动了要配套改所有消费方与校验 hook，铁律 7 多副本同步）。
acceptance 草案：中断态有唯一结构化表达；evaluator 撞 L2 边界的标准动作 = 写入 waiting 态并停止（不再依赖自觉）；对应 skill/角色文件同步；JSON 校验 hook 认识新字段。

**T1-b Artifact/指针分离转正**
「验收结论必须落盘为文件（Artifact），任何通知/消息通道只传指针 + 一行摘要」写进 verify SKILL 与 evaluator 角色文件为硬协议（来源：KOLMatrix M4 实战——通知通道截断 verdict 后的临时做法，已验证有效，应转正）。
acceptance 草案：verify 流程文档明示「结论文件先落盘、消息只传路径 + result 一行」；编排者汇总只读文件不读消息正文。

**T1-c（关联项，源自 ADK 对照而非 A2A）语义校验升级**
现有 JSON hook 只查语法；补关键语义门（如 status=done ⇒ signoff 非空；status 流转白名单：当前态→目标态合法表）。与 A2A 无依赖关系，但同属「把散文流转表变结构」，可并批。

### Tier 2 — 触发式试点（有对端时做；范围锁死在慢车道验收单点）

**T2 A2A evaluator 桥**：正式发布批次以异构模型 agent（如 ADK 系）经 A2A 承担 evaluator。设计要点：
- 编排者实现 A2A **client**（对端是 server）；hub 形态，状态机仍在编排者手里
- 任务载荷 = 批次名 + repo ref + 状态文件/spec 路径（Opaque Execution 与「只认实物」的兼容解，见 §2 张力）
- 状态映射：`WORKING`=验收中 · `INPUT_REQUIRED`=待裁决 · `AUTH_REQUIRED`=待 L2 授权 · `COMPLETED`+Artifact=verdict 落盘 · `REJECTED`=拒收 spec
- verdict 以 Artifact 返回后由编排者**机械**写入 git（铁律 12 原样落盘不变）
- 幂等键进任务契约；工作契约做成 `required` profile extension
- 明确非目标：不替代 git 骨架、不覆盖快车道

### Tier 3 — 全面协议化（仅当宿主产品自身走 A2A 生态时顺势而为，不单独立项）

### 红线（任何 Tier 不得违反）
1. 人闸门不可自动化（阶段推进 / deploy / 花钱）
2. git 落盘骨架不可被瞬态 task 状态替代
3. 独立性纪律条款（无自评 / 只认实物 / 原样落盘 / 机械汇总）保留散文层，协议只做运输

---

## 6. 开放问题

- Claude Code 原生 A2A 支持时间表未知；桥的维护成本随协议版本演进（v1.0 刚发，预期仍有 breaking change）
- OpenAI 系工具的 A2A 采纳度未确认——「多厂商」今天实际可选对端 ≈ ADK 系
- A2A 扩展注册生态（谁在维护公共扩展目录）待观察
- 规范中 graph/任务编排的错误恢复细节文档薄弱（Resume Agents 提及未展开），试点前需实测

## 7. 参考

- 规范：https://a2a-protocol.org/latest/specification/
- 定位与 MCP 分工：https://a2a-protocol.org/latest/topics/what-is-a2a/
- 扩展机制：https://a2a-protocol.org/latest/topics/extensions/
- ADK 集成：https://adk.dev/a2a/ · ADK 总览：https://adk.dev/

---

*研究与撰写：Andy（KOLMatrix 主实例，独立任务模式）· 2026-07-25 · 实战证据引用自 KOLMatrix M4-INSIGHT 批次验收过程*
