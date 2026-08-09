# BL-DEVICE-DECOUPLE 落地方案

## 目标

把编排域（harness）寄生在用量域 `Device` 表上的三列——`lastHarnessSyncAt` / `harnessSyncStatus` / `harnessDiagnostics`（prisma/schema.prisma:121-123）——拆到 harness 域新表 `HarnessDeviceSync`（deviceId 唯一键），含现网数据平移。这是两域最强耦合点（reader-usage.md §4 判定：不是外键关联而是同表同列），在 BL-LIVE-SESSION 等功能加码前拆掉，避免新功能继续长在旧列上。**纯服务端重构，UI 行为零变化，agent↔服务端协议零变化。**

## 范围（In / Out）

**In：**
- 新表 `HarnessDeviceSync` + migration（含 `INSERT...SELECT` 现网数据平移 + `DROP COLUMN` ×3）
- 唯一写入点切换：`app/api/devices/heartbeat/route.ts:161-165`（`data.lastHarnessSyncAt/...` → 新表 upsert）
- 全部读取点切换（实地 grep 全量核对，见 Features）：
  - `src/server/summaries.ts:226-228`（`getDeviceSummaryImpl`，喂 `/devices`、`/api/devices`、`/api/summary`）
  - `src/server/summaries.ts:249`（`getDeviceDetail` 的 `prisma.device.findFirst`，喂 `/devices/[id]`）
  - `app/harness/page.tsx:42-43, 198-199`（device select 两列）
  - `app/devices/[id]/page.tsx:110-113, 213-220`（直读 device 三字段）
- 既有测试适配：`tests/server/heartbeat-harness.test.ts`（含 321-334 的 schema/migration 守卫断言）

**Out（刻意不做）：**
- **不动 heartbeat wire 载荷**：`DeviceDiagnostics.harness`（src/shared/usage.ts:54）保留原形——它是 9 个消费者项目共用的运输层契约，且已是 `import type`（usage.ts:1）纯编译期耦合，零运行时影响。把 harness 段从 heartbeat 剥成独立上报通道需要 agent 升级链路配合，本批次不做，若未来有必要留给协议类批次
- 不动 `app/devices/page.tsx` 的展示逻辑（其输入 `getDeviceSummary` 输出形状本批次刻意保持逐字节不变，见 F003）
- 不动 `HarnessProject.projectId → Project` 外键（schema.prisma:338）——这是两域对齐的 designed 接缝，BL-COST-BATCH-V1 的归因基础，不是债
- 不做 `src/cli/**` 任何改动，不 bump `AGENT_FEATURE_VERSION`
- 不做 harness 同步历史时序化（新表仍是「每设备最新一条」快照语义，与旧列等价）；时序需求留给 BL-PERF-ANALYTICS/BL-LIVE-SESSION

## Features 预案

**F001 · HarnessDeviceSync 表与数据平移 migration · executor: generator**
- 涉及文件：`prisma/schema.prisma`（Device 模型 102-135 删三列；~300 行 harness 分区加新模型；User 模型 35-38 加背向关系）、`prisma/migrations/20260810000000_add_harness_device_sync/migration.sql`（新建）
- 模型要点：`deviceId String @id`（1:1）、`userId`、`attemptedAt DateTime`、`status String`、`diagnostics Json?`、`createdAt/updatedAt`；`Device/User onDelete: Cascade`；`@@index([userId])`
- acceptance：
  1. `npx prisma migrate dev` 在空库干净应用，`npm run verify` 绿
  2. migration.sql 恰含 1 个 `CREATE TABLE "HarnessDeviceSync"`、1 条 `INSERT INTO ... SELECT ... FROM "Device" WHERE "lastHarnessSyncAt" IS NOT NULL AND "harnessSyncStatus" IS NOT NULL`、3 条 `ALTER TABLE "Device" DROP COLUMN`（测试机械断言，仿 heartbeat-harness.test.ts:321-334 现有写法）
  3. `grep -n "lastHarnessSyncAt\|harnessSyncStatus\|harnessDiagnostics" prisma/schema.prisma` 零命中
  4. 平移守恒：本地库预置 N 行带 harness 列的 Device 后跑迁移，`SELECT count(*) FROM "HarnessDeviceSync"` = N，且逐列值等于迁移前（脚本断言）

