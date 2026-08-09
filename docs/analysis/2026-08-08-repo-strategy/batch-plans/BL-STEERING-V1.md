# BL-STEERING-V1 落地方案

## 目标

为控制台→机器方向新增第三种签名下行——**任务指令通道 v1（pause / cancel / note）**，让人类能在批次运行中途（而非仅阶段闸门被举起时）向某台机器上的某个批次投递一条经 Ed25519 签名的「建议指令」。复用 mode intent 已生产验证两轮的骨架：服务端签发（fail-closed）→ device agent 出站拉取 → 敌意输入解析 + 验签 → 原子落盘 + commit → ACK 状态机 → 编排者在阶段边界/自主唤醒时消费。**指令是建议槽位而非控制通道**：控制台仍不写 status / features / autonomy-policy，pause/cancel 的机械强制力只存在于自主模式（gate-arbiter 把它当 halt 条件），交互模式下由 Coordinator 在阶段边界向人类呈报。本通道同时是远期 P4 跨机派活的直接前身（roadmap.md 远期表）。

## 范围（In / Out）

**In：**
- 框架侧契约（harness-template，跨仓）：`steering.json` 槽位 schema、验签校验器、消费规则文档（console-mode.md 新增 §3.5 + 红线修订）、autodrive/session-start 消费接线、发版进 `framework-releases.json`
- tokenizer 服务端：`HarnessSteeringDirective` 表、签发/撤销 API、中继/ACK API、report 侧消费状态回收
- tokenizer agent：中继第四步（staging + ACK）、report 摘要上行
- 控制台 UI：详情页签发卡片 + Activity 时间线 + 签发阻断器
- `AGENT_FEATURE_VERSION` bump（理由见协议节）

**Out（刻意不做）：**
- **实时性改进**（推送、缩短轮询间隔）——留给 BL-AGENT-LATENCY（cron 双条目已在近期批次表）；v1 接受 60s~15min 的下行延迟，UI 文案如实标注
- **指令直接改变状态机**（cancel 直接置 status、pause 中断正在跑的 subagent）——违反 console-mode.md:350-358 红线，永不做；机械强制力只经由 autodrive halt 路径
- **批量/跨项目指令、指令模板、多操作员分级**——留给远期企业治理层批次
- **dispatch 派活载荷**（「一批活」而非「一条指令」）——留给 P4 跨机调度批次，本批只把通道形状铺好
- **gate decision / mode intent 两条既有通道的任何行为变更**——零改动，只共用 `signHarnessPayload`/`canonicalJson`/relay 身份中间件

## Features 预案

**F001 · 框架侧 steering 契约与守门机件（harness-template v1.8.0）** · executor: generator
涉及文件（harness-template 仓，路径按既有 console 机件目录类推）：`templates/claude/console/steering.schema.json`（新）、`templates/claude/console/validate-steering.sh`（新，仿 `validate-mode-intent.sh`）、`templates/claude/console/test-steering.py`（新，仿 `test-mode-intent.py`）、`harness/console-mode.md`（新增 §3.5 + §8 红线第 1 条修订）、`harness/autonomous-mode.md` 与 `templates/claude/autonomous/gate-arbiter.workflow.js`（pause/cancel 作 halt 条件，未核——以框架仓实际结构为准）、`VERSION`/`CHANGELOG.md`/`harness/framework-releases.json`（发版 v1.8.0）。
acceptance：
1. `steering.json` 契约定型：根级 `{schema_version, directives[]}`；每条 directive 白名单字段 `{directive_id, repo_key, kind(pause|cancel|note), batch, detail, issued_by, issued_at, directive_expires_at, sig}` + staging 元数据 `{staged_at}` + 消费元数据 `{consumed:{at, by, outcome(honored|declined|expired)}}`；validator 拒绝白名单外字段、坏签名、过期、repo 不符（跑 `test-steering.py` 全绿）
2. pause/cancel 必须携带 `batch` 且 staging 时与 `progress.current_sprint` 一致方可落盘（陈旧指令不得暂停下一批次）；note 允许 `batch: null`——负向 fixture 各至少 1 条
3. console-mode.md §8.1 修订后明确列出控制台三种写操作（gate decision / next-batch intent / steering directive），且写明「steering 是建议槽位：交互模式呈报人类、自主模式作 halt 条件，均不直接改 status/features」
4. `release-contract` CI 绿（VERSION = releases 末项 = 1.8.0，CHANGELOG 双向一致）
5. 不改动 pending-gate / mode-intent 既有 schema 与校验器的任何断言（其测试原样全绿）

