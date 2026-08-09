# tokenizer → agent 编程项目管理系统：能力差距分析与功能路线图

> 依据：usage / console / cliagent / template / evolution / ecosystem / landscape 七份事实报告。所有论断标注来源报告与其中的文件路径/行号。

---

## 1. 现有能力盘点

### 1.1 用量统计域（存量优势面）

| 能力 | 状态 | 证据（usage 报告） |
|---|---|---|
| 5 家 CLI 日志采集（Claude Code/Codex/OpenCode/Aider/Kimi Code） | ✅ 成熟，带增量游标、parser 版本化重解析、流式修正 | `src/parsers/*`、`src/cli/collect.ts:17-49`、`claude.ts:236-273` |
| 幂等入库 + 事故防御（NUL 清洗、高水位去重、TOCTOU 守卫） | ✅ | `src/server/ingest.ts:136-211, 12-29`、`codex.ts:69-76` |
| 静态价目 + 自动定价管道（LiteLLM→OpenRouter→LLM fallback + admin 审核） | ✅ | `src/shared/model-pricing.ts:24-101`、`src/server/pricing/lookup.ts:38+`、`app/admin/pricing/` |
| 多维展示（overview/events/devices/projects/models）+ 时区 + i18n + 多租户 | ✅ | `app/page.tsx`、`src/server/summaries.ts`（1128 行）、`src/server/time-buckets.ts` |
| 订阅配额采集 | ⚠️ 仅 1 个 provider（Codex ChatGPT） | `src/quota/registry.ts:6` |
| 成本口径 | ⚠️ list-price 估算，非真实账单 | usage 报告短板 7 |

### 1.2 控制台域（v1.3 起的新身份）

| 能力 | 状态 | 证据（console 报告） |
|---|---|---|
| 多项目进度镜像（9 个消费者项目自动发现上报） | ✅ 阶段快照级 | `prisma/schema.prisma:306-346`、`app/harness/page.tsx`、ecosystem 报告 §1 |
| 人闸门中继（Ed25519 签名、fail-closed、生产往返实测） | ✅ | `app/api/harness/gates/route.ts:98`、`src/cli/harness.ts:526-605`、console-mode.md:368 |
| 签名 mode intent（v2 tool-binding，supersede/expire/ACK 状态机） | ✅ | `app/api/harness/mode-intents/route.ts`、`src/cli/harness-mode-intents.ts:311-454` |
| 模式画像六维快照 + 独立性 familyExclusive 复算 | ✅ | `src/cli/harness-modes.ts:367-419, 231-243` |
| 框架 drift badge + sync health | ✅ | `harness-modes.ts:101-154`、`src/shared/harness-health.ts` |
| dispatch run 镜像 | ⚠️ 只读事后镜像，非派活通道 | console 报告 §4.1 |
| 实时日志（P3）/ 跨机调度（P4） | ❌ 设计已定未实装 | `framework/harness/console-mode.md:335-348` |
| 多操作员/权限分级 | ❌ 单 session 用户模型 | console-mode.md:347-348 |

### 1.3 本机 agent 域（唯一运输层）

| 能力 | 状态 | 证据（cliagent 报告） |
|---|---|---|
| 四平台常驻服务（launchd/systemd/crontab/Task Scheduler）+ 单实例锁 + 睡眠感知 tick | ✅ | `src/cli/service.ts:91-169`、`agent-lock.ts:59-122`、`agent.ts:181-238` |
| 采集+quota+harness 三合一循环，harness 独立 60s 节拍 | ✅ | `agent.ts:84-97, 189-225` |
| 闸门/intent 全程验签 fail-closed，与服务端共用 canonicalJson | ✅ | `harness.ts:494-515` |
| 版本双轨 + 服务端单调接受防旧 daemon 回写 | ✅ | `agent-feature-version.ts:50-51`、`heartbeat/route.ts:32-52` |
| 通信模型 | ⚠️ 纯轮询无推送；cron fallback 下闸门延迟 = 15 分钟 | `service.ts:156-169`、`agent.ts:94-98` |
| 升级/卸载/凭据 | ⚠️ curl\|bash 追 main HEAD 无签名；无完整卸载；静态 token 明文落盘 | `install.sh:233`、`service.ts:171-194`、`config.ts:115-123` |

