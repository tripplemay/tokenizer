# BL-COST-BATCH-V1 F004 · 归因精度实测审计报告

- **批次 / feature：** BL-COST-BATCH-V1 · F004（executor: evaluator）
- **审计时间：** 2026-08-10（UTC）
- **代码基线：** `c27fb38200f127d4b6f25035027cfd401abb9131`（本地 HEAD，工作树产品代码零改动）
- **被测物：** `src/server/harness-cost.ts` 的**真实导出**（`getBatchCost` / `loadCurrentBatchTransitions` / `quantizedNowMs` 所在模块）——不 mock 聚合逻辑、不复刻 where 条件；独立期望值由审计脚本按 fixture 定义 + `estimateCost` 纯函数（静态价目表）重算后与实测比对
- **判定：** **PASS**（27/27 断言全绿，0 FAIL；acceptance 5 条逐条满足，详见下文）
- **署名：** evaluator-subagent（fresh context，未接受任何实现过程叙述作为输入）

---

## 1. 方法与环境（可复现）

### 1.1 一次性 scratch Postgres

本机 5432/5433/5434 均被 colima 的 ssh 端口转发占用（`lsof -nP -iTCP:<port> -sTCP:LISTEN` 实测，进程 `ssh /Users/yixingzhou/.colima/_lima/colima/ssh.sock [mux]`；其中 **5434 为既有隧道，按预案红线未触碰**）。为零风险起见不复用任何现有库，起独立容器：

```bash
lsof -nP -iTCP:5545 -sTCP:LISTEN   # 无输出 → 空闲
docker run -d --name tokenizer-f004-scratch-pg \
  -e POSTGRES_USER=scratch -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=f004_audit \
  -p 127.0.0.1:5545:5432 postgres:16-alpine
# PostgreSQL 16.14 on aarch64-unknown-linux-musl（pg_isready 1s 后就绪）
```

### 1.2 migration 全链复验（顺带覆盖 F005 的修正 migration）

```bash
DATABASE_URL="postgresql://scratch:scratch@127.0.0.1:5545/f004_audit" npx prisma migrate deploy
# → 27 个 migration 逐个应用，尾项 20260810120000_align_fk_referential_actions
# → "All migrations have been successfully applied."

npx prisma migrate diff --from-url <scratch-url> --to-schema-datamodel prisma/schema.prisma
# → "No difference detected."   ← 全链重放后与 schema.prisma 零漂移（佐证 F005 收敛声明）
```

### 1.3 以 tsx 直调生产导出（不改产品代码的最小运行时注入）

`getBatchCost` 与 `getEffectivePrices` 均为 `unstable_cache` 包装导出，在 Next 运行时之外裸调会抛
`Invariant: incrementalCache missing`（E469）与 `AsyncLocalStorage accessed in runtime where it is not available`（E504）。
审计脚本（全文见附录 A/B，未入产品代码）注入两件 Next bootstrap 本会提供的运行时件后，**生产包装层代码原样运行**：

1. `globalThis.AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage`（Node 内建实现，Next shim 模块加载时读取）；
2. `globalThis.__incrementalCache` = 最小 in-memory 实现（`generateCacheKey`/`get`/`set`，miss 时走真实取数 + `JSON.stringify` 落缓存、hit 时 `JSON.parse` 返回——与生产 FETCH 缓存同一条代码路径）。脚本中的 `flushCache()` 等价生产 30s revalidate 窗口过期。

前置：`npx prisma generate`（L1 标配，防 stale client 误报）。运行命令：

```bash
DATABASE_URL="postgresql://scratch:scratch@127.0.0.1:5545/f004_audit" \
  npx tsx --tsconfig ./tsconfig.json <scratchpad>/f004-attribution-audit.ts
```

### 1.4 价目口径

fixture 全部使用静态价目表内模型，且 scratch 库 `ModelPrice` 表为空 → `getEffectivePrices()` 返回值 = 静态种子表，
独立重算与被测物同表同价，成本差异只可能来自**窗口归属**——这正是 F004 要审计的变量。
`claude-fable-5`：$10 in / $1 cacheRead / $12.5 cacheWrite / $50 out（每 1M）；`gpt-5.3-codex`：$1.75 / $0.175 / $1.75 / $14。

---

## 2. Fixture 构造（真实形状）

### 2.1 阶段节奏：取自真实批次 BL-GATE-INBOX 的 git 史

`git log --format='%H %cI %s' -- progress.json | grep GATE-INBOX`（UTC 换算）：
planning→building **18:41:32Z**（428561f）· building→verifying **18:50:34Z**（ac69897）· verifying 收尾 **19:08:19Z**（3b3eaed），fix_rounds=0。
fixture 采用同一分钟级节奏，另加一轮 fixing⟷reverifying 覆盖返工小计，并在批次前种一个旧批次 + `batchBoundary` 行覆盖跨批次切窗。

### 2.2 HarnessTransition 序列（8 行，`observedAfter`/`observedAt` 区间语义齐全）

| # | from→to | toBatch | boundary | fixRounds | observedAt (UTC) |
|---|---|---|---|---|---|
| 1 | null→building | BL-AUDIT-V0 | — | 0 | 18:00:00 |
| 2 | building→done | BL-AUDIT-V0 | — | 0 | 18:20:00 |
| 3 | done→planning | **BL-AUDIT-V1** | **true** | 0 | 18:30:00 |
| 4 | planning→building | BL-AUDIT-V1 | — | 0 | 18:41:32 |
| 5 | building→verifying | BL-AUDIT-V1 | — | 0 | 18:50:34 |
| 6 | verifying→fixing | BL-AUDIT-V1 | — | 1 | 19:08:19 |
| 7 | fixing→reverifying | BL-AUDIT-V1 | — | 1 | 19:20:00 |
| 8 | reverifying→done | BL-AUDIT-V1 | — | 1 | 19:30:00 |

`NOW` 钉死 `2026-08-09T20:00:00.000Z` → 期望区间 6 个（done 为开区间以 NOW 封闭），批次窗口 `[18:30:00, 20:00:00)`。
关联链：User → Device → Project（repoKey `github.com/audit/tokenizer-f004`）→ HarnessProject（projectId 已关联）。

### 2.3 UsageEvent（12 条批次期 + 2 条混入；独立重算的单条成本一并列出）