**F002 · 服务端数据模型 + 签发/中继 API** · executor: generator
涉及文件：`prisma/schema.prisma`（新 model，仿 390-422 行 `HarnessModeIntent`）、新增 migration、`app/api/harness/steering/route.ts`（新，仿 `app/api/harness/mode-intents/route.ts`）、`app/api/harness/steering/relay/route.ts`（新，仿 `app/api/harness/mode-intents/relay/route.ts`）、`src/server/harness-steering-api.ts`（新，parse/ACK 矩阵，仿 `src/server/harness-mode-intent-api.ts:609-696`）、`src/server/harness-sign.ts`（零改动，直接复用 `signHarnessPayload`）、`src/shared/agent-feature-version.ts`（bump + 新门槛常量）。
acceptance：
1. POST 签发前置门槛与 mode-intents/route.ts:130-156 同构：fresh report（409 stale_report）、`agentFeatureVersion >= MIN_STEERING_AGENT_FEATURE_VERSION`（409）、pause/cancel 时 `project.batch` 与指令 batch 一致（409）；签名 key 未配 503 fail-closed（与 gates/route.ts:104-110 同模式）
2. 签发时同 kind 的 active（issued/relayed/staged）指令 serializable 事务内 supersede（pause/cancel 单活跃；note 允许并存、上限 5 条 active，超出 409）
3. relay GET 只下发 `signature != ""` 且未过期者，过期先扫成 expired，issued→relayed 原子标记（与 relay/route.ts:32-66 同构）；POST ACK 走 staged/consumed/failed 状态矩阵 + 幂等重放 200
4. DELETE 撤销仅 issued/relayed → superseded，其余 409 invalid_transition
5. `npx prisma migrate dev` 生成的 migration 纯新增（新表 + 索引，不触碰既有表）；`npm run verify` 通过

**F003 · device agent 中继落盘 + report 消费回收 + 框架镜像同步** · executor: generator
涉及文件：`src/cli/harness-steering.ts`（新，仿 `src/cli/harness-mode-intents.ts:136-454`：敌意输入 bounded 解析 → console.pub 验签 → 文件锁 + dirty 拒 + 原子写 `steering.json` + 只 add/commit 该文件 + 回滚/ack_pending 路径）、`src/cli/harness.ts`（`runHarnessSync` 640-693 行加第四步互不阻塞；`buildReport` 206-284 行加 bounded steering 摘要）、`app/api/harness/report/route.ts`（652-683 行同模式：从 report 摘要把 staged→consumed 回收）、`src/shared/harness-health.ts:6`（`HARNESS_SYNC_OPERATIONS` 加 `"steering"`）、`framework/**` + `harness.json`/`harness.lock`（受控 sync 到 v1.8.0）。
acceptance：
1. staging 守门逐条可测：invalid_signature / repo_mismatch / directive_expired / batch_mismatch / steering_dirty / 幂等 retry 复用原 staged_at——每条一个失败 code 断言（仿 harness-mode-intents.ts 的 failure code 集）
2. 落盘产物 = `steering.json` 追加一条含 `sig` 的完整原始指令 + `staged_at`，commit message `chore(steering): stage <directive_id> from console`，绝不触碰 progress.json / harness.json
3. `runHarnessSync` 四步中 steering 一步整体抛错不影响 report / mode-intent / gate relay 三步（catch 进自己的 issues，与 645-661 行同构）
4. 编排者消费后（写 `consumed` 块并 commit），下轮 report 摘要使服务端该指令进入 consumed 终态；ACK 丢失场景下 report 通道兜底收敛（双通道确认，与 mode intent applied 同模式）
5. tokenizer 自身 `harness.lock` 对账 verify 全 ok，`framework/harness/framework-releases.json` 末项 = 1.8.0，模式徽章不显示落后

**F004 · 控制台 UI：签发卡片 + 时间线** · executor: generator
涉及文件：`app/harness/[id]/steering-actions.tsx`（新，仿 `app/harness/gate-actions.tsx` 的 confirm+note 交互）、`app/harness/[id]/views.tsx`（`ActivityView` 540 行起加 steering 时间线段）、`app/harness/[id]/page.tsx`（挂载入口）、`src/server/harness-detail.ts`（38-104 行 include 加 `steeringDirectives` take 50）、`src/shared/harness-detail.ts`（`modeIssuanceBlocker` 600 行旁新增 `steeringIssuanceBlocker`：signingKey / stale report / agent 版本三种 blocker）、i18n 文案文件（`messages/` 目录，未核具体文件名）。
acceptance：
1. 详情页可对活跃批次发起 pause/cancel/note；kind 选择 + detail 必填（≤2000 字）+ 二次确认；cancel 的确认文案明示「建议性——交互模式在下一阶段边界呈报人类，自主模式下一次唤醒停机」
2. blocker 场景（key 未配 / report 陈旧 / agent < 门槛）按钮禁用并显示与 mode-editor 同风格的原因行
3. Activity 时间线渲染每条指令的 `issued→relayed→staged→consumed/failed/expired/superseded` 状态与时间戳（UTC 存储、按用户时区显示）
4. UI 全部为只读镜像 + 签发操作，`grep` 断言无任何写 HarnessProject.status/features 的代码路径
5. `npm run lint` + `npm run verify` 通过

