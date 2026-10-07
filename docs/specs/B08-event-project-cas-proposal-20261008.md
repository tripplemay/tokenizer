# B08 Event revision 与 Project identity CAS 规格提案

> 角色：Planner / 设计预研，不是 Generator 或 Evaluator。
> 只读基线：`029f6c53ea7193989643a1f2e4d23108ba0c9af5`（包含 B06 bounded server schema 与 PG16 CI gate）。
> 日期：2026-10-08。本文不修改产品、状态或人闸门，也不构成发布验收。

## 1. 目标与非目标

本提案同时收口两个独立但相邻的一致性问题：

1. **Event revision**：同一 `(deviceId, source, sourceEventId)` 的新旧快照乱序、重试或并发到达时，旧快照不得覆盖新版；更高可信 revision 可以合法把 token/model 等值向下修正，不能用 `max(tokens)` 猜新旧。
2. **Project identity CAS**：repo 身份与设备本地路径观测分离；相同 repo 可跨设备归并，不同 repo 即使复用同一路径也不得自动合并或改写历史项目。

非目标：

- 不用 `occurredAt`、HTTP 到达时间、token 数量或 `createdAt` 推断快照新旧。
- 不自动合并 repo rename、fork、mirror 或两个不同 `repoKey`。
- 不在迁移中猜测缺少 repo 证据的历史事件。
- 不以 B09 的 30 秒缓存 TTL 替代数据库顺序和 CAS。
- 不把 B06 已落地的服务端有界 schema 误称为客户端逐行 quarantine / partial ACK；后两者仍需单独实现。

## 2. 当前事实与失效模式

### 2.1 Event

- `UsageEvent` 只有唯一键 `(deviceId, source, sourceEventId)`，没有 revision、accepted payload hash 或更新时间（`prisma/schema.prisma:178-231`）。
- `ingestUsageEvents` 先 `createMany(skipDuplicates)`，再按 ID 读取冲突行；只要 Agent feature version >= 2 且可比字段不同，就无条件 `update({id})`（`src/server/ingest.ts:175-192,261-356`）。该 update 没有 revision 条件，两个并发 writer 也是 last writer wins。
- CLI 按 `occurredAt` newest-first 分批发送（`src/cli/sync.ts:68-77,101-129`）。因此新版先到、旧版后到不是异常路径；当前服务器会被尾部旧批次反向覆盖。
- 本地队列 `dedupeBySourceEventId` 同键保留数组中最后一个对象，也没有 revision 比较（`src/cli/collect.ts:64-69`）。
- Claude 同一 `message.id` 以首行构造稳定 ID、末行提供当前快照，文件增长会产生同 ID 的更新（`src/parsers/claude.ts:146-223`）。这正是允许合法修正且必须排序的来源。
- Codex v2 把累计快照写进 canonical ID；相同累计快照通常是不可变事件，但未来 parser 语义升级仍可能需要更正该行（`src/shared/codex-usage.ts`、`src/parsers/codex.ts:70-112`）。
- 当前 legacy feature gate 只能区分 parser v1 与 v2，不能区分两个同为 v2 的快照。

### 2.2 Project

- `Project` 同时以 `(userId, workspacePath)` 和 `(userId, repoKey)` 唯一（`prisma/schema.prisma:84-102`）。路径是设备本地观测，不应成为租户级永久身份。
- repo create 命中 workspace unique 时，当前 catch 会找到路径对应项目并直接写入新 `repoKey`；它没有验证旧项目 `repoKey == null`（`src/server/ingest.ts:67-93`）。路径从 repo A 被 repo B 复用时，A 的项目会被改名成 B。
- `repoKey` 已由服务端再次规范化，host 小写、userinfo/query/fragment 被去除、path 保持大小写（`src/shared/git-remote.ts:13-59`）。它适合作为 repo identity 输入，但 rename/fork/mirror 不应被猜成同一仓库。
- 原 PRD 已明确 Project 稳定身份应以 repoKey 为主、`localWorkspacePath` 留在 UsageEvent，`workspacePath` 不应继续作为 Project 的跨设备唯一身份（`docs/PRD-tokenizer-multi-device-opencode.md:520-613`）。