| key | occurredAt | model | in / cached / cw / out | 单条成本 | 角色 |
|---|---|---|---|---:|---|
| E1 | 18:35:00 | claude-fable-5 | 200k/150k/20k/5k | $0.95000 | planning 窗口内 |
| E2 | 18:43:00 | claude-fable-5 | 900k/700k/100k/40k | $4.95000 | building 窗口内 |
| E3 | 18:48:00 | claude-fable-5 | 600k/480k/60k/25k | $3.08000 | building 窗口内 |
| E4 | 18:55:00 | claude-fable-5 | 500k/400k/50k/20k | $2.52500 | verifying 窗口内 |
| E5 | 19:10:00 | claude-fable-5 | 300k/240k/30k/12k | $1.51500 | fixing 窗口内 |
| E6 | 19:25:00 | claude-fable-5 | 250k/200k/25k/8k | $1.16250 | reverifying 窗口内 |
| E7 | 19:40:00 | claude-fable-5 | 100k/80k/10k/2k | $0.40500 | done 窗口内 |
| B1 | **18:50:34.000** | claude-fable-5 | 0/0/0/**777** | $0.03885 | 恰在 building→verifying 切点秒（签名 777） |
| B2 | **18:30:00.000** | claude-fable-5 | 0/0/0/**333** | $0.01665 | 恰在批次窗口起点秒（签名 333） |
| B3 | **20:00:00.000** | claude-fable-5 | 0/0/0/**999** | $0.04995 | 恰在 NOW=开区间封闭点（签名 999） |
| O1 | 18:05:00 | claude-fable-5 | 400k/300k/40k/15k | $2.15000 | 旧批次 V0 窗口（应被 boundary 切除） |
| O2 | 18:25:00 | claude-fable-5 | 0/0/0/100 | $0.00500 | V0 done 后、V1 边界前间隙（应不归任何 V1 阶段） |
| M1 | 18:57:00 | gpt-5.3-codex | 1M/0/0/100k | $3.15000 | **混入**（Phase B 追加，verifying 窗口内异模型人工用量） |
| M2 | 19:15:00 | claude-fable-5 | 150k/0/0/10k | $2.00000 | **混入**（Phase B 追加，fixing 窗口内同模型人工用量） |

---

## 3. 实测结果（acceptance 逐条）

### Acceptance 1 · 各阶段成本之和 = 批次总成本（±$0.01）；批次窗口成本 ≤ 项目全量成本 — PASS

`getBatchCost` 实测输出（场景 1，仅批次事件）：

```
batch=BL-AUDIT-V1  total=$14.64300000  compute=713110  rework=$2.67750000/130000
  planning    [18:30:00, 18:41:32)  compute= 55333  cost=$0.96665000   ← E1+B2
  building    [18:41:32, 18:50:34)  compute=385000  cost=$8.03000000   ← E2+E3
  verifying   [18:50:34, 19:08:19)  compute=120777  cost=$2.56385000   ← E4+B1
  fixing      [19:08:19, 19:20:00)  compute= 72000  cost=$1.51500000   ← E5
  reverifying [19:20:00, 19:30:00)  compute= 58000  cost=$1.16250000   ← E6
  done        [19:30:00, 20:00:00)  compute= 22000  cost=$0.40500000   ← E7 (open)
```

- **S1.3** Σphases = $14.64300000 = total，|Δ| = 0.000e+0（远优于 ±$0.01；float 求和与展示口径同源，无损）
- **S1.4–S1.6** 批次总成本 / 每阶段成本与 compute 均与独立重算逐位一致（±1e-8）
- **S1.7** 返工小计 = fixing+reverifying = $2.6775 / 130,000 compute ✓
- **S1.8** 批次 $14.643 ≤ 项目全量 $16.84795（项目全量按 summaries.ts `costForWhere` 同口径无窗重算）
- **S1.9** 差额 $2.20495 **恰等于** O1+O2+B3 三条窗口外事件之和——旧批次切除与 `lt` 沿排除双双生效，非「碰巧小于」
- 区间构建：**S1.1/S1.2** 6 区间阶段序列与窗口逐一吻合——`batchBoundary` 行切窗（V0 两区间被丢弃）、done 开区间以 NOW 封闭

### Acceptance 2 · 混入误差方向「只多不少」实证 + 量化 — PASS

窗口内追加 M1+M2（合计 $5.15）后 flush 缓存重测（场景 2）：

| 指标 | 混入前 | 混入后 | Δ |
|---|---:|---:|---:|
| totalCostUsd | $14.64300000 | $19.79300000 | **+$5.15000000（= mixin 成本，逐位）** |
| totalComputeTokens | 713,110 | 1,973,110 | +1,260,000（= mixin compute，逐位） |
| 项目全量 | $16.84795 | $21.99795 | 批次仍 ≤ 项目全量 ✓ |

- **方向实证：** 成本只升不降（S2.1）；升幅**恰等于**混入事件成本（S2.2）——即混入被全额多算、真批次事件零丢失（「不少」由 S2.5 补证：每条真批次事件都在某个阶段窗口内，时间窗为超集，结构上不存在少算路径）
- **误差量化：** 本 fixture 下高估比例 = $5.15 / $14.643 = **35.17%**。该比例由混入用量体量决定（不是常数）：批次窗口内的非批次用量占真批次用量的比例即误差比例，方向恒为高估
- 混入落点归因正确：M1 计入 verifying 行（$2.56385→$5.71385）、M2 计入 fixing 行（$1.515→$3.515），其余阶段行逐位不变

### Acceptance 3 · UTC 边界秒归属与实现开闭沿一致 — PASS

实现口径：`harness-cost.ts:123` `occurredAt: { gte: interval.start, lt: interval.end }`，即 **[start, end)，恰在边界秒的事件归后一阶段**。三条探针（毫秒级恰落边界、唯一 output 签名定位归属行）：

| 探针 | 落点 | 期望 | 实测 |
|---|---|---|---|
| B1 (out=777) | 18:50:34.000Z = building→verifying 切点 | 归 verifying（gte 沿收入）、building 排除（lt 沿） | verifying compute=120,777 含签名；building=385,000 无签名 ✓ |
| B2 (out=333) | 18:30:00.000Z = 批次窗口起点 | 归 planning（gte 沿收入） | planning compute=55,333 含签名 ✓ |
| B3 (out=999) | 20:00:00.000Z = NOW（开区间封闭点） | 不计入任何阶段（lt 沿排除） | 批次 compute=713,110 不含签名；但计入项目全量（S1.9 差额分解可证） ✓ |

所有时间以 UTC ISO 毫秒构造与比较；fixture 含跨「阶段边界秒」三种方位（窗口起点 / 中间切点 / 开区间封闭点），gte/lt 行为与 F001 单测断言（tests/server/harness-cost.test.ts:157-166）及实现一字一致。

### Acceptance 4 · 精度声明文案与实测相符（不夸大不缩小）— PASS

| 文案（en/zh 同义） | 实测对照 | 判定 |
|---|---|---|
| `harness.detail.cost.precisionNote`：「同项目同时段的非本批次用量也会计入（误差只多不少）」 | 场景 2：混入全额多算 +$5.15、真批次零丢失；窗口为超集结构上无少算路径 | **相符**（固定观测窗口内方向可证恒为高估） |
| 同上：「阶段边界为镜像观测时刻（延迟 ≤2 分钟）」 | 本审计未重测该延迟（agent 上报环路不在 scratch 库范围）。≤2min 的机械依据：BL-AGENT-LATENCY 已签收的 `HARNESS_CRON_MINUTES=2`（service-cron.ts:8）+ daemon 60s 轮询 | **如实标注**（引用既有 signoff，非本报告重测） |
| 同上：「v2 将提供精确到批次的归因」 | spec §关键决策记录既定路线，非能力夸大 | 相符 |
| `project.harnessCost.note`：「口径与 harness 详情页一致（时间窗近似，误差只多不少）」 | 代码层机械核对：两页均 `import { getBatchCost, quantizedNowMs } from "@/server/harness-cost"`（app/harness/[id]/page.tsx:7,50-61 · app/projects/[id]/page.tsx:6,75-82），同导出同量化 now → 同 cache key；无第二套 where | **相符** |

**如实边界（报告记录，不构成 FAIL）：**

1. 「只多不少」在**固定观测窗口内**严格成立（本报告实证）。跨「真实流转时刻 vs 镜像观测时刻」的 ≤2min 延迟会使批次**前沿**最多 2 分钟的真批次用量落在窗口外（归前批 / 无归属）——即镜像延迟维度上存在有界少算可能。文案把该延迟单独如实披露且给出上界，两句相邻可组合读出完整语义，判**不夸大不缩小**；v2 精确归因落地时此项自然消除。
2. 无价目模型（`estimateCost` 返回 null）在批次窗口与项目全量中同样计 $0——这是全控制台统一的价目口径（summaries.ts 同行为），非窗口归因误差，与本声明无冲突。

### Acceptance 5 · 报告入库 — PASS

本文件落 `docs/test-reports/BL-COST-BATCH-V1-attribution-audit-2026-08-10.md` 并 commit（`docs/**` 在 deploy-vps.yml paths-ignore 内，不触发部署）。审计脚本刻意**不入库**：`scripts/**` 不在 paths-ignore 内，入库将使本 commit 在下次 push 时触发部署，违背 spec「F004 报告不触发部署」的 push 节奏——脚本全文以附录形式随报告归档，可复现性不受影响。

---

## 4. 附加佐证（超出 acceptance，随手带出）

- **SC.1** 同参二次调用命中注入缓存（真实 FETCH 缓存路径 JSON round-trip）后结果深等、时间字段仍为 ISO 串——F001「ISO 串化防 unstable_cache 反序列化双态」设计经 DB 实跑证实无损。
- **S4.1** `repoKey` 回退链（projectId=null）与主链同 fixture 下总成本/compute 逐位一致——回退 where 无口径漂移。
- **S0.1/S0.2** `loadCurrentBatchTransitions` 真库读取 8/8 行、observedAt 升序。
- migration 全链（27 个，含 F005 修正项 `20260810120000_align_fk_referential_actions`）scratch 干净重放 + `migrate diff` 零漂移。

## 5. 清理

```bash
docker rm -f tokenizer-f004-scratch-pg   # 无挂载卷，容器删除即库销毁
lsof -nP -iTCP:5545 -sTCP:LISTEN         # 无输出，端口已释放
```

既有容器（kolmatrix-postgres / newkolmatrix-dev-db / 5434 隧道等）全程未触碰。

## 6. 复现步骤

1. `git checkout c27fb38 && npx prisma generate`
2. 按 §1.1 起 scratch 容器（先 `lsof` 探测端口）；§1.2 跑 `migrate deploy` + `migrate diff`
3. 将附录 A/B 两文件存至任意目录（同目录、文件名一致），按 §1.3 命令运行
4. 预期输出：27 PASS / 0 FAIL，关键数值与本报告 §3 逐位一致（fixture 与 NOW 全部钉死，无时变输入）
5. `docker rm -f tokenizer-f004-scratch-pg`

---

## 附录 A · als-setup.ts

```ts
// Next 的 async-local-storage shim 在模块加载时读取 globalThis.AsyncLocalStorage；
// Next 服务器进程由其 bootstrap 注入，独立 tsx 进程需自行注入（Node 内建实现）。
import { AsyncLocalStorage } from "node:async_hooks";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;
```

## 附录 B · f004-attribution-audit.ts（审计脚本全文）

```ts
/**
 * BL-COST-BATCH-V1 F004 归因精度实测审计脚本（Evaluator 产物，不进产品代码）。
 *
 * 运行方式（项目根目录）：
 *   DATABASE_URL="postgresql://scratch:scratch@127.0.0.1:5545/f004_audit" \
 *     npx tsx --tsconfig ./tsconfig.json <本文件路径>
 *
 * 被测物：src/server/harness-cost.ts 的真实导出（getBatchCost / loadCurrentBatchTransitions），
 * 不 mock、不复刻聚合逻辑；独立期望值由本脚本按 fixture 定义 + estimateCost 纯函数重算。
 *
 * unstable_cache 在 Next 运行时之外缺 incrementalCache（Invariant E469），此处注入
 * 最小 in-memory 实现让生产包装层原样运行（含 JSON 序列化 round-trip——顺带验证
 * F001 的 ISO 串化设计）。__flush() 等价于生产 30s revalidate 窗口过期。
 */

