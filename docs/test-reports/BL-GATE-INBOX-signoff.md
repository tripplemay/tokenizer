# BL-GATE-INBOX 验收签署报告

- **批次：** BL-GATE-INBOX（闸门全局触达：徽章 / 邮件通知 / evidence 先行版 / dashboardUrl / dispatch 产物补显）
- **验收形态：** 快车道 fan-out——5 个上下文隔离 evaluator subagent，每 feature 一个（fresh context，自行从磁盘读状态与代码）
- **验收 SHA：** `ac69897`（生产 /api/health 报同 SHA，F001 分片逐位比对）
- **判定：** **5/5 全 PASS，零 FAIL/PARTIAL**，fix_rounds=0
- **署名：** evaluator-subagent ×5（编排者仅机械合并，未改写任何结论）
- **日期：** 2026-08-09（UTC）

以下五节为各分片 evaluator 返回的结构化结论**原样收录**（未删改、未软化）。

---

## F001 · 全站待批徽章 + pending-count API — PASS

```json
{
  "feature_id": "F001",
  "result": "PASS",
  "evidence": [
    "① 401/计数条件/响应形状单测：tests/server/harness-gates-pending-count.test.ts 实跑 2/2 绿——401 分支断言 prisma.harnessGate.count 未被触达（鉴权前置）；计数分支断言 where 恰为 {userId, consumedAt: null, decisionAction: null} 且响应形状 {pending: 3}",
    "② 组件三分支单测：tests/shared/pending-gates-badge.test.ts 实跑 2/2 绿——shouldRenderPendingBadge(3)=true / (0)=false / (null)=false；静态核对 app/_components/pending-gates-badge.tsx:37-46：n>0 渲染 bg-red-500 <Link href=\"/harness\">（>99 折叠 99+），fetch 失败与非 2xx 在 catch 中归一为 null 不渲染。备注：三分支测试落在渲染判定纯函数层，「红底 Link」DOM 形态由静态核对补证，未做组件渲染测试（acceptance 措辞为『三分支单测』，判满足）",
    "③ 30s 常量导出断言：PENDING_GATES_POLL_MS = 30_000 已导出且测试锁定；与 /harness 列表页 app/harness/page.tsx:83 <AutoRefresh intervalMs={30000} /> 数值同拍。soft-watch：两处是数值一致而非共享常量，AutoRefresh 侧无测试锁定，后续如调列表页节拍需人工连动",
    "④ verify/lint：npm run verify exit=0（prisma generate + tsc）；npm run lint 0 errors 0 warnings。全量回归 npx vitest run 1090 passed / 10 skipped",
    "计数口径一致性（静态核对）：列表页 page.tsx:59-67 findMany({userId, consumedAt: null}) + filter(!decisionAction) 与 API count 口径等价——decisionAction 唯一写入点 app/api/harness/gates/route.ts:69-71 严格校验 approve|reject，report route re-raise 置 null，空串不可能，truthy 过滤 ≡ null 判定",
    "navbar 挂载：src/components/navbar/index.tsx:11 import + :82 JSX（置于 LocaleSwitcher 之前）；Navbar 经 app/admin-shell.tsx:34 由 app/layout.tsx 根布局引用 → 全站生效",
    "[L2 负向面] 生产实测：curl https://token.vpanel.cc/api/harness/gates/pending-count → HTTP 401 {\"error\":\"unauthorized\"}；/api/health 报 commit=ac69897…（与本地 HEAD 及 origin/main 逐位一致，SHA 对齐无豁免需求）",
    "[L2] 登录态徽章显示/轮询实测未执行（未授权且按指令不登录），待批次级 L2 授权后补"
  ],
  "steps_to_reproduce": [
    "git rev-parse HEAD  # ac69897bee9df14dd65681e93e84fa10fa148f98",
    "npx vitest run tests/server/harness-gates-pending-count.test.ts tests/shared/pending-gates-badge.test.ts  # 4/4 绿",
    "npm run verify && npm run lint  # exit 0 / 0 warnings",
    "curl -s -w '\\nHTTP %{http_code}\\n' https://token.vpanel.cc/api/harness/gates/pending-count  # 401 unauthorized",
    "curl -s https://token.vpanel.cc/api/health  # commit=ac69897…"
  ]
}
```

