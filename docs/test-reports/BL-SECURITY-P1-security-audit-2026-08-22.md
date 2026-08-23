# BL-SECURITY-P1 安全专项独立验收报告（F008） — 2026-08-22

- **Evaluator：** `local-cli--kimi--evaluator`（fresh context，fix_round 0）
- **验收对象：** 隔离 checkout @ `1b218df4d8760ce1718e5542cec8e7d8b565234e`（工作树干净）
- **方法：** 对抗输入实测。判据是「洞是否真的堵上」，不依赖 commit message 或 Generator 结论。
- **Scratch 环境：** `docker run -d --name blsec-eval-pg -e POSTGRES_PASSWORD=eval -e POSTGRES_USER=eval -e POSTGRES_DB=blsec_eval -p 127.0.0.1:5545:5432 pgvector/pgvector:pg16`；`DATABASE_URL=postgresql://eval:eval@127.0.0.1:5545/blsec_eval npx prisma migrate deploy` → 29 条 migration 全部干净重放（含 `20260810130000_add_quota_account_index`）。容器验后销毁。
- **平台说明：** 本验收在 macOS（Node v25.7.0）执行，全量套件无任何 lifecycle 失败；已知的 Windows-only CI lifecycle 失败属 Windows CI 特有问题，与本评估无关，未混淆计入。

## L1 基线（机械证据）

| 命令 | 结果 |
|---|---|
| `npm test`（vitest run 全量） | 96 files passed / 7 skipped；**1221 passed / 17 skipped**（9.85s） |
| `npm run verify`（prisma generate + tsc --noEmit） | exit 0 |
| `npm run lint` | exit 0，0 errors 0 warnings |
| `env -u AUTH_SECRET DATABASE_URL=postgresql://placeholder:… npm run build` | exit 0（构建期放行成立） |

## F-01 · AUTH_SECRET 生产 fail-closed（对应 F001）— PASS

**生产形态负向实测（非读代码）：**

```
$ env -u AUTH_SECRET DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder npx next start -p 4199 &
$ curl -s -o resp.html -w '%{http_code}' http://127.0.0.1:4199/
HTTP_CODE=500
$ grep -o 'AUTH_SECRET must be configured[^"]*' next-start.log
AUTH_SECRET must be configured with at least 32 characters for production runtime
$ grep -ci 'dev-placeholder' next-start.log → 0   # 密钥/占位串零回显
```

构建期信号放行由 `npm run build` 无 secret exit 0 机械证明（`next build` 内部即置 `NODE_ENV=production`，判据若只看 NODE_ENV 构建必断——未断，说明 `NEXT_PHASE` 区分生效）。

**deploy workflow 硬失败实测：**

```
$ env -u AUTH_SECRET bash scripts/validate-deploy-secrets.sh; echo $?  → 1（含 ::error::AUTH_SECRET）
$ AUTH_SECRET=<40字> bash scripts/validate-deploy-secrets.sh; echo $?  → 0（恰好 2 条 ::warning::，AUTH_RESEND_KEY / HARNESS_CONSOLE_SIGNING_KEY 仍只 warning）
```

单测面（全量套件内绿）：`tests/server/auth-secret.test.ts` 覆盖构建期不抛 / 生产运行时 {缺失, 空串, 历史占位串, 长度不足} 四抛且静态错误信息 / development 占位可用。

## F-02 · 登录开放重定向（对应 F002）— PASS

Evaluator 独立向量表（`tests/evaluator/bl-security-p1-f008-probes.test.ts`，非 Generator 用例）：24 条恶意向量 `it.each`——`https://evil.example`、`//evil.example`、`///evil.example`、`/\evil.example`、`\\evil.example`、`/\/evil.example`、`%2F%2Fevil.example`（含大小写变体）、`%5C%5Cevil.example`、嵌套编码 `%2F%252F%2Fevil.example`、`javascript:`/`JavaScript:`/`vbscript:`/`data:`、`http:/evil`、前后空白、内嵌 tab/换行等——**全部回落 `/`**；合法路径 `/`、`/models/abc`、`/devices/x?a=1#h` 原样返回；解码后二次判定有效（`/%2F%2Fevil.example` → `/`，合法编码 `/models%2Fabc` 保留原串）；非字符串输入 fail-closed。