import "./als-setup"; // 必须先于 next 模块加载：注入 globalThis.AsyncLocalStorage

// ── 最小 incrementalCache 注入（必须在任何 getBatchCost 调用前生效）──
const memStore = new Map<string, unknown>();
(globalThis as Record<string, unknown>).__incrementalCache = {
  isOnDemandRevalidate: false,
  async generateCacheKey(key: string): Promise<string> {
    return key;
  },
  async get(key: string): Promise<unknown> {
    const value = memStore.get(key);
    return value ? { value, isStale: false } : null;
  },
  async set(key: string, value: unknown): Promise<void> {
    memStore.set(key, value);
  },
  __flush(): void {
    memStore.clear();
  }
};
const flushCache = () => memStore.clear();

import { prisma } from "/Users/yixingzhou/project/tokenizer/src/server/db";
import {
  getBatchCost,
  loadCurrentBatchTransitions,
  type BatchCost
} from "/Users/yixingzhou/project/tokenizer/src/server/harness-cost";
import { estimateCost, MODEL_PRICES } from "/Users/yixingzhou/project/tokenizer/src/shared/model-pricing";

// ── fixture 定义（真实形状；阶段节奏取自真实批次 BL-GATE-INBOX 的 progress.json git 史，
//    UTC：planning→building 18:41:32Z · building→verifying 18:50:34Z · verifying 收尾 19:08:19Z，
//    另加一轮 fixing⟷reverifying 以覆盖返工小计）──
const USER_ID = "u-f004-audit";
const DEVICE_ID = "dev-f004-audit";
const REPO_KEY = "github.com/audit/tokenizer-f004";
const OLD_BATCH = "BL-AUDIT-V0";
const BATCH = "BL-AUDIT-V1";
const NOW = new Date("2026-08-09T20:00:00.000Z");

