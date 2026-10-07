# B09 可变成本缓存修复候选（Generator handoff，非最终验收）

- 基线：`2074991717abaf3cb34d9aad894bcd4357fefbc3`；实现提交 `1925f7d` 留在 detached worktree，未合并、推送或部署。
- 范围：R05 的 closed batch 永久缓存、首页/项目/设备/模型汇总的租户定向失效，以及入库、修正、Harness dispatch materialization、legacy cleanup 的缓存失效。未声称覆盖 B09 全部前置依赖 B06/B08。

## 实现

- `src/server/harness-cost.ts`：closed batch 仍使用固定时间窗 key，但不再 `revalidate:false`；改为 30 秒 TTL，价格 tag + 租户 usage tag。
- `src/server/summaries.ts`：所有 8 个缓存汇总函数共享上述租户 usage tag、价格 tag 与 30 秒 TTL；cache key 同时包含租户和原有 range/filter/timezone 参数。
- `src/server/usage-cost-cache.ts`：租户 ID 哈希成有界 opaque tag；失效调用失败时记录错误但不把已提交的上传伪装成失败，30 秒 TTL 兜底。
- `app/api/usage/events/batch/route.ts`、`app/api/harness/report/route.ts`、`app/api/admin/cleanup-claude-legacy/route.ts`：仅在成功写入、修正、dispatch 物化或 cleanup 事务后定向失效；空批次、重复上传、dry-run 与失败事务不失效。现有价格审批继续使用全局价格 tag。
- 独立 Evaluator 首轮发现 `auto_applied` 免费模型的检测与管理扫描漏掉价格 tag 失效（首轮 verdict 为 FAIL）。现已在 `src/server/pricing/cache.ts` 统一价格失效，修复 `detect.ts` 与 `scan/route.ts`，并覆盖原有 review/lookup 路径；需二轮独立复核。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| 聚焦 7 文件单测 | 56/56 通过 |
| 全量 `npm test` | 首轮 1462 通过、20 跳过；修复免费模型后复跑为 1466 通过、20 跳过、1 失败：未修改的 `tests/cli/agent-lifecycle.test.ts:152` SIGTERM 锁清理竞态；单独复跑该文件 6/6 通过。该波动是 B01 的独立整改项，不以重试冒充绿灯 |
| `npm run verify`、`npm run lint -- --no-cache`、`git diff --check` | 通过 |
| `npm run build` | 最终代码的 Next 15.5.18 生产构建通过 |
| 隔离 PG16 | 28/28 migrations applied；数据库 `tokenizer_b09_cache`、端口 55488，独立 scratch cluster |
| 真实 Next production server + PG replay | 免费模型修复后最终构建运行 `tests/integration/b09-next-pg-replay.mjs` 通过：两页与 `/api/summary` 四项成本同值，迟到 insert $2.50→$5.00，correction →$7.50，价格编辑 →$15.00；检测与扫描两条 auto-free 路径 `unpricedTokens=0`；B 租户不受 A 写入影响；legacy cleanup 删除后两页立即 $25.00→$20.00；跨租户 Harness 路由 404 |

真实 replay 的外部直接数据库删除不经过应用的 tag 失效：30 秒 TTL 到期后的**首次**读仍返回旧值（Next Data Cache stale-while-revalidate），约 1 秒内下一次读得到新值。该行为已观察并保留为限制，不可宣称外部直接写入“首次请求立即新鲜”。应用路由内的 insert/update/delete 由 tag 失效，首次后续读为新值。最终 hash/tag 代码已重建并重跑；scratch PostgreSQL 已停止，数据目录保留 `/tmp/tokenizer-b09-pg-hCdGb9/data`。

## 未验收

- 需 fresh-context、不同模型家族 Evaluator **二轮**独立复核免费模型补丁、真实 PG replay 与 S-W-R 边界；Generator 不自签。首轮 verdict：`/Volumes/ORICO/project/.worktrees/tokenizer-cost-cache-eval-20261007/docs/test-reports/B09-usage-cost-cache-20261007/evaluator-verdict.json`。
- 需与 B06/B08 合并后验证并发 writer、revision/CAS、补历史与部署拓扑；单机 scratch Next/PG 不等于多实例或生产验收。
- 尚未合并 B01/B03/B10 等候选，也未跑 Windows/GitHub CI、浏览器首上传与真实生产数据对账。