## F002 · 闸门邮件通知（Resend + notifiedAt claim + fail-open）— PASS

```json
{
  "feature_id": "F002",
  "result": "PASS",
  "evidence": "①migration 纯 additive：prisma/migrations/20260810000001_add_harness_gate_notified_at/migration.sql 全文 2 行仅 1 条 DDL（ADD COLUMN \"notifiedAt\" TIMESTAMP(3)，可空/无默认/无回填/无索引）；scratch 库重放实跑（kolmatrix-postgres 建 tokenizer_scratch_f002 → prisma migrate deploy 全链干净应用 → \\d 确认 notifiedAt timestamp(3) nullable → 已删库）。②claim 原子恰一次：harness-gate-notify.ts:85-89 updateMany where {id, notifiedAt:null} 计数≠1 即退，代码核对成立；并发抢先（count 0 不发）与恰一次发送用例绿。③无 key/email 空静默且 report 200：单测覆盖 + 路由级实证——既有 gate 上报用例（harness-report-mode-intent.test.ts:349，测试环境无 AUTH_RESEND_KEY）断言 200，notify 已挂在该路径。④发送失败复位重试：generator 用例（fetch reject）+ 本次独立构造 4 个测试外探针全绿（tests/server/harness-gate-notify-evaluator-probes.test.ts，commit 5426b50）：Resend HTTP 500 ok:false → 复位 {notifiedAt:null} 且 where 限定 consumedAt:null+decisionAction:null（不翻已批准闸门）；findFirst 抛错、claim 抛错、复位自身失败三路径均 resolves undefined 永不 throw。⑤re-raise 复位：route.ts:743 re-raise 分支 data 含 notifiedAt:null（git show b52c557 三 hunk 核对：import/复位/事务外触发，无其他改动）。⑥触发点结构：notify 在 serializable 事务 try/catch 之后（route.ts:897-906）、Response.json 之前，函数体双层 try/catch 无 throw 路径。⑦渲染纯函数：subject 精确串 + UTC ISO(2026-08-10T01:00:00.000Z) + verifying→done + 控制台链接 + NEXT_PUBLIC_APP_URL 优先双断言。⑧零新依赖：git diff --stat 428561f..ac69897 全批次未触 package.json/package-lock.json。⑨回归：4 个 report route 套件 89/89 绿（含 69 用例 mode-intent 套件，批次 diff 证明零改动）；全量 vitest 1102 passed/10 skipped；npm run verify exit 0；lint 0 errors 0 warnings。⑩[L2] 真实邮件发送未执行——生产行为，待 push 后下一次真实闸门自然验证（spec 与 session_notes 均已声明）。Soft-watch（非阻断，建议编排者记录兜底）：spec 措辞 fire-and-forget，实现为事务外 await（错误路径全部快速失败、永不 reject，200 语义不受影响）；剩余边缘是 Resend 连接挂起时 undici 默认 headersTimeout 可拖慢该次 report 响应（report 幂等可重试，不丢数据）——建议后续批次给 fetch 加 AbortSignal.timeout(5-10s) 一行，或入 backlog 备注。",
  "steps_to_reproduce": "cd /Users/yixingzhou/project/tokenizer && npx prisma generate && npx vitest run tests/server/harness-gate-notify.test.ts tests/server/harness-gate-notify-evaluator-probes.test.ts tests/server/harness-report-mode-intent.test.ts tests/server/harness-report-transitions.test.ts tests/server/harness-batch-archive.test.ts tests/server/harness-dispatch-usage.test.ts（7+4+89 全绿）；migration 断言：cat prisma/migrations/20260810000001_add_harness_gate_notified_at/migration.sql + docker 起任一 postgres 建 scratch 库后 DATABASE_URL=... npx prisma migrate deploy；route 核对：git show b52c557 -- app/api/harness/report/route.ts；全量：npm run test && npm run verify && npm run lint"
}
```

