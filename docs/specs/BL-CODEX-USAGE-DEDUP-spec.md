# BL-CODEX-USAGE-DEDUP - Codex 用量累计快照去重与历史纠偏

> **批次类型：** Bug 修复（高风险计量 + 数据迁移）  
> **审查依据：** `docs/test-reports/CODEX-USAGE-OVERCOUNT-AUDIT-2026-08-06.md`

## 背景与目标

Codex rollout 的 `token_count.info.last_token_usage` 并不保证每一行都是新增用量：rate-limit-only 更新会重复携带旧值，0.145.0 还出现同一 session 的累计快照被写进多个 rollout。当前 parser 仅按“文件内 + timestamp + usage”去重，`sourceEventId` 又由文件路径和行号组成，因此重复快照会永久进入 `UsageEvent`。

本批目标：以 Codex 的 `(session_id, total_token_usage)` 累计快照作为逻辑身份和增量权威，在客户端减少重复、在服务端兼容未升级 Agent，并幂等清理既有重复数据。

## 功能范围

### F001 - Canonical Codex snapshot identity + parser 累计增量

1. 新增 Node 共享 helper，规范化 Codex `total_token_usage` 六个计数：`input_tokens`、`cached_input_tokens`、`cache_write_input_tokens`、`output_tokens`、`reasoning_output_tokens`、`total_tokens`。
2. 当 `source=codex`、`sessionId` 合法且累计快照有效时，生成与物理文件/行号/时间戳无关的 v2 canonical `sourceEventId`；缺失累计快照或 session 时保持 legacy id，不猜测身份。
3. Codex parser 按稳定路径顺序扫描，并按 session 维护累计 high-water：
   - session 首个可用快照以 `last_token_usage` 作为本次增量并用累计值建立 high-water，避免把不可定位时间的历史 baseline 归到当前事件；
   - 后续事件以 `total_token_usage - high-water` 的逐字段正向 delta 为准；累计不增长、回放到旧快照或 rate-limit rebroadcast 不生成事件；
   - high-water 逐字段单调更新；`cache_write_input_tokens` 不再硬编码为 0；
   - canonical id 使用当前累计快照，不使用计算后的 delta。
4. 同次扫描跨文件共享 session high-water；cursor 只看到 replay 文件时仍依靠 canonical id 让服务端命中已有快照。

### F002 - 服务端旧 Agent 兜底 + 历史数据迁移

1. `ingestUsageEvents` 在 `toRow` 前/内对所有 Codex payload 应用同一个 canonical helper。旧 Agent 即使继续发送 file+line id，服务端也写 canonical id。
2. 新增幂等 PostgreSQL migration：
   - 仅处理 `source='codex'`、session 合法、raw JSON 含有效累计快照的行；其余行不动；
   - 按 `deviceId + canonical sourceEventId` 分组，保留最早 `occurredAt/createdAt/id` 的一行，删除其余逻辑重复；
   - 把保留行更新为 canonical id，使未来旧/新 Agent 上传均命中现有唯一约束；
   - 重跑 migration 核心 SQL不得继续删除或改写数据。
3. server ingest 测试覆盖旧 file+line id canonicalization、同 batch 重复、不同 device 隔离、无累计信息 fallback。
4. 用临时 PostgreSQL fixture 验证 migration 的去重、最早行保留、canonical id parity 和幂等性；不连接生产数据库。

### F003 - 独立验收

由非 Codex 模型的 fresh-context Evaluator 执行：

1. 逐条验证 F001/F002 acceptance，复核 destructive migration 范围与 tenant/device 隔离。
2. 使用合成 rollout 覆盖：同文件改 timestamp 不增长、同 session 跨文件 replay、resume 新尾部、首快照带 baseline、cursor 只见 replay 文件、counter regression/缺字段 fallback。
3. 对本机真实日志只读取 metadata/token 数字做脱敏复算，确认 v2 parser 不再产生 0.145.0 的数量级膨胀；不得读取或落盘 prompt、message、tool arguments/output。
4. 运行聚焦测试、`npm run test`、`npm run verify`、`npm run lint`、`npm run build`。

## 关键设计决策

1. **服务端为最终防线。** 不能把正确性依赖于用户何时重装 Agent；客户端 canonicalization 是减流和早期纠错，服务端 canonicalization 才是兼容旧版本的完整保护。
2. **累计量优先于 `last_token_usage`。** `last` 只用于当前扫描首次见到 session 时避免导入未知 baseline；有 high-water 后一律用累计差分判断新增。
3. **逻辑 ID 可由 SQL 重建。** canonical id 使用可读、定长有界的规范化计数元组，不依赖数据库扩展或不易在 migration 中复现的 hash。
4. **保留最早事件时间。** replay 会改写时间戳，迁移保留最早行，避免把历史使用错误归因到最近日期。
5. **不 bump Agent feature version。** `CLAUDE.md` 明确纯 bug 修复不调整能力版本；服务端兼容旧 Agent，客户端修复随下一次应用包安装生效。
6. **无 UI/设计稿变更。** 看板计算和布局不改，只纠正底层事件。
7. **执行车道：** 默认快车道；F001/F002 共享 helper、parser、ingest 和测试边界，串行实现。verifying 使用 Kimi A2A/fresh context，与 Codex Generator 不同 model family；不 fan-out。
8. **发布边界：** 本批只在本地实现、测试和提交，不 push、不部署、不访问生产数据库。

## 数据契约

Canonical v2 id：

```text
codex:v2:<sessionId>:<input>:<cached>:<cacheWrite>:<output>:<reasoning>:<total>
```

- `sessionId` 仅接受 Codex UUID/安全标识字符；不合法时回退原 `sourceEventId`。
- 每个计数经过 `normalizeTokenCount`，缺失/非数值/负数归零。
- 累计快照六字段全零视为无效，回退 legacy 路径。
- 数据库唯一约束继续使用 `(deviceId, source, sourceEventId)`，无需 schema 新列。

## 验收标准

- 合成的 2 文件 replay：旧逻辑会累计 5 个事件时，新 parser 只计算 3 个累计推进，合计等于最终累计量或可定位的新增长量。
- 累计不增长但 timestamp/rate-limit 改变时不生成第二条事件。
- 旧 Agent payload 经 server ingest 后使用 canonical id，跨文件 legacy id 不再绕过唯一约束。
- migration fixture 将重复 Codex 行合并为每个 device/session/cumulative snapshot 一行，保留最早时间；第二次执行无变化。
- 非 Codex、缺 session、缺累计 JSON 的历史行完全不变。
- 聚焦与全量 L1 全绿；独立 Evaluator 报告落 `docs/test-reports/`。

