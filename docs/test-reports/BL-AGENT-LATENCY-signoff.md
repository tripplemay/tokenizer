# BL-AGENT-LATENCY 验收签署报告

- **批次：** BL-AGENT-LATENCY（agent 时延与健壮性 + 2 顺路项）
- **验收形态：** 快车道 fan-out——7 个上下文隔离 evaluator subagent，每 feature 一个（fresh context）
- **验收 SHA：** 本地 main `75bbca8`（origin/main `f3d7a9a` + 一个 F004 标题修正状态 commit；生产 /api/health 报 `f3d7a9a`，F004 分片逐位核对）
- **判定：** **7/7 全 PASS，零 FAIL/PARTIAL**，fix_rounds=0
- **署名：** evaluator-subagent ×7（编排者仅机械合并，未改写任何结论）
- **日期：** 2026-08-10（UTC）
- **规划期附带产出：** 框架 v1.9.1（mode intent 消费台账双锚，proposed-learnings 回流）+ v1.10.0（提取器 argv model 兜底档），均已 tag 推送上游并同步本仓

以下七节为各分片 evaluator 返回的结构化结论**原样收录**（未删改、未软化）。

---

## F001 · cron fallback 拆双 crontab 条目 — PASS

```json
{
  "feature_id": "F001",
  "result": "PASS",
  "evidence": [
    "实现 commit 5a4d967（feat(BL-AGENT-LATENCY-F001)），改动面恰为 src/cli/service-cron.ts（新增纯函数）+ src/cli/service.ts（薄壳接线）+ tests/cli/service-cron.test.ts，与预案 §F001 一致",
    "acceptance 1（四输入形态）：npx vitest run tests/cli/service-cron.test.ts → 7/7 全绿（423ms）。空 crontab（精确全文断言 run+harness 两行）/ 旧单条目升级（tokenizerRows==[RUN,HARNESS] 且 */10 消失）/ 已有双条目 / 混有用户行（首行原样保留，且该用户行注释里故意含 'tokenizer' 字样，实证过滤锚定 binPath 而非裸字符串）",
    "acceptance 2（周期）：测试 'pins the harness cadence' 断言 harness 条目 */2（HARNESS_CRON_MINUTES=2，service-cron.ts:8,23）、run 条目 */15（syncMinutes=15 注入）、syncMinutes=0 时 clamp 到 */1",
    "acceptance 3（卸载清零）：buildCronUninstall 两用例——含双条目 crontab 产出零条 tokenizer 行且用户行逐字保留；legacy 单条目同样清零",
    "acceptance 4（幂等）：buildCronInstall(buildCronInstall(x)) === buildCronInstall(x) 精确相等断言",
    "薄壳接线核对：installCron（service.ts:157-168）与 uninstallService（service.ts:184-190）均改走 buildCronInstall/buildCronUninstall 纯函数，binPath/logPath 从模块常量注入；grep 确认旧的裸 'tokenizer run' 过滤已从产品代码清零（仅余注释与返回消息文案）；`tokenizer harness --json` 子命令实存（src/cli/index.ts:42）",
    "回归：npx vitest run tests/cli/ → 21 文件 282 passed / 4 skipped / 0 failed；npm run verify exit 0；npm run lint → 0 errors 0 warnings",
    "[覆盖边界] 本机为 darwin/launchd 主机，真实 crontab 写入路径本机不可实测——cron 路径的行为正确性由纯函数测试面覆盖，真机闭环依赖 F005 rollout 后 cron fallback 主机重装（预案既有安排，非本 feature 缺陷）",
    "[观察，非缺陷] userRows 过滤 `row &&` 会折叠用户 crontab 中的空行——与改造前旧实现行为相同（5a4d967 diff 可证），无回归"
  ],
  "steps_to_reproduce": "cd /Users/yixingzhou/project/tokenizer && npx vitest run tests/cli/service-cron.test.ts && npx vitest run tests/cli/ && npm run verify && npm run lint；接线核对：git show 5a4d967 -- src/cli/service.ts；grep -rn 'tokenizer run' src/"
}
```

## F002 · harness 轮询错误驱动退避 + 抖动 — PASS