grep 断言：`app/login/page.tsx:13-14` 仅 `safeCallbackPath(params.callbackUrl)` 后进 `redirect`，无裸 `params.callbackUrl` 直传。

## F-05 · 图表 tooltip 存储型 XSS（对应 F003）— PASS

**端到端实测（enroll 约束 → 上报持久化 → 渲染转义）：**

```
POST /api/usage/events/batch  body: device.name='<img src=x onerror=alert(1)>'+500字符（含控制字符）, source=未知值+200字符+控制字符
→ F003 poison batch HTTP status: 200          # 热路径不拒收，毒丸不钉死队列
DB 终态：Device.name 长度 ≤200、无控制字符（原始 <img> 文本保留——防线在渲染层）；
        UsageEvent 已入库（count=1），source ≤100 且前缀保留 → 无闭集枚举拒收
渲染：escapeHtml(persistedName) 不含 '<'，含 '&lt;img src=x onerror=alert(1)&gt;'
```

- enroll 交互路径硬拒收：`app/api/devices/enroll/route.ts:21-22` `isValidDeviceName` → 400；Evaluator 边界实测：200 字通过 / 201 字拒 / 控制字符拒 / 空串拒 / 非字符串拒。
- grep 断言：4 个 chart 文件（`daily-cost-chart` / `daily-usage-chart` / `daily-source-chart` / `devices/daily-device-cost-chart`）`custom:` tooltip 内全部动态插值经 `escapeHtml`（`${rows}` 的组成行逐项转义，已逐文件核对）。
- 全仓扫描：`app/` + `src/` 产品代码 `dangerouslySetInnerHTML` / `innerHTML` **零命中**；`custom:` tooltip 仅此 4 处。
- `src/cli/**` 与 `agent-feature-version.ts` 零改动（7 个实现 commit 逐一 `git show --name-only` 核对，零命中）。

## F-33 · Gate 决策并发覆盖（对应 F004）— PASS

**真实并发实测（迁移后 scratch PostgreSQL，Evaluator 自有探针）：**

```
Promise.all([POST /api/harness/gates {id, action:approve}] × 2)
→ F004 concurrent statuses: 200, 409
→ F004 stored decisionSig matches 200-response sig: true
DB 终态：decisionAction='approve'，decisionSig 恰一份且等于 200 响应所示；409 响应无 sig 字段
第三次决策请求 → 409 且不覆盖既有 decisionSig
```

单测面（绿）：已 consumed → 409 不覆盖、已 decided → 409、跨租户 id → 404（userId 留在 CAS where 内）、`count !== 1` 不返回 `ok:true`。Generator 探针 `tests/server/harness-gates-route-db.probe.test.ts` 亦由 Evaluator 设 `EVAL_F004_DB_URL` 实跑通过。

## F-35 · 订阅额度跨账号混拼（对应 F005）— PASS

**多账号 fixture 实测（scratch 库，`EVAL_F005_DB_URL` 探针 2/2 通过）：** 同一 user 两个 `accountKey` 各持不同 window（account-a: primary 0.2@11:00 + secondary 0.3；account-b: primary 0.4 + credit_balance 42）→ 每张卡 windows 全部同 accountKey，无跨账号拼接；`capturedAt`/`capturedBy` 各取账号内最大（a→11:00/device A，b→14:00/device B），不跨账号。

