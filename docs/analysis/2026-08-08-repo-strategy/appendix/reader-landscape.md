# AI 编程 Agent 编排控制台 × LLM Token 用量观测：业界现状调研报告（2025–2026）

> 调研方式：WebSearch + WebFetch，共 14 次检索/抓取。所有论断均标注来源 URL（见 §4）。时间基准：2026-08。

---

## 1) 功能基准表

### 1a. Token / 成本观测赛道

| 产品 | 形态 | 成本/token 追踪 | 预算与限额 | 归因维度 | 会话/trace 深度 | 其他 |
|---|---|---|---|---|---|---|
| **LiteLLM Proxy** | 自托管网关 + Admin UI | 按 virtual key / user / team 自动记账（`LiteLLM_VerificationTokenTable` / `UserTable` / `TeamTable`），跨 100+ provider | key/user/team 三级预算 + rate limit，预算按秒/分/时/天周期重置 | key、team、user、tag | 无深度 trace（网关定位） | virtual keys 是团队级 API 管理事实标准 [docs.litellm.ai/docs/proxy/virtual_keys, /docs/proxy/users] |
| **Langfuse** | SDK/OTel 接入，开源可自托管（MIT 核心） | 每 trace/generation 的 token 与成本 | 非重点 | user、session、tag、release | **最深**：全链路 trace（LLM+检索+工具调用）、session 聚合重放、**agent graph 自动推断**（从 observation 嵌套/时序推断执行图）、从任意节点冻结上下文重放 | prompt 管理、evals、datasets、playground [langfuse.com/docs/observability/features/sessions] |
| **Helicone** | 代理式接入（近零代码改动） | 每请求成本/延迟可见 | 有（gateway 层） | 请求级 | 浅（无深度 agent tracing / eval） | 内置缓存；最快上手路径 [helicone.ai/blog/the-complete-guide-to-LLM-observability-platforms] |
| **OTel GenAI SemConv** | 标准（非产品） | `gen_ai.usage.input_tokens` / `output_tokens` 属性 | — | `gen_ai.provider.name` 判别 provider | 2024/04 GenAI SIG 成立后范围已从 LLM 调用扩到 **agent 编排、MCP 工具调用、内容捕获、质量评估**；默认不采 prompt 内容（隐私） | Datadog/MLflow 等已原生支持 [opentelemetry.io/blog/2026/genai-observability/] |
| **ccusage** | 本地 CLI（读 JSONL） | 日/周/月/session 报表，含 cache creation/read token 单列、USD 估价 | 无 | 模型、项目（多实例分组）、时区 | 无 | **已从 Claude Code 单一工具扩为覆盖 Codex、OpenCode、Amp、Droid、Codebuff 等多家 CLI**——与本项目定位直接重叠 [github.com/ryoppippi/ccusage] |
| **Claude Code 自带遥测** | 原生 OTLP 导出（`CLAUDE_CODE_ENABLE_TELEMETRY=1`） | metrics：token、`claude_code.cost.usage`（USD/请求）、session 数、代码行、commit 数；events：`api_request`（逐调用 token/cost）、`tool_result`、`tool_decision`（权限决策）、`skill_activated` | 无（观测端） | model、`agent.name`、`skill.name`、`query_source`——**可按团队/模型/工作流拆分** | 事件级 per-session/per-prompt/per-tool | 内容捕获默认关闭；任何 OTLP 后端可接 [signoz.io/blog/claude-code-monitoring-with-opentelemetry/] |
| **Codex CLI 用量** | `/status`（会话快照）+ `/usage`（账户视图）+ web 端 usage 页 | token 计数含全部 overhead；5 小时滚动窗口限额仅 web 可见 | ChatGPT 订阅限额 | — | `/status` 只在会话内、需手动跑——**催生了 Codextime、SessionWatcher 等第三方跟踪器生态** [github.com/openai/codex/issues/15281] |
| **Claude Team/Enterprise 后台** | SaaS 管理面 | 组织级：代码接受行数/率、DAU、用户排行；2026-07 新增更细 analytics + Analytics API | **org / group / user 三级 spend cap（个人覆盖组、组覆盖 org）+ 75%/90% 花费告警 + 模型级 entitlement** | 用户、团队、模型 | — | [support.claude.com/en/articles/12883420] |
| **OpenAI 企业管理台**（2026-06） | Global Admin Console | ChatGPT + Codex credit 统一视图，按 user/product/model 细分；统一 Cost API | 花费上限 + 实时告警 | 用户、产品、模型 | **含 code review 质量指标**：PR 审查量、按优先级分类 findings、评论/反馈情绪 | [openai.com/index/chatgpt-enterprise-spend-controls/] |