---

## 2. 差距分析（对照 landscape §3 功能全景）

### 2.1 必备档（业界 ≥3 家收敛）

| # | landscape 能力 | 现状 | 缺口 | 优先级 |
|---|---|---|---|---|
| 1 | 统一任务/会话面板（Copilot Mission Control / Cursor Agents Window / vibe-kanban 收敛） | 有多项目**阶段快照**（20 分钟新鲜度窗口，`device-status.ts:51-62`） | 无「活跃会话实时态」：正在跑哪个 feature、哪个 subagent、卡在哪 | **P0** |
| 2 | 任务状态机可视化 + 历史流转（A2A 生命周期标准化） | 七阶段轨迹条只显当前态（`page.tsx:228-242`）；Activity tab 仅 gates/intents/dispatch 各 take 50 | 无状态流转历史时间线（何时 planning→building、每阶段耗时）；服务端不存流转事件 | **P0** |
| 3 | 人审批闸门多层 + 闸门事件流一等公民 | 闸门中继完整且签名 fail-closed，但入口埋在 `/harness/[id]` 详情页 | 无跨项目全局「待批收件箱」；无移动/通知触达；evidence 只显路径字符串（console 报告 §4.5） | **P0** |
| 4 | 成本观测 + **预算上限/阈值告警**（Claude Enterprise 75%/90% 既成参数） | 观测维度齐全（source/model/device/project/day） | 零预算层：无 spend cap、无告警、无 quota 逼近提醒 | **P0** |
| 5 | 会话日志与审计轨迹（Copilot session logs、`tool_decision` 事件） | git 落盘的 progress/features 是审计源，但控制台只渲染最新快照 | P3 实时日志上报未实装（console-mode.md:335-348）；无 commit 决策依据展示 | **P1** |
| 6 | 并行 agent 隔离可视化（哪个 agent 在哪个 worktree） | dispatch run 镜像入库但 `artifactPath/artifactSha256` 存而不显（schema.prisma:443-444 vs `harness-detail.ts:81-104`） | worktree/沙箱视图缺失；dispatch 产物不可下钻 | **P1** |
| 7 | 多厂商接入（ccusage 已覆盖 9+ 家；单厂商锁定已死） | 用量 5 家、dispatch 适配 3 家（claude/codex/kimi） | 用量侧缺 Gemini CLI/Amp/Droid 等；quota 仅 1 provider（`registry.ts:6`），Claude/Kimi 订阅配额空白 | **P1** |
| 8 | 中途 steering（暂停/改道/终止，Copilot、Devin 均有） | 完全没有；P4 跨机调度未实装；HarnessDispatchRun「不是派活通道」（console 报告 §4.1） | 控制台→机器方向只有 gate decision 与 mode intent 两种签名下行，无任务级指令 | **P1**（分步走，见路线图） |

### 2.2 差异化档（全场空白或本项目独有杠杆）

| # | landscape 能力 | 现状 | 缺口 | 优先级 |
|---|---|---|---|---|
| 9 | **成本×进度联合视图**（批次/feature/阶段归因——landscape 判定的「天然独占接缝」） | 两域数据已在同库同租户，`HarnessProject.projectId → Project` 外键已存在（schema.prisma:313,338），repoKey 同口径 | UsageEvent 无 batch/feature/phase 维度；无「本批次烧了多少、fixing 轮花了多少」任何视图 | **P2**（差异化，但战略权重最高，进近期） |
| 10 | 独立性治理可视指标（全场无对标） | 已领先：familyExclusive 复算 + 五项 health facts（`views.tsx:344-351`） | 只差呈现层：无跨项目「独立性合规总览」与历史违规记录 | **P2**（低成本补齐） |
| 11 | agent 性能分析（一次通过率、返工轮数、每 feature 成本） | fix_rounds、evaluator_feedback、signoff 报告全是现成落盘数据 | 零聚合分析；HarnessProject 只存当前批次，历史批次不入库 | **P2** |
| 12 | 标准对齐（OTel `gen_ai.*` / A2A Agent Card / MCP Tasks） | 无；采集 schema 自有格式 | 三个低成本接口兼容动作未做 | **P2** |
| 13 | 回放/teleport、环境快照热启动 | 无 | Devin/Claude Code 独有能力，本地对应物（worktree 模板+依赖预热）未探索 | **P2**（远期） |
| 14 | 企业治理层（多操作员、hooks 集中下发、组织级过滤） | 单用户 session；多租户模型已有（User 隔离） | 审批分级、操作员角色、TLS 终结（console-mode.md:347-348） | **P2**（远期） |

