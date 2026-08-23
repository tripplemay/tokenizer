# BL-HOMEPAGE-FRESHNESS Spec

- **Batch:** `BL-HOMEPAGE-FRESHNESS`
- **Type:** P1 bug-fix batch
- **Date:** 2026-08-22
- **Trigger:** 首页停留时不会稳定刷新；用户已产生大量新事件，但首页最新时间仍停在约 3 小时前。
- **Pre-plan evidence:** `docs/test-reports/HOMEPAGE-FRESHNESS-2026-08-22-verdict.json`

## 背景与根因假设

首页是服务端渲染快照，由客户端定时调用 `router.refresh()`。固定 `setInterval` 不关心上一个
RSC refresh 是否完成；当单次请求超过 30 秒时，刷新动作可能排队，最终表现为页面长期停旧，
硬刷新后才追上。

同时，本机 agent 曾积压数千事件。旧上传路径以 200 条为一批、从最旧事件开始，且整轮全部成功前
不持久化部分进度。网络或服务端慢请求会让新事件长期排在历史重复事件之后。append-only JSONL
parser 又以整文件 fingerprint 为粒度，文件增长时会重放旧前缀，持续放大队列。

本批必须同时关闭展示刷新和事件到达两条链路。只修 UI timer 不能解释服务端仍没有新事件；只修上传
也不能保证已打开页面自动获取新快照。

## 目标

1. 首页最多只有一个 refresh transition 在途，完成后再计下一次 30 秒轮询。
2. 大队列优先上传最新事件，并在每个成功批次后持久化剩余队列。
3. cursor 只在对应事件已进入 durable queue 后推进，失败时不丢事件。
4. Codex、Claude project、Kimi append-only JSONL 只发出 cursor 后新增内容，同时保留解析上下文。
5. 独立验收覆盖代码、完整回归、生产部署 SHA 和首页真实刷新行为。

## 非目标

- 不修改首页布局、视觉样式、图表口径或数据库 schema。
- 不改变服务端 `UsageEvent` 去重键与 ingest API 契约。
- 不修改 agent feature-version 常量；本批是纯 bug 修复，遵循项目硬约束。
- 不清理与本问题无关的 Windows lifecycle CI 既有失败。

## 关键设计决策

### D1. Refresh 使用 one-shot timer

用 `setTimeout` 替代固定 `setInterval`，并通过 React transition pending 状态禁止重入。
tab 隐藏时取消 timer；重新可见时立即 catch-up refresh。每次 transition 结束后才重新计时。

### D2. 上传批次固定 25 条且 newest-first

事件在发送前按 `occurredAt` 降序稳定排序，单批最多 25 条。服务端查询按时间排序，wire order
不承担展示语义；最新优先可让首页先恢复新鲜度。保留现有单批重试和 60 秒 timeout。

### D3. Queue 是 cursor 的 WAL

执行顺序固定为：collect -> write full queue -> write cursor -> upload。每个服务端确认成功的批次
通过 callback 立即把 remaining tail 写回 queue。任一步崩溃最多产生可去重重放，不得丢未确认事件。

### D4. Append-only cursor 使用 UTF-8 byte offset

fingerprint 的 size 是已解析字节数。文件增长时允许 parser 扫描旧前缀恢复 session/cumulative/group
上下文，但只 emit `endOffset > previousSize` 的记录或消息组。文件缩小时从 byte 0 重放；mtime-only、
size 不变时跳过。未终止的最后一行下一次 append 后必须可重试。

### D5. 执行车道

本批无待消费签名 mode intent（`harness.json.project.mode_defaults=null`），使用本机手工默认快车道。
Generator 在当前主上下文串行完成 F001-F004；总 feature 数为 5，verifying 阶段按框架 fan-out，
且 Evaluator 与 Generator 必须是隔离上下文。

## Features 与 Acceptance

### F001 首页 refresh 串行化

- one-shot timer 默认 30 秒，不得使用固定 interval 累积 refresh。
- pending transition 期间不得再次调用 `router.refresh()`。
- hidden 时取消 timer；visible 时立即刷新；unmount 清 timer 和 listener。
- 首页 DOM、布局和显示字段不变。
- 行为测试覆盖 pending、恢复调度、visibility 与 cleanup。

### F002 最新优先的小批量上传

- 每批最多 25 条，按 `occurredAt` 降序稳定排序，不原地修改调用方数组。
- 空事件仍 POST 一次，以保持服务端 `lastSyncAt` 语义。
- 每批保留既有重试，聚合 inserted/updated/duplicates/received 精确。
- 每个成功批次触发 callback，参数含 synced、total、remaining。
- 测试覆盖第二批失败、重试耗尽、最新优先和 callback 顺序。

### F003 Queue/cursor durable checkpoint

- agent 必须先成功写入全量 durable queue，再写 cursor，再发起上传。
- 每批确认后 queue 仅保留未发送 tail；后续批失败时不得 clear queue。
- cursor 写失败或 checkpoint callback 写失败不得造成静默数据丢失。
- 手工 `tokenizer sync` 与 daemon `runOnce` 使用同一逐批 checkpoint 语义。
- 单元测试断言调用顺序和失败终态。

### F004 Append-only JSONL byte cursor

- 新 helper 返回每行 UTF-8 byte endOffset 与完整已读 byteLength。
- Codex 增长文件使用旧前缀重建 cumulative delta，仅 emit 新 snapshot。
- Claude streamed message 若在 cursor 后继续，重新 emit 同一 canonical id 的最终组。
- Kimi 只 emit append 后的新 usage rows。
- size 不变但 mtime 改变时跳过；文件缩小从 0 重放；UTF-8 与未终止行有测试。
- OpenCode SQLite 高水位行为保持不变。

### F005 独立回归与上线验证

- 独立 Evaluator 逐条验证 F001-F004，不采用本文件的预期结果作为证据。
- `npm run verify`、`npm run lint`、`npm test`、`npm run build` 均通过。
- 生产部署 health SHA 对齐最终产品 commit，Linux Verify 与 Deploy job 成功。
- 浏览器保持首页打开至少两个轮询周期，证明不会出现并发 refresh 排队；在有新事件到达时，
  页面无需硬刷新即可更新最新时间。
- 输出固定 verdict `docs/test-reports/BL-HOMEPAGE-FRESHNESS-verdict.json`；全 PASS 时写 signoff。

## 风险与回滚

- newest-first 改变 wire 顺序，但不改变持久化时间和页面排序；回滚可恢复原 batch order。
- cursor 过早推进的风险由 queue-before-cursor 和逐批 remaining checkpoint 约束。
- append-only 假设仅用于 Codex/Claude/Kimi JSONL；检测到 shrink 时强制全量重放。
- F001 可独立回滚，不影响 agent 上传链路。

## 验收数据准备

- 使用临时 JSONL fixtures 覆盖 UTF-8、append、shrink、partial line 和 streamed continuation。
- 使用 40 条以上事件 fixture 强制跨至少两个上传批次。
- 生产浏览器验证只读；若需要主动制造生产事件或修改生产状态，必须先取得 L2 明确授权。