### 1b. Agent 编排与管理面板赛道

| 产品 | 任务面板 | 并行 agent 管理 | 人审批闸门 | 成本观测 | 回放/审计 | 特色 |
|---|---|---|---|---|---|---|
| **GitHub Copilot：Agents Panel（2025-08）+ Mission Control（2025-10）** | github.com 任意页面的轻量 overlay + 全屏 `github.com/copilot/agents`；从 panel/chat/mobile/首页仪表板多入口建任务 | 多任务并行、跨仓库指派、任务切换器、自定义 agent 选择 | **多重硬闸门**：Actions 工作流须人点 "Approve and run"（2026-03 才允许 admin 选择性豁免）；agent 只能推 `copilot/*` 前缀分支、无 main 写权限；PR 必须人审、Copilot 不能自批自并；受限网络防火墙（仅放行包管理源） | 企业侧在 Copilot 计费/席位维度 | **session logs 展示推理过程与每次 commit 的决策依据**；2026-03 企业版新增全组织 session 过滤 | 实时 steering（聊天/文件批注中途改道）；Codespaces/VS Code/CLI 三路"接管"通道 [github.blog] |
| **OpenAI Codex（cloud + app）** | ChatGPT 内 Codex = "agentic coding command center"；macOS Codex App 专为多 agent 管理设计 | 云端 3–5 任务并行排队，各自沙箱 + 独立 git 状态；内置 worktrees | 产出为 proposed changes，人审后合入 | 个人 token 用量 dashboard（2026）+ 企业 admin console | 多 agent 调试与 agent 性能分析 | Automations（云端触发器持续后台跑）、Skills（沉淀团队规范跨任务复用）[openai.com/index/introducing-the-codex-app/] |
| **Devin（Cognition）** | 会话（session）列表 + Slack/API 入口 | **MultiDevin：manager Devin 拆解任务→委派给隔离 VM 中的 worker Devin 并行执行**；可向子会话发消息、暂停/终止 | 计划确认 + PR 人审 | **ACU（compute unit）计量**：产品内引导"session ≤10 ACU"（长会话性能退化）；manager 可监控每个子会话 ACU 消耗 | 会话日志 | **机器快照**（约 15 秒建快照、约 10 秒到首消息，环境预置可复用）；企业 API 可编程建快照/克隆仓库 [cognition.com/blog/devin-can-now-manage-devins] |
| **Cursor background agents** | `cursor.com/agents` web 面板 + 3.0（2026-04）Agents Window 侧栏：**本地+云端、跨仓库所有活跃 agent 会话一屏** | 单 prompt 最多 8 agent 并行（可多模型对比）；每 agent 独立云 VM，2026-02 起带浏览器 computer-use + 视频录制 | 产出走分支+PR | 订阅计费维度 | agent VM 操作视频录制 | 企业可从 web 面板**下发 hooks**（按 OS 定向）[cursor.com/changelog/2-0] |
| **Claude Code（web/cloud + teams）** | claude.com/code 云会话面板（手机可指派） | 云端多会话并行（独立 Ubuntu VM）；**Agent Teams（2026-02，实验性）：2–16 agent 共享代码库协作** | 云沙箱内降低逐操作审批（爆炸半径受控）；本地端 permission 系统 | 云跑用量并入订阅 rate limit；OTel 遥测（见 1a） | teleport 命令把云会话完整对话历史拉回本地终端续跑；Remote Control 反向把本地会话镜像到 web | [code.claude.com/docs/en/claude-code-on-the-web] |
| **Conductor（Melty Labs）** | Mac 桌面 app，workspace 列表 | **每 workspace = 一个 git worktree**，多 Claude Code agent 并行免冲突 | 人工 merge review | 无 | 无 | 把"每任务一 worktree"手工模式产品化；$22M A 轮 [rustman.org/wiki/conductor-parallel-agents/] |
| **Terragon** | 云端后台 agent 编排（Claude Code/Codex 等 CLI） | 曾支持 | — | — | — | **已关停**——纯云托管第三方编排的商业模式风险信号 [rustman.org/wiki/conductor-parallel-agents/] |
| **vibe-kanban（BloopAI，开源）** | **看板即编排**：卡片 To Do→In Progress→Review→Done 驱动状态机 | 拖卡自动建隔离 worktree + 启动所绑 agent（支持 Claude Code/Codex/Gemini/Amp/Copilot/Cursor/Droid/Qwen/OpenCode 9+ 家）；独立任务并行、有依赖则串行链式 | Review 列 = 人审列；UI 内看 diff/日志，可选开 GitHub PR | 无（只付底层 AI 费用） | UI 内 diff + 日志留存 | **与本项目形态最接近的开源对标物**：多厂商 CLI + 看板 + worktree 隔离 [github.com/BloopAI/vibe-kanban] |