**战略判断（landscape 告诫的落点）**：纯用量统计被 ccusage + 厂商原生 dashboard 双向挤压，纯编排看板被 vibe-kanban 占位；#9+#10+#11 的组合（成本归因 × 独立性治理 × 性能分析）是全场空白且 tokenizer 数据已齐备——路线图把这三项与 P0 并列进近期。

---

## 3. 优化项 vs 新增项

### 3.1 需要「优化」的既有功能

**A. 体验**

| 项 | 问题 | 切入点 |
|---|---|---|
| dashboardUrl 存而不显 | 入库/查询都有，UI 零渲染（`grep dashboardUrl app/` 零命中，console 报告 §4.3） | 在 `app/harness/[id]/page.tsx` overview tab 加一个外链按钮，数据已在 `harness-detail.ts:17` |
| dispatch 产物不可见 | `artifactPath/Sha256` 不入 detail 查询 | `src/server/harness-detail.ts:81-104` select 补两列，`views.tsx:617-654` 表格加列 |
| /events 无分页 | 固定 `take: 200`（usage 报告短板 6） | `app/events/page.tsx` 改 cursor 分页（`occurredAt+id` 复合游标），UsageEvent 已有索引 |
| 闸门审批触达弱 | 批准入口埋在详情页，靠人主动刷 | 先做 `/harness` 顶部全局 pending gate 聚合条（查 `HarnessGate` where decisionAt null），再接通知（见新增） |

**B. 健壮性**

| 项 | 问题 | 切入点 |
|---|---|---|
| cron fallback 闸门延迟 15 分钟 | `service.ts:156-169` 只跑 `tokenizer run` | crontab 行拆双条目：run 保持 syncMinutes、`tokenizer harness` 单独每 1-2 分钟 |
| 轮询无退避/抖动 | 固定 60s，不可重试 issue 每 tick 重撞（cliagent 短板 5） | `src/cli/harness.ts:87-119` 的 retryable 分类已有，在 `agent.ts:189-225` 节拍器上加错误驱动退避 |
| Aider/Kimi sourceEventId 脆弱 | 含文件行号，历史改写会漂移（`aider.ts:121`、`kimicode.ts:100`） | 仿 codex 的服务端 canonical 化（`ingest.ts:216-220`）加内容指纹兜底 |
| enroll 不走自愈 fetch | 首装代理环境失败（`enroll.ts:34`） | 换用 `src/cli/fetch.ts` 的 agentFetch |
| 升级链路无签名/无锁版 | `install.sh:233` checkout main HEAD | 改为 checkout `agent-releases.json` 末项对应 tag + sha 校验；发布账本已存在（`agent-release-version.ts`） |
| 无完整卸载 | `service.ts:171-194` 不清数据/软链/checkout | `uninstall-service` 加 `--purge` 分支 |
| summaries.ts 无集成测试 | 1128 行核心聚合层仅 2 个纯函数测试（usage 报告短板 1） | 用 vitest + 测试库容器为 `getSummary/getModelDetail/getProjectDetail` 补 DB 集成测试 |
| 非 git 项目跨设备重复 Project | `ingest.ts:94-97` 已知限制 | 引入用户可编辑的 Project 合并/别名操作（admin 页），不动采集端 |

**C. 架构债**