## F003 · evidence 查看先行版 — PASS

```json
{
  "feature_id": "F003",
  "result": "PASS",
  "evidence": [
    "分类纯函数边界单测：npx vitest run tests/shared/harness-evidence.test.ts → 3/3 绿。用例覆盖 docs/ 前缀→repoDoc、普通路径→path、空串/纯空白/513 超长/非字符串(42/null)→null、路径穿越样式按普通路径只读呈现、列表过滤与非数组→[]（tests/shared/harness-evidence.test.ts 与 src/shared/harness-evidence.ts MAX=512 实现一致）",
    "三渲染点接入（grep 实证）：<EvidenceList> 引用恰 3 处——app/harness/page.tsx:134（列表页 gate 卡）、app/harness/[id]/views.tsx:223（overview pendingGate Fact）、app/harness/[id]/views.tsx:634（activity gates）；import 2 处（page.tsx:3、views.tsx:29）。裸列表清零：grep list-inside/list-disc 在 app/harness/** 零命中（git show df091a5 -- app/harness/page.tsx 确证原裸列表即被本 commit 删除；app/ 下仅存的 list-disc 在 app/_components/upgrade-banner.tsx:43，属升级公告、非 gate 渲染点、批次前既有）",
    "detail gates select 已补 evidence 列：src/server/harness-detail.ts:50 `evidence: true`（df091a5 --stat 显示该文件 +1 行）；dispatch/intent 敏感字段仍未入 gates select",
    "空数组不渲染：classifyEvidenceList([]/junk/非数组)→[] 时组件 return null；真实组件 renderToStaticMarkup 实证 []/全垃圾/非数组三种输入均输出空字符串",
    "en/zh 键集一致（脚本比对）：node 脚本比对 messages/en.json 与 messages/zh-CN.json 的 harness.evidence 键集 → 均为 [\"copied\",\"copy\",\"path\",\"repoDoc\"]，equal:true，值非空",
    "verify 绿：npm run verify（prisma generate + tsc --noEmit）exit=0、0 TS errors",
    "只读语义：app/harness/evidence-list.tsx 无 fetch/prisma/use server/axios/useSWR/POST 命中；唯一浏览器 API 是 onClick 内 navigator.clipboard.writeText（客户端剪贴板，非网络写路径）",
    "可选补强已落地：tests/evaluator/bl-gate-inbox-f003-evidence-list.test.ts（仿 bl-transition-log-f003 先例，真实组件渲染 + 真实消息束标签 + 机械化 grep 固化为回归）→ 8/8 绿；全量 npx vitest run → 77 files passed，1098 passed / 10 skipped，零红",
    "测试产物已 commit：2526b6a（test(BL-GATE-INBOX-F003)）。注意：origin/main 已在 ac69897，该 test-only commit 尚未 push——本仓 tests/** 不在 paths-ignore，push 会触发 deploy workflow，交由编排者与其他 fan-out 验收产物合并推送"
  ],
  "steps_to_reproduce": [
    "cd /Users/yixingzhou/project/tokenizer && npx prisma generate",
    "npx vitest run tests/shared/harness-evidence.test.ts   # 3/3",
    "npx vitest run tests/evaluator/bl-gate-inbox-f003-evidence-list.test.ts   # 8/8（渲染冒烟+键集比对+接线 grep+只读语义）",
    "grep -rn '<EvidenceList' app/   # 恰 3 处：page.tsx:134 / views.tsx:223 / views.tsx:634",
    "grep -rn 'list-inside\\|list-disc' app/harness/   # 零命中",
    "grep -n 'evidence' src/server/harness-detail.ts   # gates select 内 evidence: true",
    "npm run verify   # exit 0"
  ]
}
```