**F005 · 跨仓独立验收** · executor: evaluator
涉及文件（只写产物）：`docs/test-cases/BL-STEERING-V1-cases.md`、`docs/test-reports/BL-STEERING-V1-verdict.json`。
acceptance：
1. 隔离 evaluator 从两仓锁定 SHA 读实物验收（不信任 handoff），generator 与 evaluator model_family 互斥
2. 双向契约实测：tokenizer 服务端签发物过框架 `validate-steering.sh` 验签；框架 fixture 灌进 tokenizer relay 解析器（对齐战略 §3.2 contract-conformance 思路）
3. 端到端往返实测一次：本机签发 pause → agent staging → 模拟编排者消费 → report 回收至 consumed，全链路 git commit 轨迹可查
4. 红线审计：确认无代码路径让指令改写 status/features/autonomy-policy；staging 失败路径 fail-closed（坏签名指令零落盘）
5. 全量 `npm run test` + `npm run verify` + `npm run build` 绿，verdict 按 schema 落盘、逐 feature PASS/FAIL

## 数据模型 / migration

新表 `HarnessSteeringDirective`（纯新增 migration，不动既有表），字段仿 `prisma/schema.prisma:390-422` 的 `HarnessModeIntent`：

```
id / userId / harnessProjectId / directiveId / kind / payload Json / signature
status ("issued|relayed|staged|consumed|failed|superseded|expired") / issuedBy / issuedAt
directiveExpiresAt / relayedAt / stagedAt / stagedCommitSha / consumedAt / consumedOutcome
failedAt / failureCode / failureDetail / createdAt / updatedAt
@@unique([harnessProjectId, directiveId]) · @@index([harnessProjectId, status]) · @@index([directiveExpiresAt])
```

**槽位裁决（机器侧）：独立根文件 `steering.json`，不放 progress.json 也不放 harness.json。** 理由对比两个先例：`pending_gate` 放 progress.json 成立的前提是「机器先举起槽位、人只填 decision」，而 steering 是控制台首发，且 progress.json 是状态机热文件——mode intent 已实证 dirty 拒写（`harness_dirty`）是真实竞态，pause 恰恰最常在 progress.json 最热的批次中段到达；`mode_defaults` 放 harness.json 成立的前提是「单活跃槽 + 冷文件」，而 steering 是队列语义（pause+若干 note 可并存、逐条消费），塞进框架账本文件会让 `harness.lock` 语义与操作性指令混流。独立文件获得：独立文件锁、独立 dirty 域、队列结构、消费记录原地留痕（git 即审计）。最终路径命名权在框架契约（F001），本方案作为通道 B 实现方的推荐输入。

## API 与协议影响

**新增 endpoint（均为纯新增，不改既有路由行为）：**
- `POST/GET/DELETE /api/harness/steering` — 网页会话鉴权，签发/列表/撤销（仿 `app/api/harness/mode-intents/route.ts`）
- `GET/POST /api/harness/steering/relay` — device token + `withHarnessRelayIdentity` 身份头（复用 `src/server/harness-relay-identity.ts`），下发/ACK（仿 `app/api/harness/mode-intents/relay/route.ts`）
- `POST /api/harness/report` — 载荷新增**可选** `state.steering` bounded 摘要（旧 agent 不发即忽略，向后兼容）

**AGENT_FEATURE_VERSION：bump 9 → 10，`MIN_AGENT_FEATURE_VERSION` 同步 10，另加 `MIN_STEERING_AGENT_FEATURE_VERSION = 10` 作签发门槛。** 理由：这不是纯 bug 修复而是新下行能力——capability 9 的 agent 根本不轮询 `/steering/relay`，人类签发的 pause 会永远躺在服务端，与 `src/shared/agent-feature-version.ts:25-28` 记录的 capability 3 陷阱（「批准了机器却拿不到」）同型，按该文件 14-17 行的 bump 准则属于「prompting is not cosmetic」情形；独立门槛常量则保证未升级设备在 UI 上看到精确 blocker（agent_upgrade_required）而非静默失效。**协议影响最小化**：全部新增皆 additive，9 台消费者项目的旧 agent 除升级提示横幅外零行为变化，两条既有下行通道字节级不变。