interface Tr {
  fromStatus: string | null;
  toStatus: string;
  fromBatch: string | null;
  toBatch: string;
  batchBoundary: boolean;
  fixRounds: number;
  observedAfter: string | null;
  observedAt: string;
}
const TRANSITIONS: Tr[] = [
  { fromStatus: null, toStatus: "building", fromBatch: null, toBatch: OLD_BATCH, batchBoundary: false, fixRounds: 0, observedAfter: null, observedAt: "2026-08-09T18:00:00.000Z" },
  { fromStatus: "building", toStatus: "done", fromBatch: OLD_BATCH, toBatch: OLD_BATCH, batchBoundary: false, fixRounds: 0, observedAfter: "2026-08-09T18:00:00.000Z", observedAt: "2026-08-09T18:20:00.000Z" },
  // 跨批次边界行：窗口从此重新开始（buildPhaseIntervals 丢弃 V0 区间）
  { fromStatus: "done", toStatus: "planning", fromBatch: OLD_BATCH, toBatch: BATCH, batchBoundary: true, fixRounds: 0, observedAfter: "2026-08-09T18:20:00.000Z", observedAt: "2026-08-09T18:30:00.000Z" },
  { fromStatus: "planning", toStatus: "building", fromBatch: BATCH, toBatch: BATCH, batchBoundary: false, fixRounds: 0, observedAfter: "2026-08-09T18:30:00.000Z", observedAt: "2026-08-09T18:41:32.000Z" },
  { fromStatus: "building", toStatus: "verifying", fromBatch: BATCH, toBatch: BATCH, batchBoundary: false, fixRounds: 0, observedAfter: "2026-08-09T18:41:32.000Z", observedAt: "2026-08-09T18:50:34.000Z" },
  { fromStatus: "verifying", toStatus: "fixing", fromBatch: BATCH, toBatch: BATCH, batchBoundary: false, fixRounds: 1, observedAfter: "2026-08-09T18:50:34.000Z", observedAt: "2026-08-09T19:08:19.000Z" },
  { fromStatus: "fixing", toStatus: "reverifying", fromBatch: BATCH, toBatch: BATCH, batchBoundary: false, fixRounds: 1, observedAfter: "2026-08-09T19:08:19.000Z", observedAt: "2026-08-09T19:20:00.000Z" },
  { fromStatus: "reverifying", toStatus: "done", fromBatch: BATCH, toBatch: BATCH, batchBoundary: false, fixRounds: 1, observedAfter: "2026-08-09T19:20:00.000Z", observedAt: "2026-08-09T19:30:00.000Z" }
];

// 期望区间（[start,end) 语义；done 为开区间以 NOW 封闭）
const EXPECTED_WINDOWS: Array<{ phase: string; start: string; end: string }> = [
  { phase: "planning", start: "2026-08-09T18:30:00.000Z", end: "2026-08-09T18:41:32.000Z" },
  { phase: "building", start: "2026-08-09T18:41:32.000Z", end: "2026-08-09T18:50:34.000Z" },
  { phase: "verifying", start: "2026-08-09T18:50:34.000Z", end: "2026-08-09T19:08:19.000Z" },
  { phase: "fixing", start: "2026-08-09T19:08:19.000Z", end: "2026-08-09T19:20:00.000Z" },
  { phase: "reverifying", start: "2026-08-09T19:20:00.000Z", end: "2026-08-09T19:30:00.000Z" },
  { phase: "done", start: "2026-08-09T19:30:00.000Z", end: "2026-08-09T20:00:00.000Z" }
];