### 2.3 B06 / B09 接口边界

- B06 已把 body、行数、字符串、整数、UTC、JSON 深度/字节和真实 PG reject-before-write 纳入服务端 gate。B08 新字段必须进入同一纯校验阶段，不能在 device/token/project 写入后才发现 revision 非法。
- B09 只在 `inserted > 0 || updated > 0` 时失效 tenant usage-cost tag（`app/api/usage/events/batch/route.ts:26-29`），并以 30 秒 TTL 兜底。B08 应保持：stale / identical duplicate / conflict 不失效；真正接受的 revision（包括 token 合法下降）才失效。

## 3. Event revision wire contract

在 `UsageEventInput` 增加可选字段：

```ts
type EventRevision = {
  scheme: EventRevisionScheme;
  sequence: string; // canonical unsigned decimal, <= signed int64 max
};

type UsageEventInput = {
  // existing fields unchanged
  revision?: EventRevision;
};
```

### 3.1 校验

- `revision` 对旧 Agent 可缺省；存在时只能有 `scheme`、`sequence` 两个键。
- `scheme` 必须来自 `source -> allowed schemes` 白名单，最长 64 bytes；不能接受客户端自报任意 generation/rank。
- `sequence` 必须匹配 `^(0|[1-9][0-9]{0,18})$`，解析后不大于 `9223372036854775807`。使用十进制字符串避免 JSON/JavaScript safe-integer 截断。
- revision 校验、同批同 key 的归并/冲突检测必须在任何 Prisma 写入前完成，沿用 B06 的 400 `invalid_event` + row index；不回显 payload。
- `minimizeUsageEvent`、queue JSONL、隐私过滤和同步序列化必须显式保留 revision；revision 不含路径、正文、工具参数或凭据。

### 3.2 Scheme 与排序

服务端维护不可由客户端覆盖的 rank 表，例如：

| source | scheme | rank | sequence 的含义 |
| --- | --- | ---: | --- |
| `claude-code` | `claude-jsonl/v2` | 200 | 同一 message group 已观察到的 assistant usage row 数；append-only 增长时单调 |
| `claude-code` | `claude-legacy-meta/v1` | 100 | 合法 `updated_at` 的 epoch-ms；缺失/非法时不发送 revision |
| `opencode` | `opencode-message/v1` | 100 | SQLite `time_updated` epoch-ms；缺失时用 `time_created` |
| `codex` | `codex-cumulative/v2` | 200 | `0`；累计值已进入 canonical `sourceEventId`，同 ID 默认不可变 |
| `aider` | `aider-line/v1` | 100 | `0`；当前行身份默认不可变 |
| `kimicode` | `kimicode-turn/v1` | 100 | `0`；当前 turn 身份默认不可变 |

规则：

- parser 语义发生会改变既有事件输出的升级时，新增 scheme（如 `claude-jsonl/v3`）并由服务端发布更高 rank；不能复用旧 scheme 偷换含义。
- 同 rank 只比较 sequence；更高 rank 或同 rank 更大 sequence 才是 newer。
- OpenCode 同毫秒不同 payload、append-only 假设被破坏后的同 Claude sequence 不同 payload，都属于**不可排序 conflict**，不得用到达时间择胜。
- rank 表是服务端代码常量并有双向契约测试；数据库只保存解析后的 rank，不能信任 wire 中的数字。

Claude 使用“组内 usage row 数”而不是文件 byte offset：同一逻辑消息复制到不同前缀长度的文件时仍可比较；精确副本得到相同 revision。若上游以后提供稳定的 per-message revision，应新增 scheme，不原地改变 v2。

### 3.3 Canonical mutable projection 与 hash

服务端在完成 B06 normalization 后，对当前允许 correction 的字段构造固定顺序、显式版本的 projection，再计算 SHA-256：