**F002 · heartbeat 写入点切换 · executor: generator**
- 涉及文件：`app/api/devices/heartbeat/route.ts`（161-165 处改为同事务内 `tx.harnessDeviceSync.upsert`，保持在 `accepted && harness` 守卫内；锁序 Device→DeviceToken→新表，与 112-131 现状一致）、`tests/server/heartbeat-harness.test.ts`（mock tx 增 `harnessDeviceSync.upsert`；71-91 断言改为 upsert 调用；105-107「legacy 心跳不写」改断言 upsert 未被调用）
- acceptance：
  1. `npx vitest run tests/server/heartbeat-harness.test.ts` 绿
  2. 合法快照 → upsert 被调用且 `device.update` 的 data 不含三个旧字段名（机械断言）
  3. legacy/未接受 reporter 心跳 → upsert 零调用（防降级语义不变，route.ts:36-51 逻辑不动）
  4. 非法 harness 载荷仍 400 且事务未开启（复用现有 300-318 参数化用例，全部保持绿）

**F003 · 读取点切换（形状冻结）· executor: generator**
- 涉及文件：`src/server/summaries.ts`（`getDeviceSummaryImpl` ~201 行 `prisma.device.findMany` 改 `include: { harnessSync: ... }` 或并行查新表，226-228 三个输出键**名称与取值语义不变**；`getDeviceDetail` 249 行 `findFirst` 加 include）、`app/devices/[id]/page.tsx`（110-113、213-220 改读 `device.harnessSync`）、`app/harness/page.tsx`（42-43 select 改嵌套、198-199 取值路径改）
- acceptance：
  1. `npm run test` 全量绿、`npm run verify` 绿
  2. `grep -rn "lastHarnessSyncAt\|harnessSyncStatus\|harnessDiagnostics" app/ src/server/` 命中处全部指向 `getDeviceSummary` 输出键或新表读取路径，无 Prisma `Device` 列引用
  3. 新增测试断言 `getDeviceSummary` 输出对象仍含 `lastHarnessSyncAt/harnessSyncStatus/harnessDiagnostics` 三键且值来自新表（`/api/devices`、`/api/summary` 响应形状冻结）
  4. `harnessSnapshotFromPersisted`（src/shared/harness-health.ts:155）入参语义不变，`tests/shared/harness-health.test.ts` 零修改仍绿

**F004 · 迁移演练与零行为回归报告 · executor: evaluator**
- 涉及文件（产物）：`docs/test-reports/BL-DEVICE-DECOUPLE-signoff.md`、`docs/test-cases/BL-DEVICE-DECOUPLE-cases.md`（新建）
- 内容：本地 docker Postgres 灌入现网形状数据（含三列非空/全空/仅部分列的边界行）→ `npx prisma migrate deploy` → 行数与逐列值守恒核对；三页面（/devices、/devices/[id]、/harness）迁移前后渲染快照比对；全量测试实跑输出
- acceptance：
  1. 报告含迁移前后 `SELECT count(*)` 与抽样行 diff 的命令原文输出
  2. 报告含三页面 DOM/截图比对结论，逐页标注「无差异」或列出差异
  3. `npm run test` 与 `npm run build` 实跑输出附于报告（不得转述）
  4. 对「部分列非空」边界行的处置结果有明确记录（预期：现网不存在此形态，heartbeat 三列始终同写，见 route.ts:161-165；若演练发现存在则升级为 fixing）

## 数据模型 / migration

```prisma
model HarnessDeviceSync {
  deviceId    String   @id
  userId      String
  attemptedAt DateTime
  status      String
  diagnostics Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  device Device @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  @@index([userId])
}
```

migration 单文件三段（Postgres DDL 事务性，`prisma migrate deploy` 单迁移单事务，平移与删列原子提交）：
1. `CREATE TABLE` + 索引 + 外键
2. `INSERT INTO "HarnessDeviceSync" (...) SELECT "id","userId","lastHarnessSyncAt","harnessSyncStatus","harnessDiagnostics", now(), now() FROM "Device" WHERE "lastHarnessSyncAt" IS NOT NULL AND "harnessSyncStatus" IS NOT NULL`
3. `ALTER TABLE "Device" DROP COLUMN` ×3

平移条件取「两个关键列均非空」：写入点唯一且三列同写（heartbeat route:161-165），现网不应存在部分非空行；F004 演练负责实证。回滚预案：反向 SQL（重加三列 + 从新表回填）随 spec 存档，不入 migrations。

## API 与协议影响