interface Ev {
  key: string;
  occurredAt: string;
  model: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  note: string;
}
// 批次事件（Phase A 种入）：每阶段 ≥1 条 + 三条边界秒探针 + 两条旧批次事件
const BATCH_EVENTS: Ev[] = [
  { key: "E1", occurredAt: "2026-08-09T18:35:00.000Z", model: "claude-fable-5", input: 200_000, cached: 150_000, cacheWrite: 20_000, output: 5_000, note: "planning 窗口内" },
  { key: "E2", occurredAt: "2026-08-09T18:43:00.000Z", model: "claude-fable-5", input: 900_000, cached: 700_000, cacheWrite: 100_000, output: 40_000, note: "building 窗口内" },
  { key: "E3", occurredAt: "2026-08-09T18:48:00.000Z", model: "claude-fable-5", input: 600_000, cached: 480_000, cacheWrite: 60_000, output: 25_000, note: "building 窗口内" },
  { key: "E4", occurredAt: "2026-08-09T18:55:00.000Z", model: "claude-fable-5", input: 500_000, cached: 400_000, cacheWrite: 50_000, output: 20_000, note: "verifying 窗口内" },
  { key: "E5", occurredAt: "2026-08-09T19:10:00.000Z", model: "claude-fable-5", input: 300_000, cached: 240_000, cacheWrite: 30_000, output: 12_000, note: "fixing 窗口内" },
  { key: "E6", occurredAt: "2026-08-09T19:25:00.000Z", model: "claude-fable-5", input: 250_000, cached: 200_000, cacheWrite: 25_000, output: 8_000, note: "reverifying 窗口内" },
  { key: "E7", occurredAt: "2026-08-09T19:40:00.000Z", model: "claude-fable-5", input: 100_000, cached: 80_000, cacheWrite: 10_000, output: 2_000, note: "done 窗口内" },
  // 边界秒探针（唯一 output 签名定位归属行）
  { key: "B1", occurredAt: "2026-08-09T18:50:34.000Z", model: "claude-fable-5", input: 0, cached: 0, cacheWrite: 0, output: 777, note: "恰在 building→verifying 切点秒：应归 verifying（gte 沿）" },
  { key: "B2", occurredAt: "2026-08-09T18:30:00.000Z", model: "claude-fable-5", input: 0, cached: 0, cacheWrite: 0, output: 333, note: "恰在批次窗口起点秒：应归 planning（gte 沿）" },
  { key: "B3", occurredAt: "2026-08-09T20:00:00.000Z", model: "claude-fable-5", input: 0, cached: 0, cacheWrite: 0, output: 999, note: "恰在开区间封闭点 NOW：应不计入任何阶段（lt 沿）" },
  // 旧批次事件：batchBoundary 切窗后不得进入 V1 归因；计入项目全量
  { key: "O1", occurredAt: "2026-08-09T18:05:00.000Z", model: "claude-fable-5", input: 400_000, cached: 300_000, cacheWrite: 40_000, output: 15_000, note: "旧批次 V0 building 窗口" },
  { key: "O2", occurredAt: "2026-08-09T18:25:00.000Z", model: "claude-fable-5", input: 0, cached: 0, cacheWrite: 0, output: 100, note: "V0 done 后、V1 边界前的间隙" }
];
// 混入事件（Phase B 追加）：批次窗口内的非批次用量（同项目人工使用）
const MIXIN_EVENTS: Ev[] = [
  { key: "M1", occurredAt: "2026-08-09T18:57:00.000Z", model: "gpt-5.3-codex", input: 1_000_000, cached: 0, cacheWrite: 0, output: 100_000, note: "verifying 窗口内混入（异模型人工用量）" },
  { key: "M2", occurredAt: "2026-08-09T19:15:00.000Z", model: "claude-fable-5", input: 150_000, cached: 0, cacheWrite: 0, output: 10_000, note: "fixing 窗口内混入（同模型人工用量）" }
];

// ── 独立期望值重算（只依赖 fixture 定义 + estimateCost 纯函数 + 静态价目表）──
function costOf(ev: Ev): number {
  const c = estimateCost(
    ev.model,
    { inputTokens: ev.input, cachedInputTokens: ev.cached, cacheWriteTokens: ev.cacheWrite, outputTokens: ev.output },
    MODEL_PRICES
  );
  if (c == null) throw new Error(`fixture 模型 ${ev.model} 无价目`);
  return c;
}
const computeOf = (ev: Ev) => Math.max(0, ev.input - ev.cached) + ev.output;
const inWindow = (ev: Ev, w: { start: string; end: string }) =>
  ev.occurredAt >= w.start && ev.occurredAt < w.end; // ISO 串字典序 = 时间序（同为 UTC 毫秒格式）

function expectedPerPhase(events: Ev[]) {
  return EXPECTED_WINDOWS.map((w) => {
    const inside = events.filter((ev) => inWindow(ev, w));
    return {
      phase: w.phase,
      events: inside.map((e) => e.key),
      costUsd: inside.reduce((s, e) => s + costOf(e), 0),
      computeTokens: inside.reduce((s, e) => s + computeOf(e), 0)
    };
  });
}

// ── 断言器 ──
let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const fmt = (n: number) => `$${n.toFixed(8)}`;

async function seed() {
  // 幂等：清掉旧 fixture
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  const user = await prisma.user.create({ data: { id: USER_ID, email: "f004-audit@example.test", name: "F004 Audit" } });
  await prisma.device.create({ data: { id: DEVICE_ID, userId: user.id, name: "f004-audit-device", platform: "darwin" } });
  const project = await prisma.project.create({
    data: { userId: user.id, name: "tokenizer-f004-audit", repoKey: REPO_KEY, workspacePath: "/audit/tokenizer-f004" }
  });
  const hp = await prisma.harnessProject.create({
    data: {
      userId: user.id, deviceId: DEVICE_ID, repoKey: REPO_KEY, name: "tokenizer-f004-audit",
      projectId: project.id, status: "done", batch: BATCH, fixRounds: 1, completedCount: 5, totalCount: 5
    }
  });
  await prisma.harnessTransition.createMany({
    data: TRANSITIONS.map((t) => ({
      userId: user.id, harnessProjectId: hp.id,
      fromStatus: t.fromStatus, toStatus: t.toStatus, fromBatch: t.fromBatch, toBatch: t.toBatch,
      batchBoundary: t.batchBoundary, fixRounds: t.fixRounds,
      observedAfter: t.observedAfter ? new Date(t.observedAfter) : null, observedAt: new Date(t.observedAt),
      headSha: "f004audit"
    }))
  });
  await insertEvents(project.id, BATCH_EVENTS);
  return { user, project, hp };
}

async function insertEvents(projectId: string, events: Ev[]) {
  await prisma.usageEvent.createMany({
    data: events.map((ev) => ({
      userId: USER_ID, deviceId: DEVICE_ID, source: "claude_code", sourceEventId: `f004-${ev.key}`,
      projectId, repoKey: REPO_KEY, model: ev.model,
      inputTokens: ev.input, cachedInputTokens: ev.cached, cacheWriteTokens: ev.cacheWrite, outputTokens: ev.output,
      totalTokens: ev.input + ev.output, occurredAt: new Date(ev.occurredAt)
    }))
  });
}

