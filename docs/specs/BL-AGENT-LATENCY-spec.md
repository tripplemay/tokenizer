# BL-AGENT-LATENCY 规格 —— agent 时延与健壮性（+2 顺路项）

- **批次目标：** 「人批准闸门 → 机器拿到决策」最坏延迟 15min（cron fallback）→ ≤2min；daemon 轮询固定 60s → 错误驱动退避+抖动；enroll 走自愈 fetch；/events 补 cursor 分页。顺路：notify fetch 超时兜底（上批 soft-watch）+ dispatch 用量 model 归因补全（用户观察「模型显示为未知」闭环）。
- **详细预案：** `docs/analysis/2026-08-08-repo-strategy/batch-plans/BL-AGENT-LATENCY.md`（F001–F005 的设计要点、风险对策、规模估计以预案为准；本文件补充 F006/F007 与裁决记录）
- **执行形态：** 快车道默认映射（无签名 intent；resolver `{}`，Coordinator=Planner+Generator，隔离 evaluator subagent 验收）
- **硬约束：** 零协议变更 · 无 migration · `AGENT_FEATURE_VERSION` 保持 9/9 · push main = 部署生产（本批 src/cli/app 均不在豁免清单）· 每 commit 独立可运行后向兼容 · F005 押后为最终功能 commit

## Features 与 acceptance

### F001 · cron fallback 拆双 crontab 条目 · executor: generator
按预案 §F001。crontab 生成提炼纯函数 `buildCronContent`；双条目（`run` 保持 `*/${syncMinutes}`，`harness --json` 每 2 分钟 stdout 丢弃）；旧行过滤锚定 binPath。
acceptance：预案 4 条（`tests/cli/service-cron.test.ts` 四输入形态全绿 / harness 条目 `*/2` / 卸载清零 / 幂等）。

### F002 · harness 轮询错误驱动退避 + 抖动 · executor: generator
按预案 §F002。新纯函数 `src/cli/harness-backoff.ts`：清洁轮复位 60s；有 issue → `min(60s × 2^n, 600s)` × [0.85,1.15] 抖动（random 注入）；non-retryable 同样退避；cron 模式不引入退避；`harnessInFlight` 单飞不动。
acceptance：预案 4 条（退避序列 120/240/480/600 精确断言 / non-retryable 退避 / agent-lifecycle 回归绿 / verify 绿）。

### F003 · enroll 切换 agentFetch · executor: generator
按预案 §F003。`src/cli/enroll.ts` 全局 `fetch` → `agentFetch`。
acceptance：预案 3 条（grep 零裸 fetch / `tests/cli/enroll.test.ts` mock 断言 POST 与失败不写 credentials / `src/cli/` 全域 `await fetch(` 零命中）。

### F004 · /events cursor 分页 · executor: generator
按预案 §F004。游标 `${occurredAt ISO}_${id}`；`take: 201` 探测；非法 cursor 静默回退首页不 500；走既有 `@@index([userId, occurredAt])`；「更旧 / 回到最新」服务端 Link；i18n `events.pagination.*` en/zh 齐备。
acceptance：预案 4 条（编解码/tiebreak 单测 / >200 条实测无重叠 / 垃圾 cursor 200 / lint+verify+键集一致）。

### F005 · agent release 1.4.0 账本 + rollout · executor: generator（最终功能 commit）
按预案 §F005，版本号修正为 **1.4.0**——预案写「1.3.0」时早于 BL-DISPATCH-USAGE-CAPTURE，该批已用掉 1.3.0（机械依据：`git log -1 -- src/shared/agent-releases.json` = 7dc821d「release 1.3.0」；账本 entries 含 1.3.0）。highlights zh/en 各 ≥2 条（双条目 cron、退避、enroll 自愈、model 归因重扫）；`AGENT_FEATURE_VERSION` 9/9 不动。
acceptance：预案 4 条按 1.4.0 读（LATEST=1.4.0 且 1.3.0/1.2.1 均 behind / 9/9 grep / highlights / 全量绿含硬编码旧版本用例）。

### F006 · 闸门邮件 notify fetch 超时兜底 · executor: generator（顺路，源 BL-NOTIFY-FETCH-TIMEOUT）
`src/server/harness-gate-notify.ts` 的 Resend fetch 加 `signal: AbortSignal.timeout(8_000)`。超时走既有 catch → 复位 claim 重试，fail-open 语义不变。
acceptance：
1. `tests/server/harness-gate-notify.test.ts` 补断言：fetch init 含 signal（AbortSignal 实例）；超时抛错路径复用「发送失败复位」用例语义仍绿
2. 既有 7 + 探针 4 用例零改动全绿（探针 mock fetch 不受 signal 影响）
3. `npm run verify` 绿

### F007 · dispatch 用量 model 归因补全 · executor: generator（顺路，源 BL-DISPATCH-MODEL-PIN）
上批裁决记录（spec §5 adjudication）：adapter argv **已**钉 `-c model=gpt-5.6-sol`（e59c822 起）；unpriced 真因是提取器缺 argv 兜底档。两段：
1. **框架侧：** `extract-run-usage.py` 增 argv 兜底档——事件流缺 model 时从派发 argv 提取 `-c model=<x>`（codex 形态；kimi 不适用保持 null）；框架测试覆盖；发 **v1.10.0**（feature 版）并同步本仓。
2. **服务端侧：** dispatch 用量物化 upsert 的 `update` 从 `{}` 放宽为 **model-only 刷新**：仅当库中事件 `model` 为空/unknown 且报文带非空 model 时写入；其余字段仍不可变（幂等语义保持）。agent 重扫历史 run 日志后自然补写既有 4 条 unknown 事件，无需手工碰生产库。
acceptance：
1. 框架仓提取器测试含 argv 兜底档用例（有 `-c model=` 提取 / 无则 null / 事件流有 model 时优先事件流）；框架全套测试绿；v1.10.0 tag + 账本 + 本仓 sync 后 `npm run test` 全量绿（版本断言 manifest 派生自适应）
2. `tests/server/harness-dispatch-usage.test.ts` 补用例：unknown→model 刷新恰发生一次；已有非 unknown model 不被覆盖；无 model 报文不触碰（断言 update 分支构造）
3. 生产部署 + 本机 agent 重装/重扫后，`/events` 既有 4 条 codex 事件 model 显示 `gpt-5.6-sol`（用户目视确认，闭环上批观察）
4. `npm run verify` + lint 绿

## 关键决策记录

- **F007 采用「重扫自然补写”而非手工 DB 脚本**：复用既有 agent→report→upsert 通道，免生产库直接操作；代价是需要本机 agent 重装后一轮 harness sync 才能看到闭环（验收第 3 条含此步）。
- **F006 超时取 8s**：evaluator 建议区间 5–10s 的中值；Resend 正常响应 <1s，8s 只拦挂起。
- **框架 v1.10.0 为 feature 版**（提取器新能力），与 v1.9.1（本批 planning 期已发的消费台账 patch）互不混淆。
- **push 节奏**：building 期允许分段 push（每段求授权）；F005 必须在含 F001–F004+F006–F007 的代码全部上 main 之后。

## 测试计划

预案 §测试计划 5 行不变；追加：`harness-gate-notify.test.ts`（改，signal 断言）、`harness-dispatch-usage.test.ts`（改，model 刷新 3 用例）、框架仓提取器测试（上游）。
