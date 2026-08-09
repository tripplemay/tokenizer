# BL-DISPATCH-USAGE-CAPTURE — 派发用量捕获：沙箱隔离与用量采集冲突的根治

> 状态：planning 定稿 · 2026-08-10 · Planner=主会话（快车道默认映射，无 active mode intent）
> 来源：用户 2026-08-09 发现——dispatch 模式下 Codex/Kimi 的用量在控制台事件页缺失；诊断确证
> Codex 用量因沙箱 deny-default 写限制（只允许 worktree+runtime root）无法落盘任何可采集路径，
> **唯一存留处是 dispatch run 日志**（如 `turn.completed: input 2,150,425 / output 19,667`）；
> Kimi 经 KIMI_CODE_HOME 落真实 HOME 已被正常采集（cursor.json 实证），仅被 /events 无分页淹没。
> 用户裁决：直接排进下一批次。

## 1. 目标

把派发用量变成一等公民：dispatch 机制从运行日志**机械提取** usage 摘要写入 run-meta（框架契约），
经既有 `report.dispatchRuns` 通道上行，服务端落 `HarnessDispatchRun` 用量列并**幂等物化**为
UsageEvent（source=codex 等无法自采集的 CLI），自带 **batch/feature/role** 维度——这同时是
「成本×批次归因」的精确数据源（先于时间窗 join 的 v2 路径）。

## 2. 关键设计（Planner 裁决）

| # | 决策 | 依据 |
|---|---|---|
| 1 | **提取按 adapter 声明**：每个 adapter 声明 `usage_capture: "materialize" \| "attribution_only"` 与提取规则。codex=materialize（沙箱致日志唯一）；kimi=attribution_only（wire 已被 kimicode 采集器正常收集，物化会**双重计费**——本批只把 usage 摘要记进 HarnessDispatchRun 供归因，不再造 UsageEvent） | 本机实证：kimi cursor 已收 bl-repo-mech wire ×2；codex 三次派发零日志落盘 |
| 2 | **传输走既有通道**：run-meta 新增可选 `usage` 块 → agent 扫描带进 `report.dispatchRuns[]`（additive-optional）→ 服务端白名单扩收。**服务端先部署、agent 后重装**的结构顺序保证兼容；AGENT_FEATURE_VERSION 不 bump（旧 agent 只是不带 usage，无正确性问题）；agent release 按账本末项顺延（当前 1.2.1 → 1.3.0） | PERF-ANALYTICS F005 同款 additive-optional 先例；exactRecord 白名单拒未知字段故顺序敏感 |
| 3 | **幂等物化**：UsageEvent 走既有 `@@unique([deviceId, source, sourceEventId])`，`sourceEventId = "dispatch:" + taskId`；`rawJson` 携带 `{batch, feature, role, taskId, agentId}` 归因元数据；`occurredAt` = run finishedAt（UTC）。model 取证顺序：运行日志显式 model 行 → adapter argv 声明 → null（如实 unpriced） | UsageEvent 表零结构改动；重复上报天然去重 |
| 4 | **历史回填**：提取工具可独立运行（`<run-log> --into <run-meta>`），对本机既存 BL-REPO-MECH 的 5 次 run（build×3 + verify×2——verify 为 kimi 归因-only）补写 usage 进 run-meta → agent 下轮扫描自动上行 → 服务端幂等物化，无需直写数据库 | run 日志与 run-meta 均在本机留存 |
| 5 | 跨仓框架 feature（F001）由主会话按既定先例执行（用户 REPO-MECH 书面授权确立的形态 + proposed-learnings 已登记机制缺口）：spec-lock critic 稽核上游 diff + verifying 阶段隔离 evaluator 跨仓锁 SHA 验收 | 先例 ×2；信封 repo.url 无法跨仓 |

## 3. Features（普通批次，全部 executor:generator）

### F001 · 框架侧：run-meta usage 契约 + 提取机件（harness-template，发 v1.9.0）
- `templates/claude/dispatch/extract-run-usage.py`（新）：按 adapter 声明的提取规则扫运行日志——
  codex：`turn.completed` 的 usage 各字段跨 turn 求和 + model 探测；kimi：`usage.record`（usageScope=turn）求和。
  可独立运行（`--log <file> --adapter <name> [--into <run-meta>]`），输出 bounded usage 块
  `{model?, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens, turns, extracted_from: "run-log"}`（全部非负整数上界校验）。
- `dispatch-run.sh`：RETURNED 收尾时自动调用提取器把 usage 写入 run-meta（提取失败不阻塞派发，usage 缺省 null——采集是旁路不是闸门）。
- adapters：codex.json 增 `usage_capture: "materialize"` + 提取规则声明；kimi.json 增 `"attribution_only"`；
  registry/adapter 校验白名单同步。
