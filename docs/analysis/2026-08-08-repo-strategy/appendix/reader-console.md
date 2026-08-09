# tokenizer「harness 编排控制台」功能面分析报告

## 1) 控制台当前能力清单

### 1.1 多项目进度镜像 —— 已实现
- 数据模型：`prisma/schema.prisma:306-346` `HarnessProject`（镜像 progress.json 的 status/batch/fixRounds/completedCount/totalCount/headSha/signoff/dashboardUrl/autonomyStatus/lastHalt*/features/modes/reportedAt；身份键 `@@unique([deviceId, repoKey])`）。表头注释（schema.prisma:301-304）明确「真相源永远是各机器仓库里的 progress.json / features.json，这两张表是镜像」。
- 列表页：`app/harness/page.tsx`（`force-dynamic` + 30s `AutoRefresh`，page.tsx:73）。七阶段轨迹条（page.tsx:18, 228-242）、完成度进度条（244-249）、fixRounds/autonomyStatus/lastHalt 徽章（213-256）。按 `isFreshHarnessProjectReport`（`src/shared/device-status.ts:51-62`，20 分钟窗口 + 5 分钟时钟偏移容忍）分「活跃」与「历史快照」两区（page.tsx:60-61, 263-300）。
- 详情页：`app/harness/[id]/page.tsx`，三个 tab（overview / modes / activity）；查询在 `src/server/harness-detail.ts:3-107`（gates/modeIntents/dispatchRuns 各 take 50）。
- 本机项目发现：`src/cli/harness.ts:150-186` `discoverHarnessRepos`——判据是同时存在 `progress.json` 与 `harness-rules.md`，只扫 projectRoots 一层子目录；无 remote 的项目用 `local:sha256:<路径哈希>` 不透明身份（harness.ts:159-162）。

### 1.2 人闸门（通道 B 中继）—— 已实现，生产往返实测（console-mode.md:368）
- 闸门上报解析：`app/api/harness/report/route.ts:341-378` `parseGate`（kind 白名单 `GATE_KINDS` 75-84；evidence ≤50 条、只存路径字符串）。
- 网页批准：`app/api/harness/gates/route.ts`——GET 列本人未消费闸门；POST 是**控制台唯一写操作**（文件头注释 9-17），签 Ed25519 后落 `decisionSig`，scope 固定 `{once: true}`（gates/route.ts:98）。已决策/已消费分别 409（77-85）。
- UI：`app/harness/gate-actions.tsx`（confirm + note + approve/reject；响应带 `pendingRelay: true` 提示「批准只是签发」gates/route.ts:131-133）。
- 决策下发：`app/api/harness/decisions/route.ts:32-42`——只下发 `decisionSig: { not: null }` 的闸门；取走标 `relayedAt`，`consumedAt` 留待机器消费后由 report 端回收（60-65 注释）。
- 本机落盘：`src/cli/harness.ts:526-605` `applyHarnessDecisions`——逐条五道守门（详见 §3）。
- 消费回收：report route 640-650——机器上报 gate=null 时，把 `relayedAt != null && consumedAt = null` 的闸门标记 consumed。
- 闸门重举：report route 617-632——同 gateId 且 raisedAt 更新时清空全部 decision 字段重新开门。

### 1.3 模式画像（mode snapshot）—— 已实现
- 采集端：`src/cli/harness-modes.ts:367-419` `buildModeSnapshot`——六维快照：framework 版本+漂移 / execution 形态（fast/heterogeneous/slow）/ autonomy / dispatch（agents、integrations、toolCatalog、familyExclusive、issues）/ gate guardMode（signature vs head-compare，411-414）/ machinery（hooks 在位 + deny-list 合入，263-291）。文件头注释（14-26）钉死「只读镜像不是判定」。
- familyExclusive 复算：harness-modes.ts:231-243（独立性铁则第 5 条的展示层复算，注明权威守门仍是机器侧 hook）。
- 列表页徽章：`app/harness/mode-badges.tsx`（六维压成一行徽章 + issues 列表；56-61 区分「没上报 ≠ 全关」）。
- 详情页 modes tab：`app/harness/[id]/views.tsx:260-378` `ModesAndAgentsView`——current vs pendingNextPlan 双栏对比（303-307）、集成卡片、不可配置的 Coordinator 固定卡（463-500，呼应 console-mode.md:233-235）、五项 health facts（344-351：frameworkDrift / familyExclusive / hooks / denyList / gateSignature）。