```text
payload-hash/v1 = sha256(canonical JSON of
  model, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens,
  reasoningOutputTokens, cacheEphemeral5mInputTokens,
  cacheEphemeral1hInputTokens, webSearchRequests, webFetchRequests,
  serviceTier, totalTokens, fallbackFromModel, fallbackToModel,
  minimized rawJson)
```

- hash 由服务端重算，不接受客户端提供值。
- `sourceEventId`、`occurredAt`、device/user、workspace/repo/git 和 `projectId` 不在此 mutable projection；它们不能因 usage correction 被历史重采集时的当前目录/branch/commit 悄悄改写。
- Project 历史归因修正走第 5 节的独立、可审计 backfill，不借 Event revision 偷带。

### 3.4 接受状态机

对相同唯一键，定义 stored/incoming 的处理：

| stored | incoming | 结果 |
| --- | --- | --- |
| 不存在 | 任意合法 | insert；有 revision 时同时保存 tuple/hash |
| legacy，无 revision | legacy，无 revision | 过渡期维持现有 feature>=2 correction；明确仍是 last-writer 风险 |
| legacy，无 revision | versioned | 接受一次，写入 tuple/hash；合法下降允许 |
| versioned | legacy，无 revision | `stale`，不更新 |
| versioned | tuple 更高 | CAS 接受，覆盖 mutable projection + tuple/hash；合法下降允许 |
| versioned | tuple 更低 | `stale`，不更新 |
| versioned | tuple 相同、hash 相同 | `duplicate`，不更新 |
| versioned | tuple 相同、hash 不同 | `conflict`，不更新，不按到达时间择胜 |

这保证“高 revision 的 1000 -> 900”可接受，而“低 revision 的 1 -> 覆盖 1000”被拒；数值方向完全不参与新旧判断。

### 3.5 数据库字段与原子 CAS

`UsageEvent` 增加全部 nullable 的兼容字段：

```prisma
sourceRevisionScheme   String?
sourceRevisionRank     Int?
sourceRevisionSequence BigInt?
sourceRevisionHash     String?  @db.Char(64)
sourceRevisedAt        DateTime?
```

迁移另加 CHECK：四个核心 revision 字段必须“全空或全有”，rank/sequence 非负，hash 为 64 位小写 hex。现有行全部保持 NULL；禁止用 token、occurredAt、createdAt 猜历史 revision。

实现必须把当前“read then `update({id})`”改成数据库条件更新：

```text
UPDATE UsageEvent
SET mutable projection..., revision tuple/hash...
WHERE userId/deviceId/source/sourceEventId match
  AND (
    stored revision is NULL
    OR stored rank < incoming rank
    OR (stored rank = incoming rank AND stored sequence < incoming sequence)
  )
```

- 使用 `updateMany` 条件或等价 `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`；不能先读后无条件 update。
- PostgreSQL 行锁后的 WHERE 重检保证并发 rev 10 / rev 11 最终收敛到 11，不论提交顺序。
- 同一 batch 的重复 key 先在内存按 tuple 取最大；相同 tuple 不同 hash 在写前判 conflict。
- Event insert/correction 放进一个事务；接受计数来自实际 `RETURNING` / `updateMany.count`，不能由预读推算。

## 4. ACK、quarantine 与兼容发布

### 4.1 Additive response

现有聚合字段保持：`inserted / updated / duplicates / received / deviceId`。revision-aware 响应新增：

```json
{
  "ingestProtocol": { "eventRevision": 1, "eventOutcomes": 1 },
  "stale": 1,
  "conflicts": 0,
  "outcomes": [
    { "index": 0, "status": "inserted" },
    { "index": 1, "status": "stale" }
  ]
}
```

- status 白名单：`inserted | updated | duplicate | stale | conflict`；使用 request index，响应不回显路径型 sourceEventId。
- `inserted/updated/duplicate/stale` 都可从 durable queue ACK。`conflict` 只移入本地有界 quarantine，保留 hash/scheme/sequence/source 与脱敏错误码，不反复阻塞整个队列。
- 新 Agent 必须验证 outcomes 数量、index 唯一性和协议版本；畸形响应不删 queue。
- 旧 Agent 忽略新增响应字段；它不发送 revision，继续使用现有整批 2xx ACK 行为。