```json
{
  "feature_id": "F002",
  "result": "PASS",
  "evidence": [
    "acceptance 1（退避序列/封顶/抖动/复位）：npx vitest run tests/cli/harness-backoff.test.ts → 5/5 全绿。清洁轮复位 60_000 且 consecutiveFailures=0；noJitter(=0.5→系数恰 1.0) 下连续失败 4 轮精确断言 [120000, 240000, 480000, 600000]；failRounds(10).at(-1)===600_000 封顶；random()=0/1 时精确等于 120000×0.85 / 120000×1.15，另 50 次真随机采样断言落在 [0.85,1.15]±1（rounding 容差）区间",
    "acceptance 2（non-retryable 同样退避）：用例钉住接口只收 hadIssues 布尔；agent.ts:229 实际接线传 result.issues.length > 0，不按 issue.retryable 过滤——语义与预案一致",
    "acceptance 3（lifecycle 回归）：npx vitest run tests/cli/agent-lifecycle.test.ts → 6/6 全绿（1.92s），含 SIGTERM 释放锁与 wrapper SIGTERM 转发用例；首跑即绿，未复现 CI flake，无需重跑（按派发要求如实记录：仅跑一次，绿）",
    "acceptance 4（verify）：npm run verify exit 0",
    "接线核对（agent.ts）：(a) 固定阈值已替换为动态 harnessDelayMs，全仓 grep 裸 'HARNESS_MS' 常量零残留（仅 HARNESS_BASE_MS/HARNESS_MAX_MS import）；(b) 单飞 harnessInFlight 未动；(c) settleHarnessRound 在 .then 与 .catch 双路径均调用，catch 路径固定传 true；(d) cron 模式 runOnce 不经任何退避状态——节拍由 crontab 决定；(e) 生产路径 jitter 用默认 Math.random，测试注入确定 random，与预案 'random 以参数注入保证可测' 一致",
    "commit 归属：3f1ab41，改动面恰为 src/cli/agent.ts + 新增 src/cli/harness-backoff.ts + tests/cli/harness-backoff.test.ts，与 features.json F002 对应，无越界改动；工作树 clean"
  ],
  "steps_to_reproduce": "cd /Users/yixingzhou/project/tokenizer && npx vitest run tests/cli/harness-backoff.test.ts && npx vitest run tests/cli/agent-lifecycle.test.ts && npm run verify；接线核对：grep -n 'harnessDelayMs\\|settleHarnessRound\\|harnessInFlight' src/cli/agent.ts + git show --stat 3f1ab41"
}
```

## F003 · enroll 切换自愈 agentFetch — PASS

```json
{
  "feature_id": "F003",
  "result": "PASS",
  "evidence": [
    "acceptance 1 PASS: `grep -n 'await fetch(' src/cli/enroll.ts` 零命中（exit 1）；`grep -n 'agentFetch' src/cli/enroll.ts` 命中 import（enroll.ts:5）与调用（:37）",
    "acceptance 2 PASS: `npx vitest run tests/cli/enroll.test.ts` 2/2 绿。用例 1 断言 agentFetch 恰被调 1 次、POST enroll 端点（mock serverUrl 带尾斜杠，顺带覆盖 strip 逻辑）、body 含 enrollToken 与 device、成功时 writeCredentials({deviceToken})；用例 2 断言 403 抛 `Enroll failed: 403` 且 writeCredentials 零调用。代码路径核对：enroll.ts:42 throw 先于 :44 writeCredentials。注：测试 mock 用相对路径而非字面 `@/cli/fetch`，模块同一性由 mock 实际拦截生效证明，实质等价，非扣分项",
    "acceptance 3 PASS: `grep -rn 'await fetch(' src/cli/` 零命中；更严的 `grep -rnE '(^|[^a-zA-Z.])fetch\\(' src/cli/` 亦零命中；src/quota/sync.ts 无裸 fetch（:3 import agentFetch、:15 调用）",
    "Out 边界核对成立: src/quota/codex-chatgpt.ts:58 仍为裸 fetch，目标第三方 ChatGPT 端点，与预案 Out 清单一致，不阻断",
    "`npm run verify` exit 0；`npm run lint` 0 errors 0 warnings",
    "回归: `npx vitest run tests/cli/` 21 文件 282 passed / 4 skipped（skip 均为既有平台条件跳过，win32 相关，源自 2218c49，与 F003 无关）",
    "commit 归属（铁律 10）: a573560 仅动 src/cli/enroll.ts + tests/cli/enroll.test.ts（git show --stat 核对）；commit 正文『grep 从 1→0、2 用例绿』经实跑复核属实"
  ],
  "steps_to_reproduce": "cd /Users/yixingzhou/project/tokenizer && grep -rn 'await fetch(' src/cli/ ; grep -n 'agentFetch' src/cli/enroll.ts ; npx vitest run tests/cli/enroll.test.ts ; npm run verify ; npm run lint"
}
```