### 1.4 框架 drift badge —— 已实现（spec：`docs/specs/BL-FWDRIFT-framework-drift-badge.md`）
- 漂移扫描：`src/cli/harness-modes.ts:101-154` `readFramework`——对 `harness.lock` managed 清单逐文件 sha256，分 ok/modified/missing/customized；10 分钟 TTL 缓存、lock mtime 变即失效（98-99, 119-130）。
- 落后判断：`mode-badges.tsx:63` 用 `frameworkStanding`（`src/shared/framework-version.ts`）；徽章颜色由**落后与否**决定而非漂移数（113-133 注释），behind/unknown 分别给 sync / rebase 可照抄命令（42-48，unknown 基线刻意不给 adopt——注释解释 adopt 在 lock 已存在时会拒绝执行）。

### 1.5 sync health —— 已实现（spec：`docs/specs/BL-HARNESS-SYNC-HEALTH-spec.md`）
- 快照生成：`src/cli/harness.ts:640-693` `runHarnessSync`——report → mode-intents → relay 三步互不阻塞，status ∈ idle/success/degraded/failed，issues 上限 20（`src/shared/harness-health.ts:1`），写入本机 state。
- 上行：心跳 diagnostics 附带快照（`src/cli/sync.ts:102-122`）；服务端 `app/api/devices/heartbeat/route.ts:70-73, 161-164` 持久化 `Device.lastHarnessSyncAt / harnessSyncStatus / harnessDiagnostics`。
- UI：`app/_components/harness-health-badge.tsx`；stale 判定 3 分钟（`harness-health.ts:4, 164-175`）。用在 harness 列表页（page.tsx:197-203）与 devices 列表/详情页（devices/page.tsx:289, devices/[id]/page.tsx:212）。
- CLI 只读入口：`tokenizer harness --status`（`src/cli/harness-command.ts:41-44`）；`--modes` 本地打印模式行（48-55）。

### 1.6 签名模式意图（mode intent，v1 agent-id 形状 + v2 tool-binding）—— 已实现
- 签发：`app/api/harness/mode-intents/route.ts` POST——前置门槛依次为 fresh report（130-135, 409 `stale_report`）、agent featureVersion ≥4（v1）/≥8（v2 tool binding）（136-150；常量在 `src/shared/agent-feature-version.ts:60-65`）、40 位完整 HEAD（151-156）、tool catalog 可用（168-173）；`normalizeHarnessModeIntentPayload` + `signHarnessPayload` 后 serializable 事务内 supersede 旧 active 再 create（215-240）。DELETE 撤销（issued/relayed → superseded，245-291）。
- 下发/回执：`app/api/harness/mode-intents/relay/route.ts`——GET 先把过期的标 expired（32-40），只发 `signature != ""` 的，issued→relayed；POST ACK 走 staged/applied/failed 状态机 + 幂等重放（127-164）。
- 本机 staging：`src/cli/harness-mode-intents.ts:311-454` `stageHarnessModeIntent`——验签 → payload 校验 → relay/signed/discovered 三方 repo_key 一致（328-337）→ 文件锁 → harness.json dirty 拒 → 幂等 retry 复用原 staged_at → `expected_head_sha` 只在首次 staging 前比对（306-310 注释，即 console-mode.md:270-272 的 HEAD phase rule）→ 原子写 `project.mode_defaults` → add/commit，每步失败有回滚路径，commit 返回但验证不了时给 `ack_pending`（440-447）。
- 编辑器 UI：`app/harness/[id]/mode-editor.tsx`（875 行；profile / 三角色 tool+invocation / autonomy budget / 错误码映射 57-90）；签发阻断器 `modeIssuanceBlocker`（`src/shared/harness-detail.ts:600-622`：signingKey / stale report / agent 版本 / HEAD / snapshot / catalog 六种 blocker）。
- applied 闭环：report 成功后补发 applied ACK（`src/cli/harness.ts:366-385`）；report route 652-683 亦从 state.modeDefaults / state.modeIntent 同步 staged/applied——ACK 与 report 双通道确认。
- Activity tab 渲染 intent 时间线（views.tsx:546-580）。

### 1.7 dispatch run 镜像 —— 已实现
- 本机扫描：`src/cli/harness-dispatch.ts`（`.claude/dispatch` run meta，≤50 文件/64KB/敌意输入白名单校验，1-27）；report route 685-715 upsert `HarnessDispatchRun`；Activity tab 表格（views.tsx:617-654）。