- 单账号回归：`tests/server/quota.test.ts:80` 「keeps every account-level field equivalent for a single account」绿（全量套件内）。
- migration 实跑：本验收 scratch 库 `prisma migrate deploy` 干净重放；探针断言 `pg_indexes` 中 `QuotaSnapshot_user_provider_account_window_captured_idx(userId, provider, accountKey, windowKey, capturedAt)` 存在。
- i18n：`accountLabel` 双语言在库；`tests/shared/subscription-card.test.ts` 渲染形态测试绿。

## F-04 · 设备注册绑定本次 enrollment（对应 F006）— PASS

- 端点四态与契约：`app/api/admin/enrollment-tokens/[id]/route.ts` 未登录 401 / 他人 404 / 未使用 `{usedAt:null,usedById:null}` / 已使用返回 usedById+deviceName；`force-dynamic` + `Cache-Control: no-store` 且不经 `unstable_cache`（grep 核实）；路由测试绿。
- **F-04 复现路径行为级断言（Evaluator 独立探针）：** 存在无关新设备但本 enrollment `usedById=null` → `isEnrollmentClaimed` 返回 `false`；`usedById` 非空才 claim。承重断言为行为调用，非源码字符串。
- 退避：`enrollmentPollDelayMs` 实测序列 1000→2000→4000→8000→10000（封顶），负输入回落 1000。
- token 生成响应 additive 含 `enrollmentId`（`enrollment-tokens/route.ts:52`），既有字段不动（路由测试绿）。
- `initialDeviceIds` 死 prop 已清理：`app/` + `src/` grep 零命中。
- abort/backoff 可客观测试边界：仓库无 jsdom（vitest environment: node），渲染级 unmount 行为不可执行；代码核检三重守卫在场（`enroll-flow-card.tsx:84-122`：`AbortController` + `clearTimeout` + `cancelled` flag）。纯函数面（claim 判定 + 退避）已行为实测。

## F-32 · 批次成本查询放大（对应 F007）— PASS（独立复算）

**独立复算（不引用 Generator 期望字面量）：** Evaluator 探针内以自有实现从原始 fixture 值推导——区间语义（batchBoundary 切窗 / done 零宽终态 / 开区间以 now 封闭）、事件归属 `[start,end)`、compute 口径 `max(0, input−cached)+output`、逐事件 `estimateCost` 归集——再与 `getBatchCost` 真实输出逐字段比对：

```
F007 independent recompute: totalComputeTokens=1951110 totalCostUsd=19.388000
→ 与产品输出完全一致（tokens 精确相等；cost 1e-10 精度相等）
→ 每阶段 phase/fixRounds/startIso/endIso/openEnded/durationMs/compute/cost/unpriced 全符
→ rework（fixing+reverifying）tokens/cost 全符；window [18:30, 19:30]；hasUnpricedUsage=false
→ $queryRaw 调用计数探针：恰好 1 次（单查询聚合成立，N_intervals → 1）
```

- 缓存键：封闭批次跨 >30s 两个量化窗口 `batchCostCacheNowMs` 均钉 `CLOSED_BATCH_NOW_MS=0`（永久缓存）；活跃批次返回 nowMs（30s 量化换 key）。边界探针（Evaluator 自有）：乱序 transitions 同判 / 同毫秒 transitions / now 恰在开闭沿保持活跃 / 时钟偏斜不错判封闭——全绿。
- 关联设界：`app/projects/[id]/page.tsx:33-36` `orderBy [updatedAt desc, id desc]` + `take: MAX_LINKED_HARNESS_PROJECTS+1`（look-ahead），`:75-76` 截断判定，`:203` UI 披露文案（双语在库）。

## 结论

六个安全项 + F007 独立复算全部实测通过。F001-F008 判定见 `docs/test-reports/BL-SECURITY-P1-verdict.json`。Soft-watch 一项：`tests/shared/enrollment-status.test.ts:14` 为恒真断言（零回归检出力），承重断言 :15 在场且绿，建议下批次删除或改为行为断言——不阻断签收。