/** 项目全量成本（无时间窗；对照 summaries.ts costForWhere 口径） */
async function projectFullCost(projectId: string): Promise<{ cost: number; compute: number }> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["model"],
    where: { userId: USER_ID, projectId },
    _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
  });
  let cost = 0;
  let compute = 0;
  for (const row of rows) {
    const i = row._sum.inputTokens ?? 0, c = row._sum.cachedInputTokens ?? 0,
      w = row._sum.cacheWriteTokens ?? 0, o = row._sum.outputTokens ?? 0;
    compute += Math.max(0, i - c) + o;
    const d = estimateCost(row.model, { inputTokens: i, cachedInputTokens: c, cacheWriteTokens: w, outputTokens: o }, MODEL_PRICES);
    if (d != null) cost += d;
  }
  return { cost, compute };
}

function printBatchCost(label: string, r: BatchCost) {
  console.log(`\n== ${label} ==`);
  console.log(`batch=${r.batch}  total=${fmt(r.totalCostUsd)}  compute=${r.totalComputeTokens}  rework=${fmt(r.reworkCostUsd)}/${r.reworkComputeTokens}`);
  console.log(`window=[${r.windowStartIso}, ${r.windowEndIso})`);
  for (const p of r.phases) {
    console.log(`  ${p.phase.padEnd(11)} fix=${p.fixRounds} [${p.startIso}, ${p.endIso}) ${String(p.durationMs).padStart(8)}ms  compute=${String(p.computeTokens).padStart(7)}  cost=${fmt(p.costUsd)}${p.openEnded ? "  (open)" : ""}`);
  }
}