## F004 · dashboardUrl 补显 — PASS

```json
{
  "feature_id": "F004",
  "result": "PASS",
  "evidence": [
    "[测试实跑] npx vitest run tests/shared/url.test.ts → 3/3 passed。新增 describe 'dashboardUrl rendering guard'（tests/shared/url.test.ts:24-30）：javascript:alert(1) → null、data:text/html,x → null、https 透传——javascript:/data: 拒渲染 case 确已补且绿（既有 describe 另覆盖大写 JavaScript:、null/undefined/空串/垃圾串）。",
    "[渲染点1·详情 identity Fact] app/harness/[id]/views.tsx:116-127：条件(117)、href(119)、可见文本(124) 三处全部经 safeHttpUrl 双读防线（纯函数，无 TOCTOU）；<a> 带 target=\"_blank\" rel=\"noopener noreferrer\"；空/非法值走 t(\"notReported\") 分支，不渲染 <a>。i18n 命名空间 harness.detail 下 overview.dashboard 与 notReported 键均存在。",
    "[渲染点2·列表活跃卡外链] app/harness/page.tsx:193-202：条件(193)+href(195) 双读 safeHttpUrl；target=\"_blank\" rel=\"noopener noreferrer\"；带 aria-label/title（harness.dashboardLink）；空值渲染 null 不渲染 <a>（图标型 affordance，符合 '不渲染 <a>' 硬性项；notReported 文案由详情 Fact 承担）。",
    "[数据链路核实] 详情 select 含 dashboardUrl:true（src/server/harness-detail.ts:17）；列表 findMany 仅 include device、无 scalar select 限定，p.dashboardUrl 可用——排除了'渲染点存在但数据永空'的静默哑弹；tsc 全绿印证类型链路。",
    "[grep 断言] grep -rn dashboardUrl app/ → 12 命中（>0，PASS）。其中 UI 渲染层 app/harness/ 5 处（views.tsx:117,119,124 + page.tsx:193,195），pre-F004（cf681a3）该范围为 0。",
    "[i18n en/zh 齐备] python json 解析双语言核实嵌套：harness.detail.overview.dashboard = Dashboard/进度看板；harness.dashboardLink = Open dashboard/打开进度看板；harness.detail.notReported = Not reported/尚未上报。",
    "[L1 全绿] npm run verify（prisma generate + tsc --noEmit）exit=0；npm run lint exit=0，0 errors 0 warnings（lint 矩阵最优档）。",
    "[观察项·不阻断] spec/commit 均称 grep 基线'为 0'，机械核证为不精确：pre-F004 app/ 全域已有 7 命中（app/api/harness/report/route.ts，写入/持久化路径）；'基线 0'仅对 UI 渲染层 app/harness/ 成立。acceptance 判据本体（命中 >0）与实质主张（渲染层从无到有）均真，判定不受影响；建议合并报告记一笔叙述精度注记（铁律 13 口径）。"
  ],
  "steps_to_reproduce": "1. git checkout ac69897\n2. npx vitest run tests/shared/url.test.ts → 3 passed\n3. grep -rn dashboardUrl app/ → 12 hits；git grep -n dashboardUrl cf681a3 -- 'app/harness' → 空（UI 基线 0）\n4. 读 app/harness/[id]/views.tsx:116-127 与 app/harness/page.tsx:193-202 核对双读防线 / _blank+noopener noreferrer / 空值分支\n5. python3 解析 messages/en.json + zh-CN.json 核 harness.detail.overview.dashboard、harness.dashboardLink、harness.detail.notReported\n6. npm run verify && npm run lint → 均 exit 0"
}
```

## F005 · dispatch 产物补显 — PASS