### 4.2 发布顺序

1. 先部署 additive DB migration + 新 server；旧 Agent 行为保持。
2. server 的空 batch/正常 response 宣告 `eventRevision=1,eventOutcomes=1`。
3. 再发布 Agent capability 10：只有探测到 server capability 后才发送 revision 并启用逐行 ACK/quarantine；旧 server 上保持 legacy wire，不假设未知字段会被正确执行。
4. capability 10 Agent 对 Claude/OpenCode 可变事件必须带 revision；server 对“自报 capability>=10 却缺 revision”的可变 scheme 请求 400，且 reject-before-write。
5. 在覆盖率和冲突率可观测、旧 Agent 降到约定阈值后，另批关闭 legacy-to-legacy correction。不能在本批直接把所有旧 Agent correction 禁掉。

这是一项 correctness capability，应在 Agent 发布时 bump `AGENT_FEATURE_VERSION`；`MIN_AGENT_FEATURE_VERSION` 是否同步提升由发布批次决定，不在 Planner 文档里冒充已决策。

## 5. Project identity 数据模型

### 5.1 分离 canonical project 与 identity observation

新增 `ProjectIdentity`（名称可在实现时调整，但语义固定）：

```prisma
model ProjectIdentity {
  id             String   @id @default(cuid())
  userId         String
  projectId      String
  kind           String   // "repo" | "workspace"
  scope          String   // repo: ""; workspace: deviceId
  keyHash        String   @db.Char(64)
  canonicalValue String   // repoKey 或 normalized workspacePath，用于 hash collision fail-closed 比对
  bindingVersion Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([userId, kind, scope, keyHash])
  @@index([projectId])
}
```

同时给 `Project` 增加 `identityRevision Int @default(0)`。

- repo identity：`kind=repo, scope="", canonicalValue=normalized repoKey`，租户内跨设备唯一。
- workspace identity：`kind=workspace, scope=deviceId, canonicalValue=normalizeWorkspacePath(path)`，只在同一设备内唯一。
- `keyHash=sha256("project-identity/v1\0" + kind + "\0" + scope + "\0" + canonicalValue)`；由于 4096-byte path 不能安全直接做普通 unique btree，索引用定长 hash。命中后必须 constant-time 或普通 byte equality 再比 `canonicalValue`；极端 hash collision 返回 conflict，绝不归并。
- name 不是 identity。缺 repo、缺 workspace 的事件保持 `projectId=null`（UI 继续显示 Unknown），不能按租户内相同名字自动合并。
- `Project.workspacePath` 仅作为 legacy/display hint，`UsageEvent.localWorkspacePath` 保留真实本地观测；新 resolver 不再用 Project.workspacePath 作为身份。
- `Project.repoKey` 与现有 `(userId,repoKey)` unique 继续作为 defense in depth；repo alias 才是 resolver 的规范入口。

### 5.2 Resolver 规则

所有步骤限定 `userId`，并在 `Serializable` transaction + 现有 `retrySerializableTransaction` 中执行。

#### 有 repoKey

1. 查 repo identity；存在则返回其 Project。
2. 不存在时查同设备 workspace identity。
3. workspace identity 指向的 Project 没有 repo identity、`Project.repoKey IS NULL`：
   - `updateMany where id,userId,repoKey:null,identityRevision=expected`，设置 repoKey/name/safe remote 并 `identityRevision += 1`；
   - count 必须为 1，随后创建 repo identity 指向该 Project；任何 P2002/CAS loser 整个事务回滚并重读。
4. workspace identity 已绑定相同 repo：补缺失 alias 或直接返回。
5. workspace identity 已绑定**不同 repo**：创建/取得 repoKey 对应的新 Project；创建时 `workspacePath=null` 避开 legacy path unique；不得改旧 Project、不得移动旧 UsageEvent、不得重绑 workspace identity。
6. repo Project 确定后，workspace identity 若不存在可指向它；若已指向其他 Project，只记录 collision，不自动 rebind。

#### 无 repoKey