| 项 | 问题 | 切入点 |
|---|---|---|
| Device 表 harness 列混居 | `schema.prisma:121-123` 三列长在用量域表上，是两域最强耦合（usage 报告 §4） | 拆 `HarnessDeviceSync` 表（deviceId 唯一键），heartbeat 路由 `heartbeat/route.ts:161-164` 改写目标；`DeviceDiagnostics.harness` 类型（`usage.ts:54`）同步下沉 |
| 双仓协同 8 项摩擦（evolution 报告 §5） | 同 bug 三处修、消费仓测试税、learnings 手工回流、仓内双份镜像 | 先做决策批次：评估「合并 framework 源入 tokenizer」的 ecosystem 报告 §4 五个断裂点（sync --ref 断裂、bootstrap 改写、tag 混流、部署触发面、镜像语义翻转），产出 ADR 落 `docs/adr/` |
| 版本耦合测试税 | `framework-version.ts` 构建期 import 镜像 manifest，升版必改 10 测试（evolution §5.3） | 测试改为从 fixture 注入版本数组而非 import 真镜像 |
| 代理端口变更需重装 | `fetch.ts:16-20` 自认 | plist/unit 不烤 env，运行时读 `~/.tokenizer/config.json` 的 proxy 段 |

### 3.2 需要「新增」的功能

| 项 | 优先级 | 切入点 |
|---|---|---|
| **预算与告警**（per user/project/model 月度 cap + 75%/90% 阈值） | P0 | 新表 `Budget`（仿 QuotaSnapshot 的租户模型），聚合复用 `summaries.ts` 的 `getDailyCost`；告警先做 UI banner + 心跳响应下行标记 |
| **成本×批次/feature/阶段归因** | P2（战略核心） | 第一步不动采集端：用 `HarnessProject`（repoKey→projectId 外键已通）+ 状态流转时间戳表，把 UsageEvent 按 `occurredAt` 落进阶段区间做时间窗 join；第二步在 agent report 里带 batch id 让归因精确化 |
| **状态流转事件表**（历史时间线的数据基础） | P0 | 新表 `HarnessTransition`，在 `app/api/harness/report/route.ts` upsert HarnessProject 时 diff 新旧 status 追加一行——纯服务端改动，agent 零改 |
| **全局闸门收件箱 + 通知** | P0 | 新页 `/harness/inbox` 聚合本人所有未消费 gate（复用 `gates/route.ts` GET 逻辑）；通知先 email 后 webhook |
| **evidence 内容查看** | P1 | 通道 A `console/server.py` 已有先例（template 报告 §4）；通道 B 对应物 = agent report 时按 gate.evidence 路径白名单上传有界文件内容（≤50 条已限，`report/route.ts:341-378`），新列存 `HarnessGateEvidence` |
| **实时会话态/日志上报（P3 兑现）** | P1 | 按 console-mode.md:335-348 既定设计：agent 侧新增有界日志 tail 上报（复用 60s 节拍与 bounded JSON 防御模式 `harness-mode-intents.ts:118-133`），服务端环形缓冲表 + detail 页 live tab |
| **agent 性能分析页** | P2 | 历史批次入库（HarnessProject 每批次归档而非覆盖）后，聚合 fix_rounds/一次通过率/每 feature 成本；数据源 evolution 报告证实齐备（signoff 报告、fix_rounds 均落盘） |
| **quota provider 扩展**（Claude、Kimi 订阅窗口） | P1 | `src/quota/registry.ts` 的 provider 框架已就位，仿 `codex-chatgpt.ts:38-83` 各写一个 provider |
| **steering v1（暂停/取消/留言）** | P1 | 复用签名下行既有骨架：仿 mode intent 的 `issued→relayed→staged→applied` 状态机（`mode-intents/relay/route.ts`）新增 `task-directives` 通道，本机落盘为 progress.json 的机读槽位（对齐 pending_gate 契约模式） |
| **OTel `gen_ai.*` 对齐导出** | P2 | 新增只读导出端点或 collector sidecar，把 UsageEvent 映射到 `gen_ai.usage.input_tokens/output_tokens/provider.name`（landscape §2）；schema 不动，做映射层 |
| **看板式任务视图**（vibe-kanban 形态对标） | P2 | backlog.json 已有结构化条目（evolution §3）；agent report 载荷加 backlog 摘要，控制台渲染 backlog→features→done 三列 |
| **A2A Agent Card 对齐** | P2 | `.agents-registry.json` 的 tool-integrations descriptor（template 报告 §1）与 Agent Card 概念直接对应（landscape §2），做一层导出映射即可占生态位 |
| **多操作员/审批分级** | P2 | 现有 `by/at` 记名（`gates/route.ts:87-89`）扩展为角色表；decision scope 的 `expires_at` 类型已支持未启用（`harness-sign.ts:22`），可一并做限期授权 |