## F004 · 事件页 events cursor 分页 — PASS

```json
{
  "feature_id": "F004",
  "result": "PASS",
  "evidence": [
    "[单测] npx vitest run tests/server/events-cursor.test.ts → 5/5 绿：编解码往返、敌意输入 12 种全部 null 不 throw（含非规范化时间串缺毫秒被拒）、EVENTS_PAGE_SIZE=200、同毫秒 tiebreak where 形状 + 过滤语义",
    "[追加探针] Evaluator 独立敌意输入 10 种（{}/[]/数组/大写 id/多段下划线/小写 z/RTL 控制符/4 位毫秒/前后缀截断）全部 null 不 throw；观察项（无害）：Date 上限规范串 +275760-09-13T00:00:00.000Z_<cuid> 可通过解码——本就是规范 ISO，语义=匹配全部行=首页等价渲染带「回到最新」链接，无 500",
    "[代码核对] app/events/page.tsx：take EVENTS_PAGE_SIZE+1 探测 + hasOlder/slice；非法 cursor decode→null→spread {} 静默回退首页；双键 orderBy [{occurredAt:desc},{id:desc}]；服务端 Link「更旧」/「回到最新」/「已到最早记录」",
    "[无 migration/索引] commit 4365c71 stat 仅 5 文件（无 prisma/）；批次区间 git diff -- prisma/ 为空；复用既有 @@index([userId, occurredAt])（schema.prisma:220）",
    "[i18n] 脚本比对 en/zh 扁平键集各 651、双向差集均空；events.pagination.{older,latest,end} 两语言齐备",
    "[L1] npm run lint 0 errors 0 warnings；npm run verify exit=0；npm run build exit=0 且 /events 编译为动态路由（本机实跑，非引用叙述）",
    "[DB 层分页实证] 一次性 scratch Postgres 16 重放全部 migration 后种 250 条（30 条同毫秒簇横跨第 1/2 页边界）：pages=2 sizes=[200,50] union=250/250，零重复零遗漏，跨页序严格 (occurredAt,id) desc；垃圾 cursor 解码 null。容器已清理",
    "[L2 生产边界] /api/health commit=f3d7a9a（含 4365c71）；未认证 GET /events → 307 /login，?cursor=garbage → 307 /login（边缘无 500，鉴权边界正确）",
    "[批次内修正核对] features.json F004 标题现不以裸路由开头（diff f3d7a9a..75bbca8 有据）；agent.log 时间线：最后一次 sensitive_summary_data 04:38:47Z → 改标题 commit 75bbca8 @04:44:32Z → 下一轮 harness 04:45:35Z reported=9 failed=0 且无 tokenizer issue 行（残留 1 条属 newkolmatrix，与本项目无关）"
  ],
  "steps_to_reproduce": "L1: npx vitest run tests/server/events-cursor.test.ts && npm run lint && npm run verify && npm run build。DB 实证: 起一次性 postgres:16-alpine（避开 5434——该端口是 SSH 隧道）→ migrate deploy → npx tsx <scratchpad>/pagination-evidence.ts。生产边界: curl -w '%{http_code}' https://token.vpanel.cc/events 与 ?cursor=xxx（均 307→/login）",
  "l2_residual": "[L2] 生产已认证视角的 >200 条「更旧」链接目视走查与垃圾 cursor 登录态 200 渲染无法在本环境登录实测——查询层等价物已在 scratch DB 机械证实，留给用户目视确认，不阻断 PASS"
}
```

## F005 · agent release 1.4.0 账本 + rollout — PASS