1. 有 workspacePath：按 `(user, device, normalized path)` identity 查找；不存在则创建 workspace-only Project + identity。
2. 无 workspacePath：不创建基于 name 的永久身份，事件 `projectId=null`。

`ProjectIdentity.projectId` 在常规 ingest 中不可变。未来人工 merge/rebind 必须提供 `expected bindingVersion`、审计记录和可撤销映射，不能复用 ingest 自动完成。

### 5.3 为什么不同 repo 不会自动合并

- repo A 与 repo B 的 repo identity key 不同；路径相同只代表同设备观测冲突。
- promotion 的 CAS 明确要求 Project 尚无 repo identity / `repoKey IS NULL`。
- 两个并发请求分别尝试把同一 workspace-only Project 晋升为 A/B 时，最多一个 CAS 成功；失败方重读后创建独立 repo Project。
- 已存在 repo A 的项目绝不被 update 成 repo B。A 的历史事件保持 A；B 的新事件进入 B。

## 6. 迁移与回填

### Phase M1：纯 additive schema

- 新增 UsageEvent nullable revision 字段、`Project.identityRevision` 和 `ProjectIdentity` 表。
- 不删除旧索引，不更新历史 token/project 归因，不启用新 Agent。
- migration 在空库、当前规模副本和重复执行检查中验证；DDL 锁时长单独记录。

### Phase M2：只读预览与幂等 identity backfill

提供显式、tenant-bounded、默认 dry-run 的 backfill：

1. `Project.repoKey` 能通过当前 normalize 规则且租户内唯一：创建 repo identity 指向原 Project。
2. 从 UsageEvent 提取 `(userId, deviceId, normalized localWorkspacePath/workspacePath, projectId)`：同一 key 只指向一个 Project 时创建 workspace identity。
3. 同 key 指向多个 Project、Project.repoKey 与 event.repoKey 冲突、无效 historical remote/path：只输出计数和行 ID/hash，不自动选择赢家。
4. dry-run 产物带输入范围、候选数、冲突数和 plan digest；execute 必须绑定 digest，分 tenant/chunk 执行，可重跑，不能扫描隐式 HOME。

继续保留 `(userId,workspacePath)` unique，但新代码不依赖它；需创建路径冲突的新 repo Project 时将 Project.workspacePath 置 NULL，路径仍留在 UsageEvent。这样避免在第一版做不可逆 index drop。

### Phase M3：受控历史归因修复（独立批准）

- 只有 event 的规范化 repoKey 明确对应同租户唯一 repo Project 时，才允许把 `UsageEvent.projectId` CAS 更新到该 Project。
- `where` 同时钉住 expected old `projectId`、`userId`、`repoKey`；并逐 tenant/chunk 统计 moved/skipped/conflict。
- repoKey 缺失或不一致的历史行保持不动。不同 repo 的 Project 不合并；空壳 Project 的删除另批处理。
- 每个受影响 tenant 在事务提交后只失效一次 B09 usage-cost tag，因为 project 维度汇总发生变化。

### Event revision backfill

- 现有 UsageEvent revision 保持 NULL；不能从值大小、createdAt 或 occurredAt 推导。
- 新 Agent 首次上传更高可信 snapshot 时把 legacy 行晋升为 versioned。
- 若必须大规模 parser replay，沿用 B03 的显式、有界、digest-confirmed replay 入口；不得 reset normal cursor 或隐式全 HOME 游走。

## 7. B09 cache/revision 契约

- revision CAS 是数据库真源；B09 tag 只是提交后的 freshness 信号。
- `inserted` 或 CAS 真正 accepted 的 `updated` > 0：提交后失效 tenant tag。
- `duplicate/stale/conflict`：不失效，避免旧重试制造 cache churn。
- 合法下降的高 revision 属于 `updated`，必须失效；真实 Next + PG 应观察成本从高值下降到修正值。
- Project historical re-attribution 虽不改 token，也会改变 project/batch 页聚合，提交后必须失效。
- 外部直接 DB 写仍只有 B09 的 TTL/SWR 兜底；B08 不把它提升为“首读强一致”。