---

## 4. 三阶段路线图

### 近期（1-2 个批次周期）：把「控制台」变成「每天要开的面板」

| 批次建议 | 内容 | 依据 |
|---|---|---|
| BL-GATE-INBOX | 全局闸门收件箱 + evidence 内容查看 + dashboardUrl/artifactPath 补显 | P0 缺口 3 + 三个存而不显（console 报告 §4.3-4.5），全是薄改动 |
| BL-TRANSITION-LOG | 状态流转事件表 + 详情页阶段时间线 | P0 缺口 2，纯服务端，是成本归因的前置数据 |
| BL-COST-BATCH-V1 | 成本×批次/阶段归因 v1（时间窗 join 版）+ 批次成本卡片 | 战略核心 #9，外键与时间戳当下已够用 |
| BL-BUDGET | 预算表 + 75%/90% 告警 banner | P0 缺口 4，Claude Enterprise 既成参数直接抄 |
| BL-AGENT-LATENCY | cron fallback 拆双 crontab 条目 + 轮询退避 + enroll 走 agentFetch | cliagent 短板 1/4/5，闸门体感直接受益 |
| 顺带 | /events 分页、独立性总览徽章上列表页 | 低成本体验补齐 |

### 中期（3-6 个批次周期）：从「镜像」到「双向管理面」

| 批次建议 | 内容 | 依据 |
|---|---|---|
| BL-LIVE-SESSION | P3 实时日志/会话态上报兑现（有界 tail + live tab） | P0 缺口 1、console-mode.md:335 既定设计 |
| BL-STEERING-V1 | 签名任务指令通道（pause/cancel/note），复用 mode intent 状态机骨架 | 必备档 8，签名下行基建已被 mode intent 验证两轮 |
| BL-PERF-ANALYTICS | 批次历史归档 + agent 性能分析页（一次通过率/返工轮数/每 feature 成本） | 差异化 #11，与 BL-COST-BATCH 合流成「成本×质量」页 |
| BL-QUOTA-PROVIDERS | Claude/Kimi 订阅配额 provider | P1 缺口 7 |
| BL-DEVICE-DECOUPLE | Device 表 harness 列拆表 + DeviceDiagnostics 类型下沉 | 架构债最强耦合点，在功能加码前拆，越晚越贵 |
| BL-REPO-ADR | 双仓合并/不合并 ADR + 消费仓过渡路径设计 | ecosystem §4 五断裂点必须先裁决，阻塞框架分发形态 |
| BL-AGENT-SUPPLY-CHAIN | 安装锁 tag + sha 校验 + `--purge` 卸载 + 凭据轮换 | cliagent 短板 2/3/4 |

### 远期（6+ 批次周期）：生态位与企业面

| 方向 | 内容 | 依据 |
|---|---|---|
| P4 跨机调度 | dispatch 从事后镜像升级为控制台发起的派活通道（对齐 MCP Tasks API / A2A 生命周期） | console-mode.md:335-348 P4、landscape §2；steering v1 的通道直接演进 |
| 标准对齐三件套 | OTel `gen_ai.*` 导出、A2A Agent Card 映射、AGNTCY Directory 概念对齐 | 差异化 #12，低成本换生态位 |
| 看板编排面 | backlog→features 看板视图，拖卡触发 mode intent/派活 | vibe-kanban 对标，依赖 steering 与 P4 |
| 企业治理层 | 多操作员、审批分级、限期授权（expires_at 启用）、hooks 集中下发 | 差异化 #14，多人/多机场景成立后再做 |
| 回放/快照 | worktree 模板热启动、批次级回放 | 差异化 #13，探索性 |

**路线图总原则**：近期全部落在「服务端 + UI 薄改动」（agent 协议不动或最小动），因为 9 台消费者项目 8 个依赖同一 agent 运输层且升级链路弱（ecosystem §1、cliagent 短板 2）；中期先还 Device 解耦与双仓 ADR 两笔债再上双向通道；远期的派活/看板全部踩在 mode intent 已验证的「签名下行 + fail-closed 验签」骨架上，不另起炉灶。