### 1.8 agent 身份防降级 —— 已实现
- report 方向：`app/api/harness/report/route.ts:406-450` `reporterCanWriteHarness` / `reporterPromotesDevice`——旧 daemon 不能覆盖新 Agent 已建立的控制面数据（409 `stale_agent_report`）。
- relay 方向：`src/server/harness-relay-identity.ts:127-184` `withHarnessRelayIdentity`——capability ≥9（`agent-feature-version.ts:71`）后 relay 必须带成对身份头（47-65），Device→DeviceToken 锁序与 report 一致防死锁（135-151 注释）。

### 1.9 只在 spec、代码没有的
见 §4。

## 2) 端到端数据流

```
[上报 ↑]
launchd 常驻 agent tick（src/cli/agent.ts:190-224，HARNESS_MS=60s，单飞防叠加）
  → runHarnessSync（src/cli/harness.ts:640）
  → buildReport（harness.ts:206-284）：progress.json + features.json + git HEAD
      + buildModeSnapshot + readModeDefaultsReportSummary + scanHarnessDispatchRuns
      + agent 身份 {releaseVersion, featureVersion}（253-256）
      · 只上报"尚无 decision"的 pending_gate（232-246，防本机旧副本覆盖服务端决策）
  → POST /api/harness/report（Bearer device token → hashToken 查表，src/server/auth.ts:40-49）
  → serializable 事务（report/route.ts:495-721）：锁 Device → 复核 token 未吊销
      → 身份防降级 → repo 身份 reconcile（legacy alias 迁移，198-266）
      → HarnessProject upsert → gate upsert/重举/消费回收
      → modeDefaults→staged、modeIntent→applied → dispatchRuns upsert
（另路）心跳携带 sync health 快照 → Device.harnessSyncStatus（sync.ts:102-122 → heartbeat/route.ts:161-164）

[展示]
/harness 与 /harness/[id]（force-dynamic + 30s AutoRefresh，均按 session.userId 过滤）

[批准 ↓]
人按 approve/reject → POST /api/harness/gates（next-auth 会话）
  → signDecision（Ed25519，HARNESS_CONSOLE_SIGNING_KEY）→ decision* + decisionSig 落库
  → device agent 下轮 GET /api/harness/decisions（只拿已签名未消费；标 relayedAt）
  → applyHarnessDecisions（harness.ts:526-605）：
      exact repoKey 匹配（549-559，刻意不归一化路由——legacy alias 与现役项目可能复用 gate id）
      → verifyDecision 用仓库 .claude/console/console.pub 验签（500-515；canonicalJson 直接 import 服务端同一实现，注释说明防两份实现漂移）
      → pending_gate.id === gate_id · 无既有 decision · progress.json 无未提交改动
      → 原子写 + 只 git add/commit progress.json（596-597，绝不 add -A）
  → 机器状态机消费批准、清空 pending_gate → 下轮 report gate=null → 服务端标 consumedAt（640-650）

[mode intent ↓]
UI 签发（supersede 旧 active）→ relay GET（先 expire，issued→relayed）
  → stageHarnessModeIntent 写 harness.json project.mode_defaults + commit（chore(mode): stage ...）
  → ACK staged（含 stagedCommitSha）→ 下次 /plan 边界由框架消费进 progress.mode_intent
  → agent report 带 modeDefaults/modeIntent 摘要 → 服务端状态机推到 staged/applied
```

## 3) 契约与安全设计要点

- **签名**：`src/server/harness-sign.ts`——Ed25519，canonicalJson **递归**键排序 + 紧凑分隔符（31-38，注释记录了「只排顶层键在 scope 有多键时验签必失败」的坑）；签**全字段**除 sig（对应 console-mode.md:116-118 记录的 scope 未签名可把 once 改永久的实测漏洞）。私钥接受 PEM 原文或 **PEM 的 base64**（60-65），后者是部署路径必需——`.env` 不支持多行值，塞 PEM 原文表现为「服务起来了、批准键一直 503」。
- **fail-closed 清单**（每处都有代码落点）：
  - 签名 key 未配：批准 POST 503（gates/route.ts:104-110，注释「落一条无签名的决策等于给机器一条无法验证来源的批准」）；mode intent 签发 503 `signing_unavailable`（mode-intents/route.ts:204-213）；UI 侧 `signingKeyReady()` 预先禁用按钮并显示警示（harness/page.tsx:56, 75-82）。
  - 未签名决策**不下发**（decisions/route.ts:36 `decisionSig: { not: null }`；文件头注释 15「宁可卡住」）。
  - 本机无 console.pub 或验签失败**不落盘**（harness.ts:561-565）。
  - 陈旧批准防护：decision.gate_id 必须等于本机 pending_gate.id（harness.ts:581-584，对应 console-mode.md:95）。
  - stale report / 短 HEAD / 旧 agent 一律拒签 intent（mode-intents/route.ts:130-156）。
  - relay 身份缺失即 409（harness-relay-identity.ts:161-162）。