- run-meta 消费面白名单（validate-dispatch.sh 等）放行可选 usage 块；回归测试（正/负）；发布三件套 v1.9.0 + tag（push/tag 人类执行）。
- acceptance：①提取器对本机真实 BL-REPO-MECH run 日志实跑，codex 三次的求和结果与日志逐条手算一致（±0）；②kimi 日志提取出 usage 且 adapter 声明 attribution_only；③usage 缺失/日志损坏 → run-meta usage=null 且派发流程零影响（负向测试）；④release-contract + 既有 dispatch 测试全绿。

### F002 · agent 侧：dispatch 扫描携带 usage 上行
- `src/cli/harness-dispatch.ts`：run-meta 的可选 usage 块经 bounded 校验进 dispatch run 摘要（敌意输入防御沿既有模式：字段白名单、非负整数、上界）；`src/shared` 类型同步。
- `src/shared/agent-releases.json` 追加 1.3.0（highlights 双语）；AGENT_FEATURE_VERSION 不动（决策 2）。
- acceptance：①带 usage 的 run-meta 被完整携带、超界/负数/未知字段被剔除或整块置 null（测试覆盖）；②不带 usage 的历史 run-meta 行为与现状逐字节一致（回归）；③`npm run test` 全量绿。

### F003 · 服务端：入库 + 幂等物化 + Activity 展示
- `prisma/schema.prisma`：HarnessDispatchRun 增可选列 `usageModel/usageInputTokens/usageCachedInputTokens/usageCacheWriteTokens/usageOutputTokens/usageReasoningTokens/usageTurns/usageCapture`（纯 additive migration）。
- `app/api/harness/report/route.ts`：dispatchRuns 解析白名单扩收可选 usage（bounded）；upsert 入列；
  `usage_capture=materialize` 且 usage 非空时在同一事务**幂等物化** UsageEvent（决策 3；kimi=attribution_only 不物化）。
- Activity tab dispatch 表格加 tokens 列（input/output 紧凑显示，title 出全量）。
- acceptance：①同一 run 重复上报只产生一行 UsageEvent（幂等测试）；②attribution_only 不产生 UsageEvent（防 kimi 双重计费的负向测试）；③无 usage 的旧载荷回归零变化；④物化事件的 rawJson 含 batch/feature/role/taskId，source 合法、occurredAt=finishedAt UTC；⑤migration 纯 additive，`npm run verify/test` 全绿。

### F004 · 历史回填与端到端实证
- 用 F001 提取器对本机 `.harness-dispatch/run-*.log` 既存 BL-REPO-MECH 5 次 run 补写 usage 进对应 run-meta；
  触发 agent 一轮 harness 上报（或等 60s 节拍）；实证服务端 UsageEvent 出现 codex 三次派发的用量
  （合计应与日志手算一致），kimi 两次仅 HarnessDispatchRun 归因列有值。
- acceptance：①/events（或 DB 查询等价物）可见 3 条 source=codex 的 dispatch 用量事件，token 数与日志一致；
  ②kimi 零新增 UsageEvent（双重计费防线实证）；③二次触发上报零重复（幂等实证）；④过程与结果落
  `docs/test-reports/BL-DISPATCH-USAGE-CAPTURE-backfill-2026-08-10.md`。

## 4. 编排与边界

- 快车道默认映射：F001（框架仓，主会话按决策 5）→ F002/F003（tokenizer，主上下文 Generator，先 F003 服务端后 F002 agent 侧以守部署顺序）→ F004 收尾实证；隔离 subagent evaluator 验收（verifying）。
- **部署顺序硬约束**：F003 先随 push 部署，本机 agent 重装（1.3.0）在其后——F004 依赖两者就位。
- Out：/events 分页与 source 筛选（BL-AGENT-LATENCY）· UsageEvent 加 batch 列（COST v2 另议，本批用 rawJson）·
  Claude/其他 CLI 的 dispatch 提取（本批只做 codex/kimi 两个在用 adapter）· 成本页联动（BL-COST-BATCH-V1）。
- 风险：①提取规则与 CLI 输出格式耦合——规则进 adapter 声明而非硬编码，CLI 升级破坏时 usage=null 旁路降级；
  ②kimi 双重计费——attribution_only 白名单 + F003 负向测试 + F004 实证三道防线；③本机 agent 旧版——F004 前必须重装（顺带清掉 DEDUP 遗留）。

## 5. fix_round=1 裁决注记（2026-08-10）

- F004 复验证伪交付报告一处陈述（本机 codex adapter 定制自 e59c822 起已钉 `-c model=gpt-5.6-sol`）。
  决策 3 的「adapter argv 声明」兜底档在 F001 实现中未落地（提取器只读日志）——**裁决：顺延至
  BL-DISPATCH-MODEL-PIN**（连同已物化 create-only 事件的 model 一次性补写；两件事同域，一并处理更完整）。
  本批 model=null 语义如实（unpriced），主链路（数值/幂等/防双重计费）复验无返工。
- 注册表迁移时间修正：tool-integrations/1 迁移为 5bd8c52（2026-07-31），非 08-05。