---

## 2) 行业标准/协议中与编排控制台相关的要点

**MCP（2025-11 周年版规范）** [blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/]
- **Tasks API**：agent 经 MCP 发起异步长任务、稍后回查结果——把 MCP 从同步工具调用扩展为"安全、长时、受治理的工作流"载体。编排控制台若做任务派发，这是对齐点。
- 无状态化、服务器身份（server identity）、CIMD（Client ID Metadata Documents）简化客户端注册与信任。
- 官方社区 Registry 上线做 server 发现；Notion/Stripe/GitHub 等已建官方 server，活跃 server 数以千计。

**A2A（Agent2Agent，Linux Foundation）** [linuxfoundation.org/press/...a2a...]
- 2025-04 Google 发布，2025-06 捐给 Linux Foundation（AWS/Cisco/Google/Microsoft/Salesforce/SAP/ServiceNow 创始成员）；2026-04 已 150+ 组织支持，spec v1.0。
- **任务生命周期状态机**：`submitted → working → input-required → completed | failed | canceled`，JSON-RPC 2.0 over HTTPS——与本项目 harness 的 `new→planning→building→verifying→fixing→done` 属同构问题，`input-required` 对应人闸门。
- **Agent Card**：描述"整个 agent 作为协作方"的能力发现文档（对比 MCP server 描述的是单个工具）——与本项目 `.agents-registry.json` 的 descriptor/`tool-integrations` 概念直接对应。

**AGNTCY** [blckalpaca.at/.../agent-cards-und-discovery]
- 组件：**Directory**（Agent Card 用 OASF 格式集中注册，agent 靠目录而非硬编码地址互相发现）、Identity、SLIM Messaging、**Observability** 框架——"注册表 + 身份 + 观测"三件套正是编排控制台的骨架。

**OTel GenAI SemConv** [opentelemetry.io/blog/2026/genai-observability/]
- 已覆盖 agent 编排 span、MCP 工具调用、`gen_ai.usage.*` token 属性、`gen_ai.provider.name` 判别；默认不采内容。**若 tokenizer 的采集 schema 对齐 gen_ai.* 属性名，可零成本接入 Datadog/MLflow/SigNoz 等生态**。

---

## 3) 推导：「agent 编程项目管理系统」完整功能清单

### 必备档（竞品全景中 ≥3 家收敛的能力）

1. **统一任务/会话面板**：跨项目、跨 agent 的活跃任务一屏视图 + 状态指示 + 任务切换（Copilot Mission Control、Cursor Agents Window、Codex App、vibe-kanban 四家收敛）。tokenizer v1.3 的"多项目进度镜像"方向正确，需补齐"活跃会话实时态"而非仅阶段快照。
2. **任务状态机与生命周期**：显式 submitted/working/input-required/done 类状态流转（A2A 标准化；vibe-kanban 用看板列表达）。本项目 progress.json 已有，控制台应可视化 + 可查询历史流转。
3. **人审批闸门（多层）**：行业收敛为三层——**执行前**（工作流/危险操作审批，Copilot "Approve and run"）、**产出后**（PR 人审、agent 不得自批自并）、**权限边界**（分支前缀限制、网络防火墙、沙箱）。tokenizer 已有闸门中继 + fail-closed 签名，需把"闸门事件流"做成面板一等公民。
4. **成本/token 观测与归因**：按 session/项目/模型/agent 角色多维拆分；cache token 单列（ccusage）；USD 估价；**预算上限 + 阈值告警（75%/90% 是 Claude Enterprise 的既成参数）**。这是 tokenizer 的存量优势，缺预算/告警层。
5. **会话日志与审计轨迹**：推理过程、每 commit 决策依据、工具调用/权限决策事件留存可查（Copilot session logs、Claude Code `tool_decision` 事件、Langfuse trace）。本项目 git 落盘的 progress/features 即审计源，控制台需做时间线渲染。
6. **并行 agent 隔离**：worktree/VM 每任务一隔离环境已是无争议共识（Conductor、vibe-kanban、Codex、Cursor、Devin 全部如此）。harness 已有 worktree 编排，控制台应展示"哪个 agent 在哪个 worktree"。
7. **多厂商 agent 接入**：ccusage 和 vibe-kanban 都已支持 9+ 家 CLI；单厂商锁定的第三方工具（Terragon）已死。tokenizer 的多 CLI 采集 + dispatch-mode 异厂商派活是对的赛道。
8. **中途 steering**：向运行中任务发消息/改道/暂停/终止（Copilot、Devin manager→worker 均有）。

