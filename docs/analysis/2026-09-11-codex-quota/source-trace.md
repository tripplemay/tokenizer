# Codex quota 首页展示口径诊断

日期：2026-09-11。性质：独立只读诊断支持，不是正式 Evaluator 验收，不进入现有 `BL-HOMEPAGE-FRESHNESS` 批次。

## 结论

**当前首页展示的是「每个历史账号各窗口最后一次成功上报的快照」，不是「当前正在使用或当前登录的 Codex 账号」。**

1. 多张卡是显式实现和测试要求，不是 React 重复挂载：`SubscriptionCard` 将全部 `accountsByProvider["codex-chatgpt"]` 展开为卡片。服务端没有活跃账号、时间范围、设备在线或账号注销过滤。
2. 账号停止采集、设备离线、token 失效或账号切换后，历史快照仍会入选，旧卡没有自然退出路径。刷新页面只会重新得到同一历史集合。
3. 同一账号的窗口按各自最近一行拼接；卡脚却使用所有窗口中最大的 `capturedAt`。因此一条新 `plan`/secondary 可以让仍陈旧的 primary 看起来刚刷新。
4. 已过 `resetsAt` 的快照依然显示旧剩余百分比；没有过期状态，也不会重新计算为 100%。不能把这类历史值当成当前剩余额度。
5. 不能仅凭源码确定生产现在有几张卡、哪张是历史账号或用户当前真正使用哪个账号。主诊断未取得生产登录；需要登录态脱敏证据才能完成该层判断。

## 范围与基线

- 工作树：`/tmp/tokenizer-homepage-codex-quota-20260911`，分支 `codex/homepage-codex-quota-20260911`，HEAD `03351861b49c2858985b10be04b82a31100b78b7`。
- 已从磁盘读取 `AGENTS.md`、`harness-rules.md`、`CLAUDE.md`、`progress.json` 及 T0 记忆。当前状态为 `verifying`；依独立任务例外只做本报告，不改状态、不写闸门、不提交/推送/部署。
- 主诊断回传生产 `/api/health` SHA 为 `291810449c5894b66c5d7d613ffe525154fbadf5`。本协作者自行执行 `git diff 291810449c5894b66c5d7d613ffe525154fbadf5 HEAD -- app/_components/subscription-card.tsx src/server/quota.ts src/quota app/api/quota`，结果为空；相关源码与该 SHA 一致。
- 未使用浏览器、SSH、真实数据库或网络 API，未读取任何实际凭据。下述上游行为只指本仓库代码如何处理输入，不对目前 OpenAI 接口实际响应作断言。

## 端到端来源追踪

| 环节 | 实现证据 | 实际口径 |
| --- | --- | --- |
| 首页调用 | `app/page.tsx:158-161` | 只传 `tenantId`；首页 7/30 天 range 不传给 quota，无「当前设备」筛选。 |
| 多卡渲染 | `app/_components/subscription-card.tsx:11-25` | 优先 `accountsByProvider` 全数组；0 个空态、1 个单卡、多个逐账号卡。兼容 `byProvider` 仅在 accounts 数组不存在时回退。 |
| 查询 | `src/server/quota.ts:45-56` | 租户全历史表 `DISTINCT ON (provider, accountKey, windowKey)`，各窗口按 `capturedAt DESC` 取最近记录；唯一 WHERE 是 userId。 |
| 账号聚合 | `src/server/quota.ts:58-98` | `accountsByProvider` 保留所有账号，`byProvider` 才选最近上报账号作为兼容视图；没有按采集时间给账号数组排序。 |
| 快照存储 | `prisma/schema.prisma:233-252` | append-only 历史快照，无 active/archived/session/snapshot-batch 字段；设备删除时 `capturedBy` 为 SetNull，快照不随设备删除。 |
| 上传 | `src/quota/sync.ts:8-27` | 上传 `{ snapshots }`；没有账号退出、采集失败或活跃账号声明。 |
| 入库 | `app/api/quota/snapshots/batch/route.ts:23-56` | userId、capturedBy 来自认证设备 token；accountKey/windowKey 接收客户端值；`createMany` 追加，不替换旧账号或消失的窗口。 |
| 采集时间 | batch route `:41-55`；schema `:244` | 不接收客户端 capturedAt，使用数据库插入时的 `now()`。因此这里是服务端接收时间，不是严格的上游采样时间。 |
| 采集入口 | `src/cli/agent.ts:90-96,194-196,244-252` | cron 同步尾部采集；daemon 按事件活跃度选择 60/300 秒阈值。活跃度是「有用量事件」，不是「哪个 Codex 账号活跃」。 |
| 配置判断 | `src/quota/auth-file.ts:21-35`；`src/quota/codex-chatgpt.ts:34-40` | 固定读取 home 下 `.codex/auth.json`，存在 access token 即配置；不查当前 CLI 进程、事件或首页登录账号。代码没有使用 `CODEX_HOME` 或 authMode 参与配置选择。 |
| 请求账号 | `src/quota/codex-chatgpt.ts:49-55` | 请求 header 优先嵌套 `tokens.accountId`，再顶层 `accountId`。 |
| 结果账号 | `src/quota/codex-chatgpt.ts:69-74`；`src/quota/registry.ts:29-31` | `response.account_id -> auth.tokens.accountId -> auth.accountId -> "unknown"`。registry 用 result.accountKey 覆盖本轮每行账号。 |