```json
{
  "feature_id": "F005",
  "result": "PASS",
  "evidence": [
    "版本修正依据成立：git log -1 -- src/shared/agent-releases.json（在 F005 之前）= 7dc821d「BL-DISPATCH-USAGE-CAPTURE-F002 + release 1.3.0」——预案的 1.3.0 确已被占用，修正为 1.4.0 有据且已在 spec §F005 与 commit 9964256 正文同步注记",
    "npx tsx 实跑断言 5/5 PASS：LATEST_AGENT_RELEASE.version === \"1.4.0\"；agentReleaseStanding(\"1.3.0\").kind === \"behind\"；(\"1.2.1\") === \"behind\"；(\"1.4.0\") === \"latest\"；LATEST 条目 agent_feature_version === 9",
    "grep agent-feature-version.ts:50-51：AGENT_FEATURE_VERSION = 9 且 MIN = 9，未 bump（硬约束 3 保持）",
    "1.4.0 条目 zh/en highlights 各 4 条（≥2），逐条对到实物无虚报：①双条目 cron → service-cron.ts:8 HARNESS_CRON_MINUTES=2；②退避封顶 10 分钟 → harness-backoff.ts:7 HARNESS_MAX_MS=600_000；③enroll 自愈 → enroll.ts:5,37 agentFetch；④unknown model 补写 → report route updateMany where model:null 块",
    "npm run test 全量 1124 passed 0 failed；预案点名的 harness-report-mode-intent + bl-agent-release-acceptance 单独实跑 86/86 绿，硬编码旧版本用例未受账本追加影响",
    "押后规则满足：git log 顺序 F003→F004→F006→F007→F005；F005 之后仅 f3d7a9a 与 75bbca8 两个状态文件 commit（git show --stat 证实）——F005 是最后一个产品代码 commit；F005 本身范围干净"
  ],
  "steps_to_reproduce": "git log -5 --oneline -- src/shared/agent-releases.json；npx tsx -e 'import { LATEST_AGENT_RELEASE, agentReleaseStanding } from \"./src/shared/agent-release-version\"; ...'（期望 1.4.0 behind behind）；grep agent-feature-version.ts；npm run test；git show 9964256/75bbca8/f3d7a9a --stat"
}
```

## F006 · 闸门邮件 notify fetch 超时兜底 — PASS

```json
{
  "feature_id": "F006",
  "result": "PASS",
  "evidence": "①代码核对：harness-gate-notify.ts:110 `signal: AbortSignal.timeout(8_000)` 在 Resend fetch init 中（git show 4bd1fd9 全 diff 仅 src 5+/1- 与 generator 测试 1+）；超时抛 TimeoutError 落入既有 catch → 复位 claim {notifiedAt:null}，where 限定 consumedAt:null + decisionAction:null（不翻已批准闸门），双层 try/catch fail-open 语义不变。8s 与 spec 裁决（5–10s 中值）一致。②acceptance 1：`expect(init.signal).toBeInstanceOf(AbortSignal)` 在位，git log -L 证实该行恰源自 4bd1fd9；「发送失败复位」用例仍绿。③acceptance 2：既有 7 + 探针 4 = 11/11 全绿；探针零改动双重机械证据（全史单 commit + diff 0 行）。④evaluator 补充实证（新建 tests/server/harness-gate-notify-timeout-probe.test.ts，3/3 绿）：T0 真实 AbortSignal.timeout(5ms) 到期 reason.name==='TimeoutError'；T1 mock fetch 以 DOMException('TimeoutError') reject → resolves undefined，updateMany 恰 2 次（claim+复位），复位 where 含 consumedAt:null+decisionAction:null；T2 发起时刻 signal 是未 aborted 的 AbortSignal 实例。T0+T1 合成「真实超时 → 复位重试」实证链。⑤acceptance 3：npm run verify exit 0。",
  "steps_to_reproduce": "npx vitest run tests/server/harness-gate-notify.test.ts tests/server/harness-gate-notify-evaluator-probes.test.ts tests/server/harness-gate-notify-timeout-probe.test.ts（14/14 绿）；npm run verify；git show 4bd1fd9；git log --oneline -- tests/server/harness-gate-notify-evaluator-probes.test.ts"
}
```