### 差异化档（有人做但未收敛，或本项目独有杠杆）

1. **角色化独立性治理**：generator/evaluator 模型家族互斥、无自评铁则的机制化校验——**全场无对标**（Copilot 只做到"Copilot 不能自批自并"这一最弱形式）。这是 tokenizer/harness 最锐利的差异点，控制台应把"独立性合规状态"做成可视指标。
2. **成本×进度联合视图**：Devin 的 ACU-per-session + "≤10 ACU 性能退化"引导是唯一先例——**把 token 花费归因到批次/feature/阶段（planning vs building vs verifying），并给出"本批次烧了多少、哪个阶段最贵"**，是 token 工具升级为项目管理系统的天然独占接缝。
3. **模式画像/agent 性能分析**：Codex 的"agent 性能分析"、OpenAI 的 code review 质量指标（findings 按优先级、反馈情绪）刚起步；harness 的 fix_rounds、evaluator_feedback 历史是现成数据源（一次通过率、返工轮数、每 feature 成本）。
4. **环境快照与热启动**：Devin 独有（15 秒快照）；本地场景对应物是 worktree 模板 + 依赖预热。
5. **回放/teleport**：云↔本地会话接管（Claude Code teleport、Copilot 三路接管）；Langfuse 式"冻结上下文从任意节点重放"在编程 agent 场景无人做全。
6. **标准对齐**：采集 schema 对齐 OTel `gen_ai.*`；注册表对齐 A2A Agent Card / AGNTCY Directory 概念；派活对齐 MCP Tasks API——三个低成本"接口兼容"动作即可获得生态位。
7. **企业治理层**：模型级 entitlement、hooks 集中下发（Cursor）、全组织 session 过滤（Copilot Enterprise）——多人/多机场景的远期方向。

**竞品全景给出的最强告诫**：纯"用量统计"已被 ccusage（开源、覆盖多 CLI）+ 各厂商原生 dashboard（Claude/OpenAI 2026 年均已内置 spend controls）双向挤压，独立价值窗口正在关闭；而"编排管理"端 vibe-kanban 已占住开源多厂商看板生态位。tokenizer 的活路在两者的交集——**带成本归因与独立性治理的项目管理面**，即上面差异化档 1+2+3 的组合，这恰是全场空白。

---

## 4) 来源 URL 列表

**Token/成本观测**
- https://docs.litellm.ai/docs/proxy/virtual_keys · https://docs.litellm.ai/docs/proxy/users
- https://langfuse.com/docs/observability/features/sessions · https://github.com/langfuse/langfuse
- https://www.helicone.ai/blog/the-complete-guide-to-LLM-observability-platforms
- https://opentelemetry.io/blog/2026/genai-observability/ · https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
- https://github.com/ryoppippi/ccusage · https://ccusage.com/
- https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/ · https://bindplane.com/blog/claude-code-opentelemetry-per-session-cost-and-token-tracking
- https://github.com/openai/codex/issues/15281 · https://sessionwatcher.com/guides/codex-usage-dashboard · https://codexti.me/
- https://support.claude.com/en/articles/12883420-view-usage-analytics-for-team-and-enterprise-plans
- https://openai.com/index/chatgpt-enterprise-spend-controls/

**编排与管理面板**
- https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/
- https://github.com/orgs/community/discussions/177791 （Mission Control）
- https://github.blog/changelog/2026-03-13-optionally-skip-approval-for-copilot-coding-agent-actions-workflows/
- https://openai.com/index/introducing-the-codex-app/ · https://openai.com/codex/
- https://cognition.com/blog/devin-can-now-manage-devins · https://docs.devin.ai/release-notes/2025
- https://www.morphllm.com/cursor-background-agents · https://cursor.com/changelog/2-0
- https://code.claude.com/docs/en/claude-code-on-the-web · https://anthropic.com/news/claude-code-on-the-web
- https://rustman.org/wiki/conductor-parallel-agents/ （Conductor + Terragon 关停）
- https://github.com/BloopAI/vibe-kanban · https://vibekanban.com/

**协议标准**
- https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/ · https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents
- https://en.wikipedia.org/wiki/Agent2Agent · https://tyk.io/learning-center/a2a-protocol-architecture-and-technical-specification/
- https://blckalpaca.at/en/knowledge-base/ai-agents/a2a-protocol-basics/agent-cards-und-discovery （AGNTCY Directory/OASF）