**部署触发说明：** F002/F003/F004 改 `prisma/` + `app/` + `src/` + `tests/`，均不在 `deploy-vps.yml` paths-ignore 内（已核实清单只豁免状态类文件与三个 docs 子目录）——**push main 即部署生产，且携带一次 `prisma migrate deploy`（纯新表，前向安全，旧代码遇新表零影响）**。建议提交序：F001 在框架仓发版 → F003 的镜像 sync（paths-ignore，不触发部署）先行单推 → F002+F003 代码与 migration 合并成一次可运行的推送（避免「表已建、路由未上」的中间态窗口，虽无害但缩短）→ F004 随后。agent 二进制升级由用户按机器手动 `install.sh`，服务端先行兼容。

## 测试计划

- `tests/server/harness-steering-route.test.ts`（新）：签发白名单/长度上限、stale_report 409、agent 版本门槛 409、pause/cancel batch 不符 409、key 未配 503、同 kind supersede、note 并存上限、DELETE 状态矩阵
- `tests/server/harness-steering-relay-route.test.ts`（新，镜像 `tests/server/harness-mode-intents-relay-route.test.ts`）：过期扫描、仅签名下发、issued→relayed 原子性、ACK 源状态矩阵、幂等重放、身份头缺失 409
- `tests/cli/harness-steering.test.ts`（新，镜像 `tests/cli/harness-mode-intents.test.ts`）：敌意 relay 解析（超限/超深/坏形状）、验签失败零落盘、staging 全失败 code、幂等 retry、rollback、commit 失败恢复
- `tests/cli/harness.test.ts`（改）：第四步隔离失败不连累其余三步、report 摘要形状、sync snapshot 计数
- `tests/shared/harness-health.test.ts`（改）：`steering` operation 进白名单后的快照解析
- `tests/server/harness-report-mode-intent.test.ts` 旁新增或扩展：report 摘要驱动 staged→consumed 回收
- 框架仓：`test-steering.py` 正/负 fixture 全套（F001 acceptance 1-2）

## 依赖与前置

- **硬前置：F001（harness-template 契约发版）先于 F002-F004**——跨仓串行，先例 BL-FW-RELEASE-CONTRACT（docs/specs/BL-FW-RELEASE-CONTRACT-spec.md §D4 的发布顺序纪律直接照抄）
- **软前置：** 战略 §3.3「版本测试去税」若未先做，F003 的框架 sync（1.7.1→1.8.0）会再缴一次「~10 个版本耦合测试」的税——建议并入本批顺带做或提前一批
- **强烈建议先行：** BL-AGENT-LATENCY（cron 双条目）——否则 cron fallback 机器上 pause 延迟可达 15 分钟，钝化本批次的产品价值（不阻塞，属体验）
- **被依赖：** P4 跨机调度（通道形状直接演进为派活）、看板编排面（拖卡触发 directive）、企业治理层（指令审批分级）

## 风险与对策

1. **语义误读为控制通道（最大风险）**：用户按下 cancel 期待立即停机，实际是边界建议。对策：F001 契约文案 + F004 UI 确认框双处明示生效时机；autodrive 场景给出机械保证（下一唤醒必停），交互场景明示「呈报人类」
2. **跨仓协调翻车**：契约与实现漂移（BL-FW-RELEASE-CONTRACT 的踩坑动机重演）。对策：F005 双向契约实测列为硬验收；tokenizer 侧 CLI 验签直接 import 服务端同一 `canonicalJson`（与 `src/cli/harness.ts:494-499` 注释同理，不写第二份实现）
3. **feature version bump 波及 9 个消费者机器**：升级链路弱，旧 agent 收到升级横幅但短期不升。对策：门槛只拦 steering 签发（精确 blocker），其余功能零降级；发布说明写清「不升级仅失去 steering」
4. **steering.json 与编排者消费竞态**：agent staging 时编排者正在写消费块。对策：与 mode intent 同款文件锁 + dirty 拒 + 下轮重试（retryable issue），F003 acceptance 1 覆盖
5. **note 无消费闭环导致堆积**：对策：active note 上限 5 + 过期扫描 + 编排者消费义务写进框架契约（阶段边界必须把过期/已读 note 标 consumed）
6. **部署窗口**：migration 与路由分推造成中间态。对策：F002+F003 同推；migration 纯新增使任何顺序都前向安全

## 规模估计

**L**。5 features（4 generator + 1 evaluator，跨两仓）。主要涉及文件数：tokenizer 侧新增 ~8（2 route + 2 server/cli 模块 + 1 UI 组件 + 3 测试文件）+ 修改 ~10（schema.prisma、migration、harness.ts、report/route.ts、harness-health.ts、harness-detail.ts×2、views.tsx、page.tsx、agent-feature-version.ts）；harness-template 侧新增 ~3 + 修改 ~6。合计 ~27 个文件。批次内 F001 串行先行，F002/F003 可并行 worktree，F004 依赖 F002 的 API 形状，F005 收尾。