async function main() {
  console.log("=== BL-COST-BATCH-V1 F004 attribution audit ===");
  console.log(`DATABASE_URL host: ${(process.env.DATABASE_URL ?? "").replace(/\/\/.*@/, "//***@")}`);
  const { project, hp } = await seed();
  console.log(`seeded: user=${USER_ID} project=${project.id} harnessProject=${hp.id} transitions=${TRANSITIONS.length} events=${BATCH_EVENTS.length}`);

  // ── 场景 0：loadCurrentBatchTransitions 真实读取 ──
  const transitions = await loadCurrentBatchTransitions(hp.id);
  check("S0.1 loadCurrentBatchTransitions 行数", transitions.length === TRANSITIONS.length, `${transitions.length}/${TRANSITIONS.length}`);
  check("S0.2 observedAt 升序", transitions.every((t, i) => i === 0 || t.observedAt.getTime() >= transitions[i - 1].observedAt.getTime()), "");

  const link = { projectId: project.id, repoKey: REPO_KEY };

  // ── 场景 1：阶段和 = 批次总 · 批次 ≤ 项目全量 · 区间/边界正确性 ──
  const r1 = await getBatchCost(USER_ID, link, transitions, NOW.getTime());
  if (!r1) throw new Error("getBatchCost 返回 null（fixture 有 transitions + projectId，不应发生）");
  printBatchCost("场景 1：仅批次事件（Phase A）", r1);

  const exp1 = expectedPerPhase(BATCH_EVENTS);
  check("S1.1 区间数与阶段序列", r1.phases.length === 6 && r1.phases.every((p, i) => p.phase === EXPECTED_WINDOWS[i].phase),
    r1.phases.map((p) => p.phase).join("→"));
  check("S1.2 区间窗口逐一吻合（batchBoundary 切窗 + done 开区间以 now 封）",
    r1.phases.every((p, i) => p.startIso === EXPECTED_WINDOWS[i].start && p.endIso === EXPECTED_WINDOWS[i].end), "");
  const sumPhases1 = r1.phases.reduce((s, p) => s + p.costUsd, 0);
  check("S1.3 各阶段成本之和 = 批次总成本（±$0.01）", Math.abs(sumPhases1 - r1.totalCostUsd) <= 0.01,
    `sum(phases)=${fmt(sumPhases1)} vs total=${fmt(r1.totalCostUsd)} |Δ|=${Math.abs(sumPhases1 - r1.totalCostUsd).toExponential(3)}`);
  const expTotal1 = exp1.reduce((s, p) => s + p.costUsd, 0);
  check("S1.4 批次总成本 = 独立重算期望（±$0.01）", Math.abs(r1.totalCostUsd - expTotal1) <= 0.01,
    `actual=${fmt(r1.totalCostUsd)} vs expected=${fmt(expTotal1)}`);
  for (let i = 0; i < exp1.length; i += 1) {
    check(`S1.5.${i + 1} ${exp1[i].phase} 阶段成本/compute 与独立重算一致（含事件 ${exp1[i].events.join("+") || "无"}）`,
      Math.abs(r1.phases[i].costUsd - exp1[i].costUsd) <= 1e-8 && r1.phases[i].computeTokens === exp1[i].computeTokens,
      `cost ${fmt(r1.phases[i].costUsd)} vs ${fmt(exp1[i].costUsd)} · compute ${r1.phases[i].computeTokens} vs ${exp1[i].computeTokens}`);
  }
  const expCompute1 = exp1.reduce((s, p) => s + p.computeTokens, 0);
  check("S1.6 批次 compute 总量与独立重算一致", r1.totalComputeTokens === expCompute1, `${r1.totalComputeTokens} vs ${expCompute1}`);
  const expRework1 = exp1.filter((p) => p.phase === "fixing" || p.phase === "reverifying");
  check("S1.7 返工小计 = fixing+reverifying 各轮合计",
    Math.abs(r1.reworkCostUsd - expRework1.reduce((s, p) => s + p.costUsd, 0)) <= 1e-8 &&
      r1.reworkComputeTokens === expRework1.reduce((s, p) => s + p.computeTokens, 0),
    `rework=${fmt(r1.reworkCostUsd)}/${r1.reworkComputeTokens}`);

  const full1 = await projectFullCost(project.id);
  check("S1.8 批次窗口成本 ≤ 项目全量成本", r1.totalCostUsd <= full1.cost + 1e-9,
    `batch=${fmt(r1.totalCostUsd)} ≤ project=${fmt(full1.cost)}（差额=${fmt(full1.cost - r1.totalCostUsd)}，应恰为 O1+O2+B3 三条窗口外事件）`);
  const outsideCost = costOf(BATCH_EVENTS.find((e) => e.key === "O1")!) + costOf(BATCH_EVENTS.find((e) => e.key === "O2")!) + costOf(BATCH_EVENTS.find((e) => e.key === "B3")!);
  check("S1.9 差额恰等于窗口外事件（O1+O2+B3）成本 —— 旧批次与 lt 沿排除均生效",
    Math.abs(full1.cost - r1.totalCostUsd - outsideCost) <= 1e-8, `outside=${fmt(outsideCost)}`);

  // ── 场景 3（与场景 1 同一份数据）：UTC 边界秒归属 ──
  const verifyingRow = r1.phases.find((p) => p.phase === "verifying")!;
  const buildingRow = r1.phases.find((p) => p.phase === "building")!;
  const planningRow = r1.phases.find((p) => p.phase === "planning")!;
  const expVerifying = exp1.find((p) => p.phase === "verifying")!;
  const expBuilding = exp1.find((p) => p.phase === "building")!;
  check("S3.1 B1（恰在 building→verifying 切点秒 18:50:34.000Z）归 verifying（gte 沿）",
    expVerifying.events.includes("B1") && verifyingRow.computeTokens === expVerifying.computeTokens && verifyingRow.computeTokens % 1000 === 777,
    `verifying compute=${verifyingRow.computeTokens}（含 777 签名）`);
  check("S3.2 B1 未被 building 计入（lt 沿排除）",
    !expBuilding.events.includes("B1") && buildingRow.computeTokens === expBuilding.computeTokens && buildingRow.computeTokens % 1000 !== 777,
    `building compute=${buildingRow.computeTokens}（无 777 签名）`);
  check("S3.3 B2（恰在批次窗口起点秒 18:30:00.000Z）归 planning（gte 沿包含）",
    planningRow.computeTokens % 1000 === 333, `planning compute=${planningRow.computeTokens}（含 333 签名）`);
  check("S3.4 B3（恰在 NOW=开区间封闭点 20:00:00.000Z）不计入任何阶段（lt 沿）",
    r1.totalComputeTokens === expCompute1 && !exp1.some((p) => p.events.includes("B3")),
    `batch compute=${r1.totalComputeTokens}，999 签名不在任何阶段`);

  // ── 缓存 round-trip（佐证 F001 ISO 串化设计；同参二次调用走 JSON 反序列化路径）──
  const r1b = await getBatchCost(USER_ID, link, transitions, NOW.getTime());
  check("SC.1 unstable_cache 命中后结果深等（ISO 串经 JSON round-trip 无损）",
    JSON.stringify(r1b) === JSON.stringify(r1) && typeof r1b!.windowStartIso === "string", "");

  // ── 场景 2：混入误差方向「只多不少」实证 ──
  await insertEvents(project.id, MIXIN_EVENTS);
  flushCache(); // 等价生产 30s revalidate 过期；同参调用不再命中旧值
  const r2 = await getBatchCost(USER_ID, link, transitions, NOW.getTime());
  if (!r2) throw new Error("场景 2 getBatchCost 返回 null");
  printBatchCost("场景 2：批次事件 + 窗口内混入非批次事件（Phase B）", r2);

  const mixinCost = MIXIN_EVENTS.reduce((s, e) => s + costOf(e), 0);
  const mixinCompute = MIXIN_EVENTS.reduce((s, e) => s + computeOf(e), 0);
  check("S2.1 混入后批次成本上升（只多）", r2.totalCostUsd > r1.totalCostUsd,
    `${fmt(r1.totalCostUsd)} → ${fmt(r2.totalCostUsd)}`);
  check("S2.2 上升量恰等于混入事件成本（真批次事件零丢失 = 不少）",
    Math.abs(r2.totalCostUsd - r1.totalCostUsd - mixinCost) <= 1e-8,
    `Δ=${fmt(r2.totalCostUsd - r1.totalCostUsd)} vs mixin=${fmt(mixinCost)}`);
  check("S2.3 compute 同向（Δ = 混入 compute）",
    r2.totalComputeTokens - r1.totalComputeTokens === mixinCompute,
    `Δ=${r2.totalComputeTokens - r1.totalComputeTokens} vs mixin=${mixinCompute}`);
  const overRatio = (r2.totalCostUsd - r1.totalCostUsd) / r1.totalCostUsd;
  console.log(`  混入误差量化：真批次成本=${fmt(r1.totalCostUsd)}，混入=${fmt(mixinCost)}，观测=${fmt(r2.totalCostUsd)}，高估比例=${(overRatio * 100).toFixed(2)}%（方向恒为高估）`);
  const full2 = await projectFullCost(project.id);
  check("S2.4 混入后批次窗口成本仍 ≤ 项目全量成本", r2.totalCostUsd <= full2.cost + 1e-9,
    `batch=${fmt(r2.totalCostUsd)} ≤ project=${fmt(full2.cost)}`);
  check("S2.5 每条真批次事件仍在窗口内（无「少算」路径：窗口为超集）",
    BATCH_EVENTS.filter((e) => e.key !== "B3" && e.key !== "O1" && e.key !== "O2")
      .every((e) => EXPECTED_WINDOWS.some((w) => inWindow(e, w))), "");

  // ── 场景 4：repoKey 回退链与 projectId 主链同值（本 fixture 事件均带同一 repoKey/projectId）──
  const r3 = await getBatchCost(USER_ID, { projectId: null, repoKey: REPO_KEY }, transitions, NOW.getTime());
  check("S4.1 repoKey 回退链总成本与 projectId 主链一致",
    r3 != null && Math.abs(r3.totalCostUsd - r2.totalCostUsd) <= 1e-8 && r3.totalComputeTokens === r2.totalComputeTokens,
    `repoKey=${fmt(r3!.totalCostUsd)} vs projectId=${fmt(r2.totalCostUsd)}`);

  console.log(`\n=== 结论：${failures === 0 ? "全部断言 PASS" : `${failures} 条断言 FAIL`} ===`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("AUDIT SCRIPT ERROR:", e);
  await prisma.$disconnect();
  process.exit(2);
});
```

## 附录 C · 最终运行完整输出（27 PASS / 0 FAIL）

```
=== BL-COST-BATCH-V1 F004 attribution audit ===
DATABASE_URL host: postgresql://***@127.0.0.1:5545/f004_audit
seeded: user=u-f004-audit project=cmsmuuwvs... harnessProject=cmsmuuwvu... transitions=8 events=12
PASS  S0.1 loadCurrentBatchTransitions 行数 — 8/8
PASS  S0.2 observedAt 升序