### 从上述链路可严格推出的边界

- **多设备不等于多卡。** 相同 accountKey 的多设备写入合并到一张卡；不同 accountKey 才分卡。多个卡脚设备名不能直接证明当前多账号并用。
- **账号切换不等于账号退役。** 设备先写 A，再写 B，仅追加 B；A 在查询中仍永久拥有各自最新行，除非另有显式数据清理。
- **失败不撤销历史。** 401/网络异常返回空 snapshots（`src/quota/codex-chatgpt.ts:62-79`），未配置 provider 直接跳过（`src/quota/registry.ts:15-22`），`runQuotaRefresh` 仅有非空 snapshots 才上传（`src/quota/run.ts:15-27`）。历史快照不变。
- **错误不是首页状态源。** 本地 state 有 `lastQuotaRefreshStatus` / `quotaAuthErrors`（`src/quota/run.ts:34-58`），但心跳诊断白名单不包含这些字段（`src/cli/sync.ts:119-156`），首页也不读取它们。注释所说 footer reflects failure 不能视为已实现失败提示。
- **未知账号可碰撞。** 缺失所有账号 ID 时，不同设备写入相同 `"unknown"`，会合卡；后续上游返回真实 ID，又会新增真实账号卡，原 unknown 卡仍存在。这是可构造输入，不代表生产已经发生。
- **按窗口保留会残留已消失的字段。** 新响应缺少旧 primary/code-review/credit 时 collector 不生成该行（`src/quota/codex-chatgpt.ts:88-134`），查询继续取旧窗口；本轮请求并没有形成一个可替代旧整包的快照对象。

## stale、重置及文案

- `QuotaLatestWindow` 没有 `capturedAt`/`capturedBy` 字段（`src/server/quota.ts:6-14,71-79`）；窗口级年龄到 UI 前已丢失。卡片元数据取所有窗口最大时间及其设备（`:80-84`）。
- 剩余值仅为 `max(0, 100 - round(utilization * 100))`（`app/_components/subscription-card.tsx:108-117`），没有 `Date.now()` 或 resetsAt 有效性分支。旧 80% used 会继续显示 20% remaining，无论最后一次采集距今多久。
- 重置时间使用面向「过去多久」的 `formatRelativeTime`（组件 `:124-126`；`src/shared/format.ts:101-117`）。过去时间得到「N 小时前」，再被中文模板 `"{time}后重置"` 包装（`messages/zh-CN.json:439`），可出现「N 小时前后重置」。超过一天则绝对时间后仍追加「后重置」。
- 刷新脚注也把已经带「前」的相对时间传给 `"{ago}前刷新"`（组件 `:99-103`；`messages/zh-CN.json:447-448`），存在重复「前」的文案问题。这不是数据选择根因，但会降低 stale 可理解性。
- primary/secondary 标签固定为 5 小时/一周（`messages/zh-CN.json:435-438`），collector 将上游 `window_minutes` 留在 rawJson，UI 不读取它。若真实响应窗口长度不同，标签会失真；本轮未验证生产响应是否存在这种差异。
- cache revalidate 是 30 秒（`src/server/quota.ts:4,101-105`）。它能解释短时更新延迟，不能解释历史账号长期不消失。

## 规格与测试意图

1. 原始 PRD 把 `accountKey` 定义为上游账号、多账号预留；缺 account_id 曾设想 OAuth subject 稳定哈希（`docs/PRD-quota-snapshot.md:45-46,59,120`）。Codex 切片改为缺失使用 `unknown`（`docs/superpowers/specs/2026-05-19-events-enrichment-codex-quota-design.md:244-247,530-531`）；这与稳定隔离的原始方向存在差别。
2. 多设备各自采集、capturedBy 随最近设备变化是明确接受的 v1 设计（同切片 spec `:534-536`）。失败后保留上次成功快照也属明确设计（`:524-527`），错误横幅/重连 UI 被裁出该切片（`:54-56,542-544`）。
3. 原设计只有 provider/windowKey 查询，后来 `docs/specs/BL-SECURITY-P1-spec.md:96-105` 明确要求 accountKey 分组及每账号一卡，避免跨账号拼接。引入当前多卡逻辑的 Git 提交为 `cb16ce1`。**不能以去掉 accountKey 分组来压成一张卡，那会回退已修复的跨账号污染。**
4. 当前测试明确覆盖/接受多卡与跨窗口采集时间不同：`tests/server/quota.test.ts:35-77` 的账号 A 两窗口分别来自不同设备/时刻，脚注元数据取较新行；`tests/shared/subscription-card.test.ts:55-98` 检查每账号一卡和兼容回退。
5. 真实 DB probe 验证历史同窗口取新及账号隔离，但不验证同账号跨设备竞争（`tests/server/quota-account-db.probe.test.ts:36-82,92-112`）；只有配置 `EVAL_F005_DB_URL` 才执行（`:17-25`）。
6. 旧切片手测 `:592-593` 写移除 auth 后应为空，但同文 `:522-526` 又规定不写 DB 且保留历史数据。应区分「从未采集」与「曾采集后断开」，现实现支持前者空态，不支持后者自动清空。

