# Codex 用量偏高专项审查

**审查时间：** 2026-08-06T06:25:33Z  
**代码基线：** `8959a96b75d88ce76fa8ba70eb14abe2cfe51ec5`  
**结论：** **确认存在严重重复计数 bug。** 本机最近 14 天样本按当前解析逻辑约为 51.91B tokens；按 Codex 同一 session 的累计快照去重后约为 3.07B，当前结果约膨胀 16.9 倍。Codex 0.145.0 的父子会话/续接异常是主要触发器，但 tokenizer 使用文件路径和行号标识事件、直接累加每条 `last_token_usage`，使上游重复快照永久进入数据库，是本项目需要修复的计量缺陷。

## Findings

### P0 - `last_token_usage` 被当作每行增量，无法抵御同一累计快照被重放

- `src/parsers/codex.ts:56-68` 对每条 `token_count` 直接读取 `last_token_usage` 并生成用量。
- 这个假设不成立：Codex 在仅更新 rate limit 时会重新发送旧的非零 `last_token_usage`，但 `total_token_usage` 不增长。OpenAI Codex 官方 issue 已给出相同根因和对第三方计量器的过报影响：<https://github.com/openai/codex/issues/14489>。
- 当前去重指纹包含 `timestamp`，且 `seenFingerprints` 每个文件重建一次（`src/parsers/codex.ts:31-38,71-74`）。同一累计快照只要时间戳变化，或被写入另一个 rollout 文件，就不会命中。
- 本机样本还出现同一个 session id 分布在最多 87 个 rollout 文件、token 事件被大量复制的模式。OpenAI Codex 官方 issue 记录了相同版本段的 subagent 事件高频写入、父/子/同级事件疑似复制到多个 JSONL：<https://github.com/openai/codex/issues/34061>。

### P0 - 服务端唯一约束无法补救，因为 `sourceEventId` 把物理位置当逻辑身份

- `src/parsers/codex.ts:76-89` 使用 `codex:${file}:${line}:${timestamp}`。
- `prisma/schema.prisma:216` 只对 `(deviceId, source, sourceEventId)` 唯一。
- 因此同一 `(session_id, total_token_usage)` 快照出现在不同文件、不同位置或不同时间戳时，会获得不同主键并全部插入。客户端游标只减少重复扫描，不能识别新 rollout 中的历史重放。

### P1 - 回归测试把错误假设固化成了期望

- `tests/parsers/codex.test.ts:94-105` 声称 `last_token_usage is per-turn delta`，但 fixture 把每行的 `total_token_usage` 也直接设成同一个 `lastUsage`，没有构造真实的累计序列。
- `tests/parsers/codex.test.ts:117-145` 只测了“同文件 + 同时间戳 + 同 usage”的重复；没有覆盖：累计量不增长但时间戳变化、同 session 跨文件重放、resume 后先重放旧累计再出现新尾部。

## 本机证据

以下统计只读取 `session_meta`、`turn_context` 和 `token_count` 数字字段，不读取 prompt、消息文本或工具参数。审查期间当前 Codex 会话仍在增长，因此数值是 2026-08-06T06:25Z 附近的快照。

| 指标（最近 14 天） | 当前解析器口径 | 以 `(session_id, total_token_usage 全字段)` 去重 |
|---|---:|---:|
| rollout 文件 | 184 | 184 |
| logical session | 58 | 58 |
| 事件行 | 382,385 | 23,604 |
| total tokens | 51,912,384,441 | 3,065,047,785 |
| fresh compute（input - cached + output） | 1,577,960,501 | 126,951,657 |

- 总 token 膨胀约 **16.94 倍**；fresh compute 膨胀约 **12.43 倍**。
- 0.145.0：380,773 条当前事件中，358,758 条重复累计快照；重复部分约 48.85B tokens。
- 0.146.0：1,613 条当前事件中仍发现 23 条重复累计快照，约 1.08M tokens。升级显著缓解了上游异常，但没有让 tokenizer 的现有逻辑变正确，也不会清理历史库。
- 最近样本 `cached_input_tokens / input_tokens` 约 97%。缓存读本来就会让“总 input”看起来很大，这不是 bug；但即使看已扣缓存的 fresh compute，重复计数仍超过 12 倍。
- 正在运行的 `~/.tokenizer/app/src/parsers/codex.ts` 与仓库文件 SHA-1 均为 `50126a561047834da2a55a2f8c3a576293cb8581`，排除 Agent 未升级或部署漂移。

## 修复边界

1. 解析身份应基于逻辑快照，而不是文件位置。建议 canonical id 至少包含 `sessionId` 和 `total_token_usage` 全字段的稳定 hash。
2. 只有累计快照推进时才计新增量；累计不变的 rate-limit rebroadcast 必须丢弃。对 resume/replay，按 session 维护累计 high-water，并从累计值计算正向 delta，不能盲信重复携带的 `last_token_usage`。
3. 必须覆盖游标场景：旧文件被 cursor 跳过、只扫描新 replay 文件时，canonical id 仍需让服务端命中既有逻辑事件。
4. 代码修复必须配套历史数据迁移。建议按 `deviceId + source=codex + sessionId + rawJson.payload.info.total_token_usage` 合并，保留最早 `occurredAt`，并把保留行改成 canonical `sourceEventId`；否则新旧 ID 会并存，部署后反而再插一份。
5. 新增回归用例：同文件不同时间戳但累计不变、同 session 跨文件重放、resume 新尾部、cursor 只见 replay 文件，以及历史 canonical-id 迁移冲突。

## 次要观察

Codex 0.146.0 的 rollout schema 已包含 `cache_write_input_tokens` 键，而解析器仍硬编码 `cacheWriteTokens: 0`（`src/parsers/codex.ts:62-63,86`）。本机样本该字段当前均为 0，因此不是这次偏高的原因；但注释“Codex does not expose”已经过时，后续出现非零值时会低估 cache-write 成本。

## Verdict

**FAIL：Codex 用量上报存在可复现的严重过计。** 主要问题不是展示口径，而是逻辑事件身份和增量判定错误。仅升级 Codex CLI 或继续扩大当前 timestamp 指纹都不足以修复；需要同时修 parser、稳定事件 ID、测试和历史数据库。