## 8. 验证矩阵

### 8.1 真实 PostgreSQL 16：Event

| 场景 | 必须断言 |
| --- | --- |
| rev 2 后到 rev 1 | rev 1=`stale`，最终 projection/hash 保持 rev 2，0 cache invalidation |
| rev 1 / rev 2 并发，交换提交顺序 | 两轮都最终为 rev 2；每轮最多一次对应 accepted mutation |
| 同 tuple 同 payload | `duplicate`，无 UPDATE |
| 同 tuple 不同 payload | `conflict`，stored 不变，新 Agent 移入 quarantine |
| rev 2 token 1000 -> rev 3 token 900 | `updated`，900 被接受并失效 cache |
| legacy row -> versioned -> legacy retry | versioned 晋升成功；尾部 legacy 不覆盖 |
| legacy Agent -> legacy row | 过渡期行为与当前兼容，并明确该路径未获得乱序保证 |
| 同 batch 同 key 的 1/3/2 | 只按 3 落库；响应 index dispositions 确定 |
| capability 10 缺 revision / 非法 sequence / source-scheme 不匹配 | HTTP 400，Device/Token/Project/UsageEvent 全部 0 side effect |
| transaction crash/serialization retry | 无半批 event mutation；重试幂等 |

### 8.2 真实 PostgreSQL 16：Project

| 场景 | 必须断言 |
| --- | --- |
| 同 repo、不同设备和路径 | 一个 canonical Project，两个 workspace identities |
| 同设备同路径先 repo A 后 repo B | 两个 Project；A 名称/repoKey/history 不变，B 新事件归 B |
| workspace-only 后补 repo A | CAS 晋升一次；Project ID 保持，repo alias 唯一 |
| 同一 workspace-only Project 并发补 A/B | 最多一个晋升；另一 repo 独立创建，不交叉历史 |
| 同 repo 并发首次上报 | 一个 repo identity/Project，P2002/serialization retry 可收敛 |
| 两设备相同路径、无 repo | 两个 device-scoped workspace identity，不自动合并 |
| 两租户相同 repo/path | 完全隔离 |
| hash collision fixture | canonicalValue 不同即 fail-closed，不归并 |
| backfill 重跑 | 第二轮 0 mutation；冲突清单稳定 |

### 8.3 Agent / API / cache

- legacy wire fixture byte-compatible；旧 Agent 可 insert/dedupe，不能覆盖已 versioned 行。
- 新 Agent 对不支持 capability 的旧 server 不发送 revision-aware correction；发布顺序测试锁住。
- durable queue 保存 revision；本地 dedupe 选高 tuple；equal-tuple/different-payload 进入有界 quarantine。
- kill/restart、部分 ACK、网络重试后 queue 不丢，outcomes 畸形时不清队列。
- B09 真实 Next + PG：accepted 上升、accepted 下降立即可见；stale/duplicate/conflict 不触发 tag；tenant B 不受 tenant A 影响。
- Node 22 targeted/full、Linux CI、Windows queue/BigInt wire 测试；这些不能替代真实 PG 并发屏障测试。

## 9. 回滚策略

| 阶段 | 回滚方式 | 禁止事项 |
| --- | --- | --- |
| M1 additive schema | 回滚应用，保留 nullable 列/新表 | 不急删列；避免长锁和数据丢失 |
| 新 server、旧 Agent | 关闭 revision enforcement，继续 legacy ingest；保留已写 revision | 不清空 revision 让旧快照重新可覆盖 |
| capability 10 Agent | 回退 Agent，server 仍拒绝 legacy 覆盖 versioned row | 不回退到会无条件 update versioned 行的 server |
| Project identity v2 | resolver 可切 read-only/fallback，但不同 repo guard 必须保留 | 不恢复当前“路径冲突直接改 repoKey”的 catch |
| historical re-attribution | 用执行前映射清单按 expected current projectId 反向 CAS | 不按 Project 整表覆盖，不合并不同 repo |