## F007 · dispatch 用量 model 归因补全 — PASS

```json
{
  "feature_id": "F007",
  "result": "PASS",
  "evidence": [
    "[验收1·框架侧 PASS] 框架仓 v1.10.0 tag=6743a0f，VERSION 账本=1.10.0；TMPDIR=/tmp 实跑提取器测试 10/10 OK，含 argv 钉住值填充（断言 usage shape 恒 8 键不新增）、事件流优先、畸形/缺失钉 5 变体全 null（含 '-c model=' 空值）。本仓 sync：harness.json/harness.lock 均钉 1.10.0；.claude/dispatch/ 副本与框架仓 md5 逐一相同",
    "[验收2·服务端 PASS] tests/server/harness-dispatch-usage.test.ts 13/13 绿。updateMany where 钳 {deviceId, source, sourceEventId, model: null} + data {model} 恰调用一次（SQL 层保证已有非空 model 不可能被覆盖）；无 model 报文零调用；attribution_only 跳过刷新且不物化（kimi 双计费防线保持）。实现核证 route.ts:847-860：updateMany 先于幂等 upsert（update:{}），token 列不可变语义未破",
    "[验收3·实物+链路 机器侧全绿] .harness-dispatch/run-meta-build-*.json 4 个文件 usage.model 均='gpt-5.6-sol'，input_tokens={1634158, 4017045, 1736673, 2150425} 与上批账目逐条一致（合计 9,538,301≈9.54M）。origin/main=f3d7a9a 含 c9bad90（生产已部署）；本机 agent 已重装（checkout f3d7a9a）并重启，最新一轮上报 04:45:35Z reported=9 failed=0——tokenizer 无 issue，残余 1 条属 newkolmatrix（他项目遗留）。[L2] 生产 /events 4 条事件 model 目视确认待用户",
    "[验收4 PASS] npm run verify exit=0；lint 0/0；npm run test 全量 1127 passed / 10 skipped 无失败",
    "[非阻断观察] 本地 HEAD=75bbca8（F004 标题修复）尚未推送——纯状态文件不触发部署，按阶段边界落盘规则由编排者随收尾补推"
  ],
  "steps_to_reproduce": "① 框架仓 git rev-parse v1.10.0^{commit} + TMPDIR=/tmp python3 templates/claude/dispatch/test-extract-run-usage.py + 两仓 md5 比对 ② npx vitest run tests/server/harness-dispatch-usage.test.ts ③ python3 逐读 .harness-dispatch/run-meta-build-*.json ④ tail ~/.tokenizer/logs/agent.log 看 04:45:35Z 行 failed=0 ⑤ npm run verify + lint + test"
}
```

---

## Soft-watch 与观察项汇总（分片提出，非阻断，编排者机械转录）

1. **上批 soft-watch 闭环**：BL-GATE-INBOX signoff soft-watch #2（notify fetch 无超时）由 F006 正式消除。
2. **F004 观察**：`decodeEventsCursor` 接受 Date 极值规范 ISO 串（语义等价首页，无故障面）；如追求语义洁癖可在未来批次加时间界校验。
3. **F001 观察**：userRows 过滤会折叠用户 crontab 空行——与旧实现行为相同，无回归。
4. **环境事件（F004 分片披露）**：本机 5434 端口是既有 SSH 隧道，起临时库前先 `lsof -nP -iTCP:<port>` 探测。
5. **CI flake 记录**：agent-lifecycle SIGTERM 用例在 CI 首跑红、重跑绿（同 SHA），本地 5 连跑 + 两个分片实跑均绿；留观，如再现率上升考虑加固该用例。

## L2 未尽项（生产行为，用户目视）

- **F007**：`/events` 既有 4 条 codex 事件 model 应显示 `gpt-5.6-sol`（补写报文已 failed=0 落地，等待用户确认闭环上批观察）。
- **F004**：登录态 >200 条「更旧」翻页走查（查询层等价物已在 scratch DB 机械证实）。
- **F001/F005**：cron fallback 主机的 2 分钟闸门延迟需该类主机重装后生效（本机为 launchd 主机；控制台已对 behind 设备亮升级提示）。