- **新增/修改 endpoint：无。** heartbeat 请求/响应字节不变（`DeviceDiagnostics.harness` 载荷原样，`parseHarnessSyncSnapshot` 校验逻辑不动）；`/api/devices`、`/api/summary`（均为 web session 认证，非 agent 协议）响应形状由 F003 acceptance 冻结
- **AGENT_FEATURE_VERSION：不 bump。** 纯服务端存储重构，agent 零改动、零新能力要求（符合 CLAUDE.md 硬约束 3 与近期总原则「不动 agent 运输层」）
- **部署触发：本批次全部产品代码改动，push main 即部署生产**，且部署含一次**破坏性 migration**（删列）。部署序列（deploy-vps.yml Deploy 步骤）：`docker compose build` → `run --rm migrate` → `up -d app`——migrate 提交到新 app 容器起来之间存在秒级窗口，旧进程对 Device 的 `findMany/findFirst` 会因列缺失报错（心跳 500 由 agent 下一 tick 自愈，页面报错刷新即复原）。**因此 F001-F003 必须本地完成、全量测试绿后合成一次 push（可保留三个独立 commit）**，不得分三次 push 造成三次部署、且中间部署必炸（列已删而写入点未切）

## 测试计划

- 修改 `tests/server/heartbeat-harness.test.ts`：
  - mock 增 `harnessDeviceSync.upsert`；「persists a fully validated snapshot」改断言 upsert 载荷；「legacy heartbeat liveness-only」增断言 upsert 未调用
  - 321-334 的 migration 守卫 describe：删除对 schema 含三列的断言（324-330 会翻红），改为断言 schema 含 `model HarnessDeviceSync`；旧迁移文件 `20260730000000_add_harness_sync_diagnostics` 的断言保留（历史迁移不动）；新增对新迁移 SQL 的机械断言（CREATE ×1 / INSERT...SELECT ×1 / DROP COLUMN ×3）
- 新增 `tests/server/harness-device-sync.test.ts`：`getDeviceSummary` 输出三键形状冻结（mock prisma，值源于 harnessSync 关系）；`getDeviceDetail` include 路径
- 零修改回归基线：`tests/shared/harness-health.test.ts`（纯函数层不动的证明）
- F004 演练脚本可落 `scripts/test/`（evaluator 允许写入区）

## 依赖与前置

- **依赖先行：无硬依赖。** 可独立启动；与 BL-GATE-INBOX / BL-TRANSITION-LOG / BL-COST-BATCH-V1（HarnessProject/HarnessGate 侧）无文件交集
- **应先于：** BL-LIVE-SESSION（设备级实时态若先做，大概率又往 Device 或旧列语义上长）；BL-PERF-ANALYTICS 若涉及设备健康时序也应在其后
- **冲突提醒：** 与任何同期改 `app/api/devices/heartbeat/route.ts` 或 `tests/server/heartbeat-harness.test.ts` 的批次（如 BL-AGENT-LATENCY 的服务端部分，若有）串行安排，避免合并税

## 风险与对策

| 风险 | 对策 |
|---|---|
| 部署窗口内旧进程读已删列报错（秒级） | migration 单事务原子提交；build 先于 migrate 完成使窗口最小化；健康检查兜底；心跳失败由 agent 60s tick 自愈。若不可接受，备选两批次 expand/contract（先双写后删列），代价是两次部署——默认不采用，单操作员产品秒级窗口可承受 |
| 分次 push 导致「列已删、写入点未切」的中间态上线 | 铁律级要求：F001-F003 一次 push；F004 报告类产物走 paths-ignore 目录不触发部署 |
| 现网存在部分列非空的畸形行导致平移丢数据 | 写入点分析证明三列同写（route.ts:151-165 同一 `if (accepted)`/`if (harness)` 块）；F004 在现网形状数据上演练并数行守恒 |
| `/api/devices`、`/api/summary` 下游（页面、潜在外部调用者）形状漂移 | F003 在聚合层保形状，三键名不变；新增形状冻结测试 |
| `getDeviceSummary` 的 30s `unstable_cache`（summaries.ts:1122）缓存新旧形状混合 | 形状不变故无影响；部署重启本身清进程内缓存 |
| heartbeat 事务内新表 upsert 与 harness report 路由死锁 | report 路由（app/api/harness/report/route.ts）不触新表；锁序仍为 Device→DeviceToken 在前，新表最后，与现有注释约定一致 |

## 规模估计

**M（偏小）** · 4 features（3 generator + 1 evaluator） · 产品文件 6（schema.prisma、migration.sql 新建、heartbeat route、summaries.ts、harness/page.tsx、devices/[id]/page.tsx）+ 测试文件 2（heartbeat-harness.test.ts 改、harness-device-sync.test.ts 新建）+ spec/报告 3（`docs/specs/BL-DEVICE-DECOUPLE-spec.md`、test-cases、signoff）。不确定项已核清：`app/devices/page.tsx` 与 `src/shared/harness-health.ts`、`src/cli/**` 确认零改动（grep 全量核对过）。