删除 identity 表/列、移除旧 unique index或清理旧 Project 都是后续不可逆批次，不与首轮上线绑定。若必须回滚至未包含 R07 guard 的旧 binary，应先暂停 usage ingest；schema 兼容不等于 correctness-safe rollback。

## 10. 风险与开放问题

1. **Claude revision 来源**：组内 row 数依赖 append-only 契约；需要真实 fixture 验证 compaction/复制行为。若上游有稳定 sequence，应另建 scheme。
2. **OpenCode 同毫秒更新**：`time_updated` 可能不足以全序；同 sequence 不同 payload 必须 conflict/quarantine，不能 hash 排序。R03 的 cursor 修复是该 adapter 上线前置。
3. **Conflict 保存多久**：建议本地 quarantine 只留最小 projection hash/原因/时间并设条数与字节上限；是否需要服务端 bounded conflict audit 表需产品/隐私决策。
4. **Legacy correction 退场阈值**：需要按 active device capability 和 stale correction 指标决定，不能只按发布日期。
5. **repo rename / mirror**：默认新 Project；未来显式 merge UI 需要预览、expected-version CAS、审计和撤销，不能进自动 ingest。
6. **Project workspace 展示**：`Project.workspacePath` 变成 legacy hint 后，详情页应从 UsageEvent 按 device 展示路径；是否保留首见路径需产品决定。
7. **历史修复隐私**：冲突报告默认只含 row ID、tenant-scoped counts 和 key hash；原始路径/repo remote 仅在明确授权的本地输出中出现。
8. **协议切换**：partial ACK/quarantine 尚未实现；在它们落地前不能对 capability 10 开启严格 equal-revision conflict 上传。
9. **写放大**：逐 event CAS 最坏 200 次条件更新；实现需用批量 SQL 或并发受控 transaction，并用 200-row PG benchmark 决定，不可用无条件 Promise.all 打满连接池。
10. **Project backfill 规模**：先采集 tenant/event/project 基数与冲突率，再定 chunk；本文不假定生产规模或锁窗口。

## 11. 建议实施切片

### 下一个最小可实施切片：B08-S1 server safety substrate

范围刻意不含 Agent 发布与历史移动：

1. additive migration：UsageEvent revision nullable 字段 + `Project.identityRevision`；先不建/启用完整 historical re-attribution。
2. 修复当前 R07 catch：仅 `repoKey IS NULL + expected identityRevision` 可 CAS adoption；已有不同 repo 时创建 `workspacePath=null` 的独立 Project。
3. 增加 revision wire 类型/严格校验、server scheme-rank helper、canonical payload hash helper；legacy wire 行为不变。
4. 对**显式带 revision**的事件启用原子条件 update；stored versioned 行拒绝 legacy overwrite；响应先提供 additive aggregate/outcomes。
5. 真实 PG16 deterministic barrier tests 覆盖 rev1/rev2 双顺序、合法下降、equal conflict，以及 repo A/B 同路径并发；静态 workflow test 保证 probe 在 PG16 job 中 0 skip。
6. B09 仅对实际 accepted insert/update 失效的回归。

S1 的完成定义是“server 可以安全接收未来 revision，并立即关闭 R07 自动改仓与 versioned-row 回退”，不是“所有旧 Agent 已获得乱序保证”。

后续顺序：

- **S2 Agent adapters + durable queue outcomes/quarantine**：Claude 先行，随后 OpenCode（先修 R03）；feature capability bump，server capability handshake。
- **S3 ProjectIdentity table + dual-read/lazy-write + dry-run backfill**：先 identity，不移动历史。
- **S4 digest-confirmed historical project re-attribution + B09 real Next/PG replay**。
- **S5 legacy correction retirement / optional old workspace unique cleanup**：仅在覆盖率、恢复与独立验收后。

## 12. 交付边界

本文是可实施规格，不是代码完成、CI 通过或发布放行。B08 后续每个 Generator slice 都应由不同模型家族的 fresh-context Evaluator 复核，并明确区分：单测、真实 PG 并发、Agent 平台测试、safe-branch CI 与生产迁移/回滚演练。
