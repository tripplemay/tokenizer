# Data-Path Migration Batch Checklist

> **Source:** BL-030-kb-asset-bridge-migration（2026-05-04，KB→Asset 数据通路完整迁移；ADR-011 BL-025 scope miss 后续修复）
> **When to use:** 当批次涉及"老数据通路 → 新数据通路"的迁移（不只是新功能开发），即同时存在：
> - 既有运行时代码写入旧位置（旧 schema / 旧字段 / 旧表）
> - 已有历史数据沉淀在旧位置
> - 新位置已存在或本批次同时建立
> - 读取端需要切到新位置
>
> 例：JSON 字段 → 关联表 / 单表 → 多表拆分 / EmailTemplate → Asset / Audit log v1 → v2 等。

---

## 一、Spec 起草必含五段（缺一会被 Reviewer Soft-watch）

### 1. 三段式数据字段处置决策

新批次必须显式声明老字段（如 `Product.aiAssets` JSONB）的处置路径，三选一并写入 spec §"关键设计决策"：

| 方案 | 含义 | 适用场景 |
|---|---|---|
| **A. 缩水保留** | 字段保留，但内容字段不再写入；仅留状态/索引 | **默认推荐** — 字段还有功能价值（pending 状态追踪 / 外键索引），低风险，回滚易 |
| **B. 完全删除** | Schema migration drop column | 字段无遗留价值且观察期满；**必须**作为独立后续批次，不与本批次同发 |
| **C. 双写保留** | 老字段+新位置同时写 | 仅在跨服务长期兼容期才用；**否决**默认（数据双源风险） |

**铁律：** A 方案必须明文写"deferred to next sprint 后清理批次（drop column）"，避免无限期保留。

### 2. Backfill 脚本必含规约

`scripts/migrate-<source>-to-<target>.ts`，4 项硬要求：

- ✅ **`--execute` 标志开实跑**，默认 dry-run（仅打印 stats，不写 DB）
- ✅ **idempotent** — 用 `metadata.backfilledFrom` 标记区分；重跑不重复插
- ✅ **withPlatformAdmin 扫全 tenant，withTenant 写每条**（RLS 必需）
- ✅ **统计输出**：扫描数 / 跳过 / 创建 / 失败，写入 stdout 显式四行

### 3. 命名工具同源（生成路径 + Backfill 路径必须共享 helper）

新数据条目（无论是新生成还是 backfill）的 `name` / `metadata` shape 必须由**同一 helper 函数**产出，否则 Reviewer 会发现两路径生成的数据形态不一致：

```ts
// src/lib/<feature>/naming.ts
export function deriveAssetName(input, type, index) { ... }
export function deriveAssetMetadata(input, type, index, opts) { ... }
```

新生成代码 + backfill script 都 import 此 helper。

### 4. Deploy checklist 硬编码当前数据快照

`docs/specs/<batch>-deploy-checklist.md` 必须**列明执行 backfill 时的 prod 数据列表**：

```markdown
## Prod 影响范围（{date} pg_dump 快照）

| product_id | name | tenant_id | 预期生成 Asset 数 |
|---|---|---|---|
| cmom...3zls | Clash Royale | 2b1d...3d5 | 5 |
| ... | ... | ... | ... |
| **总计** | 5 product | 1 tenant | **35 Asset** |
```

backfill 跑完后用户可一对一核对。

### 5. Rollback DELETE 幂等

spec §"风险与回滚"必须包含一条**精确的 DELETE 语句**用 `metadata.backfilledFrom` 标记快速删除全部 backfill 产物：

```sql
DELETE FROM <target_table>
WHERE metadata->'backfilledFrom' IS NOT NULL;
-- 跑完后 Product.aiAssets 字段需从 pg_dump 恢复
```

---

## 二、Generator 实装必含

- 老字段写入路径**全部**清除（grep 验证 `git diff` 不含 `<oldField>` 写入）
- 新写路径在 `withTenant` tx 内（避 RLS 阻写）
- audit log 调用与同 codebase 同类操作对齐（如 `asset.generated` 与 /assets Wizard 一致）
- TypeScript 类型同步缩水（删旧 content 字段类型，避免 future write-site 误用）

---

## 三、Reviewer L2 验收必查

- 跑 backfill dry-run → stats 与 spec §1.4 deploy-checklist 数字一致
- 跑 backfill `--execute` → 预期 N 条创建
- 跑 backfill `--execute` 第二次 → stats 中 "Created: 0, Skipped: N"（idempotent 验证）
- 数据库直查老字段：`SELECT count(*) FROM <table> WHERE <oldField> IS NOT NULL` + 验证缩水后形态匹配 spec §3.4
- 浏览器 E2E：从触发新生成的入口（如 KB 页面 Generate）→ 数据出现在新位置（如 /assets 库）

---

## 四、Planner done 收尾必做

- 检查 deploy-checklist 是否被用户实际跑过（prod DB count 老字段是否清干净）
- 没跑 backfill 前**不能切下一批次**（老数据仍隐形）
- 1 sprint 后开 cleanup 子批次：drop 老字段（如本批次选 A 方案）