```json
{
  "feature_id": "F005",
  "result": "PASS",
  "evidence": [
    "断言反转带机械依据成立：commit eb852f8 将 tests/server/harness-detail.test.ts 的 artifactPath/artifactSha256 两条 not.toHaveProperty 反转为 toHaveProperty；实地读 src/server/harness-mode-intent-api.ts 核验反转理由——repoRelativeArtifactPath（L1146-1163：optionalBoundedString ≤512、拒绝绝对路径/反斜杠/~ 前缀/盘符/空段与穿越段/含 worktree 段/非 normalize 路径）+ SHA256_PATTERN（L22：^[0-9a-fA-F]{64}$，L1211 入库前 lowercase）真实存在；全仓 grep 确认 harnessDispatchRun 唯一写点在 app/api/harness/report/route.ts:826 upsert，create/update 均取 parseDispatchRuns 净化输出，无旁路——「非 raw 通道」论断成立（对照保留排除的 decisionSig/payload/signature 才是 raw 密码学材料）",
    "select 补两列：src/server/harness-detail.ts:121-122 dispatchRuns select 含 artifactPath/artifactSha256（eb852f8 diff 仅 +2 行，无越界改动）",
    "敏感字段排除断言保留：tests/server/harness-detail.test.ts:20-22 decisionSig/signature/payload 三条 not.toHaveProperty 原样在位（grep 证实）",
    "Activity 产物列渲染：app/harness/[id]/views.tsx:678-685 —— path 有值 <span className=\"break-all\">、td font-mono（spec 'path mono' 符合）；sha 截断 slice(0,12)+… 且 title={run.artifactSha256} 全量；path 为 null 显 \"—\"，两者皆空即单个 \"—\"（boundedString 拒空串，DB 值只能是 null 或非空净化串，falsy 判空安全）；表头 col.artifact 键 en.json:796 'Artifact' / zh-CN.json:796 '产物' 双语齐备",
    "实跑：npx vitest run tests/server/harness-detail.test.ts → 2/2 passed；npm run verify → exit 0；npm run test 全量 → 76 files passed / 3 skipped，1090 tests passed / 10 skipped，0 failed；HEAD=ac69897 与派发一致，工作树 clean"
  ],
  "steps_to_reproduce": "git checkout ac69897 && npx prisma generate && npx vitest run tests/server/harness-detail.test.ts && npm run verify && npm run test；git show eb852f8 -- tests/server/harness-detail.test.ts 核对反转；sed -n '1146,1163p;22p' src/server/harness-mode-intent-api.ts 核对校验代码；sed -n '678,685p' 'app/harness/[id]/views.tsx' 核对渲染"
}
```

---

## Soft-watch 汇总（分片提出，非阻断，编排者机械转录）

1. **F001**：徽章「三分支」测试落在纯函数层，DOM 形态靠静态核对；30s 轮询与列表页 AutoRefresh 是数值同拍而非共享常量，调节拍需人工连动。
2. **F002**：notify 为事务外 `await` 而非字面 fire-and-forget（错误路径永不 reject，200 语义不受影响）；Resend 连接挂起时 undici 默认超时可拖慢该次 report 响应——建议后续给 fetch 加 `AbortSignal.timeout(5-10s)`（已记 backlog 备注）。
3. **F004**：spec/commit 叙述「grep 基线为 0」不精确——仅对 UI 渲染层 `app/harness/` 成立，`app/` 全域 pre-F004 已有 7 处（report route 写入路径）。判据本体与实质主张均真（铁律 13 精度注记）。
4. **F005**：「皆空显 —」分支由代码审读 + 入库空串不可达性闭合，未做渲染层单测；后续批次补 harness 详情页组件渲染测试时可顺手覆盖。

## L2 未尽项（生产行为，push 后自然验证）

- **F002 真实邮件发送**：下一次真实闸门举起时用户应收到 Resend 邮件（收不到即回归线索）。
- **F001 登录态徽章显示/轮询**：用户登录控制台肉眼可验（红底数字 badge 于导航栏）。