测试缺口集中在账号切换/退出、old account 折叠策略、旧 primary + 新 plan 的局部 stale、超过 resetsAt、窗口从新响应消失、unknown 碰撞，以及 response/nested/top-level accountId 优先级。现有 card fixture resetsAt 为 null（`tests/shared/subscription-card.test.ts:26-40`），不覆盖重置文案。

## 可复现输入与本地观察

为避免访问数据库/凭据，本次用 TypeScript transpile 当前 `src/server/quota.ts`，在 VM 中只替换 `next/cache` 为 passthrough、`prisma.$queryRaw` 为下列 fixture。**这验证当前生产同 SHA 的聚合逻辑，不冒充真实 PostgreSQL 或浏览器复现。**

所有行 provider=`codex-chatgpt`、unit=`percent`、resetsAt=`2026-08-02T00:00:00.000Z`，其余未用字段为 null：

| accountKey | windowKey | capturedAt | utilization | capturedBy |
| --- | --- | --- | --- | --- |
| old | rate_limit_primary | 2026-08-01T00:00:00.000Z | 0.80 | device-old |
| current | rate_limit_primary | 2026-08-01T00:00:00.000Z | 0.60 | device-current |
| current | rate_limit_secondary | 2026-09-11T00:00:00.000Z | 0.20 | device-current |

调用 `getQuotaLatest("test-user")` 的实际输出：

```json
{
  "cardCount": 2,
  "old.capturedAt": "2026-08-01T00:00:00.000Z",
  "current.capturedAt": "2026-09-11T00:00:00.000Z",
  "current.windowKeys": ["rate_limit_primary", "rate_limit_secondary"],
  "current.primary.utilization": 0.6,
  "current.primary.resetsAt": "2026-08-02T00:00:00.000Z",
  "latestCompat": "current"
}
```

`current` 的 old primary 在 DTO 中已经没有独立 capturedAt；首页按当前逻辑会将两账号各画一张卡，并分别计算旧账号 20%、current primary 40%、secondary 80%。这些 UI 值为源码公式推导，非浏览器实测。

重放入口可复用 `tests/server/quota.test.ts:12-27` 的 row helper，将上述三行作为 `mocks.queryRaw.mockResolvedValue`，补 `accountsByProvider.length===2` 与 current 时间断言；不要连接生产库。主诊断另在原工作树实跑 `npx vitest run tests/server/quota.test.ts tests/shared/subscription-card.test.ts`，回传 6/6 PASS；本协作者未重复该测试或运行全量测试。

## 最小修复建议与用户裁决

**建议先做展示层 hotfix，保留 accountKey 隔离与历史快照：**

1. 首页收成一个 Codex 区域，默认展开「最近成功上报的账号」，其他账号折叠可查，并明确不是「当前登录账号」。复用兼容 `byProvider` 的整账号选择或显式排序，绝不回到 provider/windowKey 的跨账号聚合。
2. `QuotaLatestWindow` 带回各行 capturedAt；逐窗口判断新鲜度。已过 resetsAt 或超出约定采集年龄时标记「历史快照/待刷新」，保留最后值但去掉当前健康状态暗示。不要凭 reset 时间自行断言 100% 剩余。
3. 修正脚注文案，分开「采集于」「重置于/重置时间已过」；不复用带过去式的字符串再追加「前/后」。
4. 补上述局部更新/切账号/stale 回归用例。成功后另由独立 Evaluator 验收；本报告不能作为 hotfix signoff。

**需要用户确认的产品口径：**

- 是否采用「最近上报默认展开、其他折叠」；还是需要手动置顶账号。多设备交替上报时，最近上报账号会切换，不能等同当前使用账号。
- stale 阈值是多少，以及过期百分比是保留并标记还是隐藏为未知。现采集目标为 1/5 分钟，但睡眠/离线属于正常场景，不应由本诊断擅自设 TTL 后删数据。
- 若要求准确显示「当前正在使用」，需要另外定义设备/账号活跃状态上报与用户选择；单凭现有 QuotaSnapshot 无法推断注销、切换或当前 UI 登录态。

本轮只落报告，未实施上述修复、历史数据清理或生产变更。