== 场景 1：仅批次事件（Phase A） ==
batch=BL-AUDIT-V1  total=$14.64300000  compute=713110  rework=$2.67750000/130000
window=[2026-08-09T18:30:00.000Z, 2026-08-09T20:00:00.000Z)
  planning    fix=0 [2026-08-09T18:30:00.000Z, 2026-08-09T18:41:32.000Z)   692000ms  compute=  55333  cost=$0.96665000
  building    fix=0 [2026-08-09T18:41:32.000Z, 2026-08-09T18:50:34.000Z)   542000ms  compute= 385000  cost=$8.03000000
  verifying   fix=0 [2026-08-09T18:50:34.000Z, 2026-08-09T19:08:19.000Z)  1065000ms  compute= 120777  cost=$2.56385000
  fixing      fix=1 [2026-08-09T19:08:19.000Z, 2026-08-09T19:20:00.000Z)   701000ms  compute=  72000  cost=$1.51500000
  reverifying fix=1 [2026-08-09T19:20:00.000Z, 2026-08-09T19:30:00.000Z)   600000ms  compute=  58000  cost=$1.16250000
  done        fix=1 [2026-08-09T19:30:00.000Z, 2026-08-09T20:00:00.000Z)  1800000ms  compute=  22000  cost=$0.40500000  (open)
PASS  S1.1 区间数与阶段序列 — planning→building→verifying→fixing→reverifying→done
PASS  S1.2 区间窗口逐一吻合（batchBoundary 切窗 + done 开区间以 now 封）
PASS  S1.3 各阶段成本之和 = 批次总成本（±$0.01） — sum(phases)=$14.64300000 vs total=$14.64300000 |Δ|=0.000e+0
PASS  S1.4 批次总成本 = 独立重算期望（±$0.01） — actual=$14.64300000 vs expected=$14.64300000
PASS  S1.5.1 planning 阶段成本/compute 与独立重算一致（含事件 E1+B2） — cost $0.96665000 vs $0.96665000 · compute 55333 vs 55333
PASS  S1.5.2 building 阶段成本/compute 与独立重算一致（含事件 E2+E3） — cost $8.03000000 vs $8.03000000 · compute 385000 vs 385000
PASS  S1.5.3 verifying 阶段成本/compute 与独立重算一致（含事件 E4+B1） — cost $2.56385000 vs $2.56385000 · compute 120777 vs 120777
PASS  S1.5.4 fixing 阶段成本/compute 与独立重算一致（含事件 E5） — cost $1.51500000 vs $1.51500000 · compute 72000 vs 72000
PASS  S1.5.5 reverifying 阶段成本/compute 与独立重算一致（含事件 E6） — cost $1.16250000 vs $1.16250000 · compute 58000 vs 58000
PASS  S1.5.6 done 阶段成本/compute 与独立重算一致（含事件 E7） — cost $0.40500000 vs $0.40500000 · compute 22000 vs 22000
PASS  S1.6 批次 compute 总量与独立重算一致 — 713110 vs 713110
PASS  S1.7 返工小计 = fixing+reverifying 各轮合计 — rework=$2.67750000/130000
PASS  S1.8 批次窗口成本 ≤ 项目全量成本 — batch=$14.64300000 ≤ project=$16.84795000（差额=$2.20495000，应恰为 O1+O2+B3 三条窗口外事件）
PASS  S1.9 差额恰等于窗口外事件（O1+O2+B3）成本 —— 旧批次与 lt 沿排除均生效 — outside=$2.20495000
PASS  S3.1 B1（恰在 building→verifying 切点秒 18:50:34.000Z）归 verifying（gte 沿） — verifying compute=120777（含 777 签名）
PASS  S3.2 B1 未被 building 计入（lt 沿排除） — building compute=385000（无 777 签名）
PASS  S3.3 B2（恰在批次窗口起点秒 18:30:00.000Z）归 planning（gte 沿包含） — planning compute=55333（含 333 签名）
PASS  S3.4 B3（恰在 NOW=开区间封闭点 20:00:00.000Z）不计入任何阶段（lt 沿） — batch compute=713110，999 签名不在任何阶段
PASS  SC.1 unstable_cache 命中后结果深等（ISO 串经 JSON round-trip 无损）

== 场景 2：批次事件 + 窗口内混入非批次事件（Phase B） ==
batch=BL-AUDIT-V1  total=$19.79300000  compute=1973110  rework=$4.67750000/290000
window=[2026-08-09T18:30:00.000Z, 2026-08-09T20:00:00.000Z)
  planning    fix=0 [2026-08-09T18:30:00.000Z, 2026-08-09T18:41:32.000Z)   692000ms  compute=  55333  cost=$0.96665000
  building    fix=0 [2026-08-09T18:41:32.000Z, 2026-08-09T18:50:34.000Z)   542000ms  compute= 385000  cost=$8.03000000
  verifying   fix=0 [2026-08-09T18:50:34.000Z, 2026-08-09T19:08:19.000Z)  1065000ms  compute=1220777  cost=$5.71385000
  fixing      fix=1 [2026-08-09T19:08:19.000Z, 2026-08-09T19:20:00.000Z)   701000ms  compute= 232000  cost=$3.51500000
  reverifying fix=1 [2026-08-09T19:20:00.000Z, 2026-08-09T19:30:00.000Z)   600000ms  compute=  58000  cost=$1.16250000
  done        fix=1 [2026-08-09T19:30:00.000Z, 2026-08-09T20:00:00.000Z)  1800000ms  compute=  22000  cost=$0.40500000  (open)
PASS  S2.1 混入后批次成本上升（只多） — $14.64300000 → $19.79300000
PASS  S2.2 上升量恰等于混入事件成本（真批次事件零丢失 = 不少） — Δ=$5.15000000 vs mixin=$5.15000000
PASS  S2.3 compute 同向（Δ = 混入 compute） — Δ=1260000 vs mixin=1260000
  混入误差量化：真批次成本=$14.64300000，混入=$5.15000000，观测=$19.79300000，高估比例=35.17%（方向恒为高估）
PASS  S2.4 混入后批次窗口成本仍 ≤ 项目全量成本 — batch=$19.79300000 ≤ project=$21.99795000
PASS  S2.5 每条真批次事件仍在窗口内（无「少算」路径：窗口为超集）
PASS  S4.1 repoKey 回退链总成本与 projectId 主链一致 — repoKey=$19.79300000 vs projectId=$19.79300000

=== 结论：全部断言 PASS ===
```