- **红线遵守**（console-mode.md §8）：控制台唯一写 = 闸门 decision 签发 + 下一批次 intent 签发；不写 status / features / autonomy-policy（gates/route.ts:15 注释、schema.prisma:304 注释、mode intent 只落 harness.json `project.mode_defaults` 且 `/plan` 消费后不再显示为 pending——harness-mode-intents.ts:514-519）。镜像渲染不影响状态机；上报失败逐项收集不中断（harness.ts:319-332 注释：不能让镜像的问题卡住人在等的批准通道）。
- **最小授权**：每张批准 scope `{once: true}`（gates/route.ts:98）；记名归属 by/at（87-89，email 优先）。
- **输入防御**：字段白名单 `exactRecord` + 长度上限贯穿 report/intent 解析；bounded JSON（report 256KB、API 64KB，`harness-mode-intent-api.ts:29-30`；CLI 侧 relay 响应 64KB/深度 12/节点 5000，`harness-mode-intents.ts:118-133`——把服务端响应当敌意输入解析）。
- **并发正确性**：serializable + retry（`serializable-transaction.ts`），Device→DeviceToken 锁序在 report 与 relay 两条路径显式一致（report/route.ts:498-522、relay-identity.ts:135-151 注释说明与 force-enroll 轮换的围栏关系）。
- 测试覆盖：`tests/cli/harness*.test.ts`（8 个）、`tests/server/harness-*.test.ts` + `heartbeat-harness.test.ts`（8 个）、`tests/shared/harness-*.test.ts`（4 个）。

## 4) 未完成 / TODO / spec 有代码无

1. **P3 agent 实时日志上报、P4 云端跨机调度**：`framework/harness/console-mode.md:335-348` 明确「设计已定未实装」；本仓无任何日志流上报或任务路由端点（HarnessDispatchRun 只是事后镜像，不是派活通道）。
2. **多操作员与权限分级 / TLS 终结**：console-mode.md:347-348 列为未做；tokenizer 侧闸门批准是单 session 用户模型，无审批分级。
3. **`dashboardUrl` 存而不显**：入库（schema.prisma:323、report/route.ts:575）、detail 查询选取（harness-detail.ts:17），但 `grep dashboardUrl app/ --include=*.tsx` 零命中——控制台 UI 没有任何地方渲染 dashboard 链接。
4. **dispatch run 的 `artifactPath` / `artifactSha256` 存而不显**：入库（schema.prisma:443-444、report/route.ts:702-703），但 detail 查询（harness-detail.ts:81-104）不取、Activity 表格不显示。
5. **闸门 evidence 只显示路径文本**：console-mode.md §6 的「取证读取（仓库内 docs/ 文件）」是通道 A `console/server.py` 的能力；tokenizer 控制台无对应的 evidence 内容查看端点，UI 仅列路径字符串（page.tsx:124-130）。
6. **决策无 expires_at 路径**：`HarnessDecisionPayload.scope` 类型支持 `expires_at`（harness-sign.ts:22），但 gates route 只签发 `{once: true}`，服务端从未产生限期授权；无对应 UI。
7. **通道 A（git push 模式控制台）不在本仓**：console-mode.md §4 的 `console/server.py + ui.html` 属框架侧自托管组件，tokenizer 只实现通道 B 中继契约（console-mode.md:291-296 亦如此定位）。
8. 已知遗留（`.auto-memory/project-status.md`）：Windows CI `install-agent-lifecycle` 测试失败待另批修复；本机 Agent parser 修复待重装。

**关键文件索引**：`app/harness/{page.tsx, gate-actions.tsx, mode-badges.tsx, [id]/{page,views,mode-editor}.tsx}` · `app/api/harness/{report,gates,decisions,mode-intents,mode-intents/relay}/route.ts` · `src/server/{harness-sign,harness-detail,harness-mode-intent-api,harness-relay-identity}.ts` · `src/cli/{harness,harness-modes,harness-mode-intents,harness-dispatch,harness-command,agent}.ts` · `src/shared/{harness-health,harness-detail,harness-mode-intent,device-status,agent-feature-version}.ts` · `prisma/schema.prisma:301-457` · `framework/harness/console-mode.md`