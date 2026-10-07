# Tokenizer 完整升级优化计划

- 日期：2026-10-07。
- 基线：`2074991717abaf3cb34d9aad894bcd4357fefbc3`。
- 状态：**Proposed / 规划建议，未授权实施，也不是验收或发布结论**。
- 交付位置：独立 detached worktree `tokenizer-upgrade-plan-20261007`；只增加本目录的计划文件。
- 机器可读工作包、依赖、问题和 backlog 映射见 [plan.json](plan.json)。

## 1. 结论与规划边界

主线是 **可信采集与账本 -> 稳定的查询工作台 -> 可行动的运维控制台 -> 成本与质量分析**。不推倒重建，不先换技术栈，也不把全部整改和新增功能塞进一个发布。

依据两份同基线报告：

| 输入 | 当前结论 | 对本计划的影响 |
| --- | --- | --- |
| 全工程 `docs/test-reports/review-20261007/README.md` | C，54/100，14 项 R01-R14；下一轮功能发布 Not ready | 安全、隐私、漏数、乱序覆盖、账本缓存及交付可靠性优先 |
| 前端 `docs/test-reports/frontend-review-20261007/README.md` | C，51/100，17 项 FR-001-FR-017，其中 6 项 P1 | 修复真实用户旅程，建立真实 DB + 浏览器回归门禁 |
| 当前 `progress.json` / `features.json` | BL-HOMEPAGE-FRESHNESS 为 verifying，F005 为 pending | 不借本计划签收旧批次；先安排独立验收或由编排者明确独立热修复路径 |
| `backlog.json` | 19 个待办 | 复用既有条目，更新过时前提；不重复立项已落地的分页、Inbox、归档、quota 账号隔离等 |

两份报告的 31 个编号是追踪入口，不是 31 个互不相关的问题。例如 R10 与 FR-001/FR-007 合并到同一工作包。原报告不被改写，修复结果通过新的独立复验报告引用它们。

本次重新核对了原仓库 HEAD、状态文件、backlog、部署 workflow 和两份报告；原工作区仍是 856 项模式变化、0 行内容增删。未检查现网数据或重新执行产品测试，不把计划的结构检查算成产品验收。

**In**：依赖安全、采集隐私、Agent 可靠性、入库契约、账本与缓存、前端闭环、可访问性、CI/发布恢复、查询导出、成本解释、预算、设备和 Harness 运维、留存性能、归因分析以及有前置条件的扩展。

**Out**：实际开发/迁移/清理/凭据轮换/发信/安装/推送/部署；修改状态机或实际人闸门；无需求依据的团队 SaaS、支付、微服务化、换 ORM/数据库、合仓、任意远程 shell、自动批准人闸门、全站 WebSocket 重写。

## 2. 先修正旧规划中的危险或过时前提

1. **永久成本缓存不是正确性优化。** BL-COST-PERF 历史描述把 closed batch 永久缓存视为已完成成果；R05 证明底层事件可迟到、可修正。改为有界 TTL + usage/price revision 或定向失效，不能只更新首页。
2. **安装清单不可达，不应静默回退 main。** BL-AGENT-SUPPLY-CHAIN 旧方案的 WARN 后追 main 与锁版目标冲突。生产路径保留已校验旧版或停止升级；开发逃生口必须显式选择、显示风险、不可被默认 UI 调用。commit pin 不等于完整发布来源校验。
3. **Device 解耦不用一轮直接删列作默认。** BL-DEVICE-DECOUPLE 旧方案有旧进程读已删列的窗口。改为 expand -> 回填/校验 -> 兼容双写/切读 -> 观察 -> contract；一次 push 不能替代新旧 app 的 schema 兼容。
4. **Windows 修复不是把真实能力测试 skip 掉。** POSIX 专属命令可以限定平台，但要补等价 Windows 生命周期验收；Windows agent 发布必须等待 Windows 证据，服务端发布按其影响范围判断。
5. **预算不把未定价解释为免费。** 已定价小计可以用于展示，但必须同时给未定价规模/覆盖率；金额不完整时不能发出“安全低于预算”的确定结论。
6. **旧版本号和完成状态不直接照搬。** Agent 当前 feature/min 为 9/9；正式批次启动时按实时账本和 CLAUDE 规则确定版本。纯修复不 bump 能力版本；新增 Agent 能力按当前硬约束同步处理两个常量，并设计升级兼容窗口。
7. **报告通过用例不等于缺陷已修复。** 全工程的 11 个 probe 断言的是旧缺陷行为，需改成期望不变量并由独立 Evaluator 重跑。前端 fixture session 不等于真实 magic-link 送达或生产 F005 验收。

这些是本计划的替代建议；未直接修改旧 backlog、批次方案、框架或发布规则。

## 3. 分阶段交付与依赖

工作包 B00-B29 是本文件内的规划编号，**不是已经启动的 Harness batch**。实际每批从中选取小范围，先锁 spec/acceptance，再由编排者物化正式 features。既有 backlog 使用原 ID，不再建同义条目。

| 阶段 | 工作包 | 目标与退出闸门 | 粗排研发人日 |
| --- | --- | --- | ---: |
| M0 接管与门禁 | B00-B01 | 当前批次去留明确；相同锁文件、真实 PG、契约与浏览器关键旅程能在 CI 执行 | 2-4 |
| M1 安全与可恢复交付 | B02-B05 | 默认不上传正文/凭据；依赖处置有证据；Agent 可回退；部署 SHA、配置与恢复演练闭环 | 12-20 |
| M2 数据正确性 | B06-B09 | 入库前校验；不漏后更新；多 writer 不丢事件；旧 revision 不覆盖新；项目不串；成本可重算 | 10-16 |
| M3 现有前端稳定 | B10-B14 | 17 项前端 findings 收敛；6 项 P1 无遗留；核心移动/键盘/错误/语言主题旅程通过 | 7-12 |
| M4 查询与预算工作台 | B15-B17 | URL 查询/钻取/导出同口径，成本可解释，预算与提醒不冒充实付或自动熔断 | 10-16 |
| M5 可行动运维 | B18-B20 | 设备排障与生命周期闭环、Gate/intent 送达可解释、provider 调研有 go/no-go | 8-14 |
| M6 可扩展分析 | B21-B23 | 留存/性能有测量与重算能力，精确/估算归因区分，质量分析披露样本和混杂因素 | 12-20 |
| M7 有条件的高级能力 | B24-B29 | 按需选择解耦、证据、结构化 live、steering、轮换建模及框架维护 | go/no-go 后另估 |

估算以一条实现主线、现有技术栈为前提；M0-M6 合计约 **61-102 研发人日**，另预留独立验收、复验和故障演练约 20%-30%。M0-M3 稳态底座约 31-52 研发人日。数字仅用于量级/资源讨论，B00 后按真实工作量重估，允许约 +/-50% 偏差；不含等待用户授权、真实邮件/平台环境、厂商接口研究及 M7 的实施时间，不承诺日历截止日期。

### 3.1 排序不是把安全修复锁在长计划后面

- B00 是分流与基线确认，不要求在无法验收 F005 时假写 done。可先准备只读证据、测试和规格。
- 紧急安全热修复由编排者明确独立范围与发布授权；保留 F005 pending，不覆盖 active batch，也不把缺失验收转换成 PASS。
- B02/B03/B04/B05 可按接口边界分开准备；涉及 Agent 协议能力的修复/新功能发布必须有 B04 的交付基础。
- B10-B14 的前端修复可在 M2 期间分包开发、单独验收；M3 稳态版本发布必须同时满足 M1/M2 相关正确性闸门。
- M4 及以后属于扩大功能面，必须等待 M0-M3 的相应阻断项闭环。不能以新 UI 掩盖账本/输入/采集缺陷。

关键依赖：

```text
M0 -> M1/M2/M3 的小批修复 -> G1 稳态底座
G1 -> 统一时间/Explorer -> 成本解释 -> 预算
G1 -> 设备诊断 -> Gate/intent 恢复 -> 授权 provider probe
账本修复 -> 留存/性能与精确归因 -> 成本 x 质量分析
隐私 + 可回退 Agent + Device 解耦 -> 白名单证据/结构化 live
上游协议 + 双向契约 + 人类授权 -> steering
```

同改 `src/server/ingest.ts`、`summaries.ts`、harness report、heartbeat 或 migration 的包串行合并。并行只用于隔离文件面或独立测试，不假设多 agent 数量能线性缩短工期。

## 4. 工作包与可执行验收

### M0：建立可信执行入口

**B00 / 基线、F005 与整改登记**
- 核对实际产品/部署 SHA、active batch、两份报告指纹、未提交变更和部署触发规则。
- 安排符合模型家族互斥规则的 fresh-context Evaluator 处理 F005；生产部分仅在有明确用户授权和测试账号时执行。
- 将 R/FR/BL 映射为修复、已完成、待验证、条件新增，不以老报告整批重新立项。
- 验收：F005 有独立原样结论，或有“仍 pending + 独立热修复路径”的明确编排决议；修复与实施授权分开记录；不由本计划改变状态。

**B01 / CI、真实 DB 与浏览器门禁**（R12，BL-CI-SIGTERM-FLAKE）
- 统一 Node 22、lockfile 与全新 `npm ci`，删除 transient 未钉版测试 runner 安装；lint/verify/test/build 纳入同一基线。
- PG 与部署主版本一致，CI 全量 migrate deploy，运行明确 opt-in 的 DB probes；该跑的测试 skip 视为失败，平台专属 skip 单列原因。
- 契约变更发布必须等待 `harness.json` 锁定框架的双向 contract job；普通文档/web 无关改动按影响范围分流。
- 接入隔离 PG + 合成租户的浏览器测试；PR 执行关键旅程，扩展浏览器/视口/故障矩阵放 nightly，但相关变更必须跑受影响矩阵。
- 修 SIGTERM handler-ready 竞态，连跑/压力调度验证，不用无限重试掩盖。
- 验收：干净 Linux 环境可重放；10 个原 PG probes 逐项执行及归因；Windows 专属 4 项在 Windows 执行；关键浏览器场景有失败截图、日志和明确断言。执行数量依据实时套件确认，不固定绿灯数字。

### M1：安全与交付止损

**B02 / 依赖、认证与配置安全**（R01）
- 实施当天按维护者公告、lockfile production audit 与可达性选择窄升级，不用 `audit fix --force` 或借机大版本重写。
- 联动 Next/Auth.js/core/adapter/provider/session 验证；统一必需配置校验，拒绝默认弱 token，日志不含 secret。
- 验收：干净安装和生产构建；登录/session/admin/tenant/回调边界回归；可达 High/Critical 无未处置阻断；无法即时解决项必须有补偿措施、责任人、期限和人类风险接受。真实邮件验证单列，不能由 fixture 冒充。

**B03 / 隐私最小化与 Git 身份**（R02/R06）
- 默认事件只含计量和白名单 provenance/correction metadata；保留 parser 修正所需信息，但不上报助手正文、代码、工具参数。
- include/exclude、暂停/local-only、安装前数据预览与有期限 diagnostic opt-in 明确定义；`projectRoots` 不再被误当隐私配置。
- Git remote 客户端清 userinfo/query/fragment，服务端复核；SSH/SCP/HTTPS 身份规则一致，path 大小写不盲目折叠。身份缓存与易变 branch/HEAD 缓存分离。
- 验收：合成 credential/content canary 从源文件 -> 队列 -> HTTP -> DB -> UI/日志均不残留非必要内容；与 Codex 规范化/修正兼容。历史数据清理另做 dry-run、备份与审批，不在补丁中静默执行。

**B04 / 固定 Agent 发布与安全升级**（R11，BL-AGENT-SUPPLY-CHAIN）
- `agent/v*`/不可变 manifest 固定版本与 commit；交付物验证 digest/可信来源；旧服务端、离线与校验失败保持旧版或拒绝升级。
- staging 下载/依赖检查/smoke 后切换，新版稳定再更新 supervisor；保留前版、凭据、队列和游标；更新失败恢复旧服务。
- 先实现锁版及恢复路径，缩小 Agent 交付面可在后续优化；无依据增加签名密钥运维不是第一步前置。
- 卸载默认保留数据；`--purge` 显式确认；轮换先手动 SOP，不提供 token 自轮换默认通道。
- 验收：macOS/Linux/Windows fresh install、upgrade、rollback；断网、原生依赖失败、磁盘不足、清单篡改/不可达、kill/restart；凭据/队列不丢。Windows 未通过不能发 Windows Agent，服务端与 Agent 发布物分离。

**B05 / 不可变部署、健康、备份与恢复**（R13）
- CI 构建并保存 immutable image digest，部署核对 expected SHA；保留前版 digest。修正文档“手动部署”与 push-main 的冲突。
- liveness/readiness/capability 分层；公共 health 返回稳定错误码，内部日志关联原因；签名能力缺失明确只读/不可签发，不把可选能力变成假可用。
- Compose 启动与 workflow 统一迁移前提；校验 auth/admin/DB 配置；生产 app 非 root、最小权限，不把 DB 未暴露端口当成凭据可弱化理由。
- backup -> scratch restore -> migration rehearsal -> 关键查询/受控 canary；高风险迁移有 expand/contract 和回退矩阵。
- 验收：旧镜像回退演练、迁移失败恢复、备份 restore 实跑；enroll -> ingest -> summary canary 与 SHA/能力一致。RPO/RTO 据演练记录确定，不凭文件存在宣称达标。

### M2：保证数据和成本可以相信

**B06 / Usage 与 quota bounded schema**（R09）
- 先校验再产生副作用：bytes/行数/字符串/provider/source/UTC 时间/finite 非负数/Int/Decimal/BigInt/depth/size。
- 锁定整批拒绝或逐行结果契约；若逐行 ACK，Agent 必须按事件 ID 删除确认集合。永久 4xx 分类、死信/隔离、可重放诊断；429/5xx 有界退避。
- 验收：混合好坏行、超大 JSON、非法类型/日期/溢出/负数/未知枚举，以及 401/403/429/5xx。无效请求不改 device/token 业务状态；坏行不永久堵好行；旧 Agent 有清晰兼容行为。

**B07 / 可变源游标与跨进程 durable outbox**（R03/R04）
- OpenCode 用更新复合 watermark/有界重扫 + 未完成记录追踪，处理同毫秒和迟更新；旧游标有受控回扫路径。
- collect/run/sync/daemon 共用跨进程一致性机制；先选择所有入口互斥 + ID ACK 的最小安全方案，确有需要再迁 SQLite outbox，不同时维持两套真源。
- ACK 只删已确认 ID；queue/cursor crash safety 保留；锁超时/过期和 supervisor 重启有规范。
- 验收：真实 SQLite streaming、多消息交错、相同时间、重启；真实两个进程 daemon+manual、部分 ACK、kill/restart、锁超时；最终去重后无漏数，允许安全重发。各发布平台都有证据。

**B08 / Event revision 与 Project 身份 CAS**（R07/R08）
- 明确 snapshot revision/finality/provenance；合法重新解析可以下降，但旧快照不能回退新数据；同 revision 不同 payload 有冲突策略。
- adoption 只接管 repoKey 为空的旧项目并条件更新；同路径不同 repo 建独立身份或显式冲突，不自动改历史项目标签。
- 兼容发布采用服务端先接受 additive 字段，再放新 Agent，最后收紧旧路径；回扫、修复和普通 streaming 分开。
- 验收：真实 PG 正/倒序、相同 revision、并发 CAS、旧 Agent、合法 reparse；同路径替换、跨设备同路径不同 repo、后补 remote、同仓迁目录与并发首次上报。不存在跨用户/项目误归并。

**B09 / 成本与汇总缓存的可变账本契约**（R05）
- closed cache 先有界 TTL，再用 usage revision/定向 tag 失效；覆盖 insert/update/delete/backfill/dispatch materialization 与价格 revision。
- 首页、项目、设备、模型、Harness 成本共享语义；缓存 key 含 tenant、时间域、时区与相关 revision。
- 保留 attribution_only 去重与区间边界规则；使用 Decimal/未格式化值计算，不再聚合显示金额。
- 验收：真实 Next production server + PG，结束后迟到上传/修正/补历史/价格变更，两页同口径可对账；跨租户隔离。新数据在有界刷新/缓存契约内出现，不能靠第二次手动 reload 才更新。

### M3：关闭所有已验证的前端问题

**B10 / 首次使用与认证闭环**（R10，FR-001/007/008/010/011，BL-ENROLL-SUCCESS-PREDICATE）
- 区分从未采集、当前空窗、已连接等待首数据；空态同样挂载串行刷新，保留 range/filter/恢复入口。
- enrollment/heartbeat/usage/dashboard 分阶段展示；注册成功按 claim 判据，不把 deviceName 当必要条件；补恒真断言。
- 复用 safeCallbackPath 贯穿 pathname+query、邮件回调和成功返回；verify ICU 倒计时有参数；配置缺失、发信失败、链接过期是不同状态。
- 验收：本地真实 enroll + upload 后两个配置刷新周期内无需硬刷新；首次 cache miss/旧值/标签切回；历史 7d 空/all 非空；邮件负向条件及安全深链。生产 F005 和真实送达独立验收。

**B11 / 日期、时区与 Git 排名**（FR-002/006/009）
- URL 是已提交筛选单源，表单是 draft；预设/apply/back/forward/reload 不覆盖未提交草稿。
- 浏览器首次确认时区后刷新；图表说明用同一 tz 参数；固定用户设置 > 自动浏览器策略，Agent 时区仅设备观察，不反复覆盖用户偏好。
- Git-only 在截断前查询域过滤，明确 compute/total 排序；保留找到 top-N 以外资源的后续入口。
- 验收：预设和 Apply 往返、浏览器历史、倒置/非法范围；Jakarta 与跨 DST 时区、UTC 存储、to-exclusive；40+ 非 Git 项目不遮住匹配项。全部 KPI 与近 180 天图表的范围明确而非强行全历史加载。

**B12 / 局部恢复与移动操作**（FR-003/004/005/014）
- Scan/编辑请求捕获网络、超时和 HTTP 错误，解除 busy，保留草稿；Cancel 默认丢弃草稿并恢复服务端值，若产品选择保留则显式标注。
- 抽屉选定 disclosure/modal 语义；隐藏不可聚焦；Escape/遮罩/路由关闭与焦点返回；用户菜单亦覆盖。
- responsive table shell 容纳长名称；添加 route error/loading 与统一 empty/stale/unauthorized/retry 状态。
- 验收：320/375/768/1440px 无页面级横向溢出，允许表格局部滚动；长名称完整可查；Tab/Escape/路由闭环；fetch abort/慢网络/401/5xx 不崩整页、不丢过滤与输入。

**B13 / 可访问性、语言、主题与展示细节**（FR-012/013/016/017）
- 修共享对比度、列表/主标题/landmark；Harness tabs 选普通导航或完整键盘模型，不混用语义。
- 覆盖菜单、按钮、空态、错误、aria-label 的中英文；主题初始化独立于 Navbar，首达 login/verify 无闪烁。
- Events 文案区分历史页/当前时间覆盖；图表提供等价数据表/文字趋势与键盘入口；升级提示紧凑可展开，阻断风险不可隐藏。
- 追踪 Events 水合 #418：在 Node 22 重复并保存 component diff，未定位前不编造根因或标已修。
- 验收：axe 关键问题清零、全路径 locale/theme snapshot、人工键盘/VoiceOver 与视觉抽检；自动扫描不等于完整无障碍合规签收。

**B14 / 现有 quota 状态表达**（FR-015）
- 无快照改为“尚无配额快照”；区分缺席、授权失败、陈旧、reset 后待刷新和 unknown，安全错误码不透传厂商 body。
- 保留已正确的多账号隔离和实际周期推导；给关联设备/诊断入口。
- 验收：有 Codex usage 无 snapshot 不误报没安装；两账号与 5 小时/1 天/周窗口不回归；缺失/失败状态不等于可用额度 0。

### M4：实现第一轮产品增量

**B15 / 统一查询工作台**（新增，承接前端 roadmap）
- 全页共享时间契约与 FilterBar：时间、设备、项目、来源、模型、session；URL 可重放，前进/后退/钻取保留条件。
- Event Explorer 的稳定 cursor、单条详情、资源目录；Top-N 之外项目/模型可发现；最近 100/200 行注明截断并可进入完整查询。
- 当前筛选 CSV/JSON 导出按明确全量/有界契约，分块/流式/异步只选需要的一种；租户隔离、取消/大小上限、CSV 公式转义。
- 设置页提供时区自动/固定、语言、主题、默认 range、提醒偏好；本期周期比较只做清晰定义的同长度上一周期。
- 验收：相同查询条件汇总与明细对账；分享 URL 仍需授权，不能成为匿名分享凭证；分页稳定、过滤组合不漏/不重；导出不是只导出当前屏却标全量。

**B16 / 可解释且版本化的成本**（新增，扩展已有 pricing）
- 成本旁放 estimate/unknown/实际来源标记、价目版本/生效时间、计价构成、覆盖率、未定价规模与数据时间。
- 无实际账单来源就不展示 actual；unknown != 0，free 必须有明确证据。价格“按当前价重算”与“按当时价”是明确不同视图，先锁 v1 契约。
- pricing approval/edit 有影响预览、变更审计与历史；修正账本可解释且可重算。
- 验收：人工独立复算 fixture；跨页同口径；cache/tier/provider 缺证据时披露边界；新旧 price revision 不混在无标签总额中。

**B17 / 预算与提醒**（BL-BUDGET）
- user/project/model 自然月 cap 与 75%/90% 提示，月边界用用户时区转换为 UTC；提醒设置和测试入口有显式状态。
- 告警幂等、冷却、跨阈值和修正后回落策略；未定价单独提醒，通知失败可追踪。
- 验收：DST/月末、迟到修正、重复计算、同范围多预算、未定价、重试发信；只告警不熔断，不自动关闭工具，不把 estimate 称为实付账单。

### M5：把异常转换成下一步操作

**B18 / 设备与数据健康修复台**（新增，扩展现有 diagnostics）
- 设备搜索/排序/分页，parser/release 版本、collected/uploaded/ingested 时间、queue age/depth/bytes、端到端延迟、错误分类与 SOP。
- 重命名、停用、重新注册、撤销凭据有风险确认与审计；采集范围预览和授权 replay 有 dry-run、上限、去重和取消。
- 项目 rename/archive/merge 只在身份问题已修后提供；merge 显示影响、租户边界、审计与可撤销映射，不删除原始事实。
- 验收：用故障场景从页面找到正确修复步骤；旧 token 撤销 401、回扫幂等；诊断导出脱敏，不读取任意路径/凭据。

**B19 / 可行动 Gate Inbox 与 mode intent 恢复**（BL-MODE-INTENT-DELIVERY，BL-GATE-SIG-ECHO-REVIEW）
- 基于已有 Inbox/邮件/徽章补项目、kind、年龄、pending/signed/relayed/consumed 筛选与过期/延迟提示；失败不能折叠成“没有待办”。
- mode intent 当前/下一计划 diff、作用时机、expected/current SHA；head_mismatch 有界重试/人工重签，失败持久留痕及复用通知通道。
- 复核 sig 回显是否为不必要第二投递面；若修改先更新契约/DB 断言，不悄悄破坏既有 acceptance。
- 验收：离线、过期、重复提交、并发、ACK 延迟、网络失败、签名/owner/HEAD 不一致；签发/中继/消费各状态真实可验证。永不为提高成功率绕过验签/SHA，也不由机器写人闸门决定。

**B20 / 额度 provider 授权调研与条件实现**（BL-QUOTA-PROVIDERS）
- 先由用户明确限定 provider、测试账号、认证渠道与机器范围，做 go/no-go；不因旧 backlog 记载凭据存在就访问个人凭据目录或 Keychain。
- 可行才做本地授权查询和安全 snapshot，server 不收厂商 secret、不刷新/写回凭据；失败、权限缺席和未知窗口不猜测。
- 验收：记录协议/授权/窗口来源、脱敏样本与退出条件。no-go 是合格调研结果；不得预承诺 Claude/Kimi 可用。实现时间在 probe 后单独估算。

### M6：扩展前先建立规模与归因依据

**B21 / 留存、真实性能与渐进整理**（R14，BL-COST-PERF，BL-DEAD-FONTS-COMPONENT）
- raw diagnostic 短期保留、quota latest + 历史降采样、usage 明细保留/导出与可重算日汇总；策略须人类批准，先报告再执行删除。
- 以 10 万/100 万事件、多租户、多设备/账号建立 EXPLAIN/查询 P95/DB growth/内存/queue age 基线；这些是测试档位，不是支持容量声明。
- 统一可见性轮询、in-flight 取消与错误状态；复用 session，列表分页，必要图表按可视区域加载，messages/font/chunk 裁剪按实测决定。
- 清死 Fonts 组件与安全小拆分：summaries/report 拆 validator/repository/service，不改变契约；ESLint CLI 迁移与依赖升级分开。
- 验收：实际目标硬件和真实手机 profiling + 长稳；新聚合在迟到/correction/delete/price revision 后与原始明细一致；保留前后可导出/重算。先冻结测量预算，再用同负载比对，不凭 chunk 数字判现网慢。

**B22 / batch-feature-task 归因协议 v2**（新增跨仓方向）
- 在上游定义 run/task/batch/feature 与 provenance 的 additive 字段、所有权/相关性规则、旧 Agent 降级、重放/去重。
- 精确关联、可信相关、时间窗估算分别呈现；不把同项目同窗口的无关工作标为精确成本。
- 验收：并行任务、多个批次、dispatch/原始 usage 双源、attribution_only、离线补报、旧 Agent；有量化归因覆盖率与冲突/未知占比，不能从 time guess 隐藏不确定性。

**B23 / 成本 x 质量分析**（BL-PERF-ANALYTICS）
- first-pass、返工、耗时、重试成本、每完成 feature 成本、项目历史；复用 archives/transitions，不重建归档。
- evaluator-only 单列，superseded 不进 done 分母；样本量、任务难度、估算归因占比和镜像限制明确。
- 验收：独立分母/成本复算，空样本和小样本不做虚假排名；模型/工具比较是描述性分析，不宣称因果或“低成本就是高质量”。

### M7：按价值和授权选择，不打包强上

**B24 / Device-Harness 兼容解耦**（BL-DEVICE-DECOUPLE）
- 新 HarnessDeviceSync 表 -> 回填守恒 -> 兼容双写/切读 -> 观察 -> 后续删列；冻结页面/API 原输出形状。
- 验收：新旧 app/Agent 混跑、并发 heartbeat、回填校验和回滚演练；删列仅在无旧读取依赖且已备份后做。默认不容忍旧进程读删列 500 窗口。

**B25 / 白名单证据上传与内联**（BL-GATE-EVIDENCE-UPLOAD）
- docs 白名单、路径真实解析/防 symlink 逃逸、体积/类型/保留/权限、SHA/版本，HTML 安全隔离；path-only 不表示文件已上传。
- 验收：跨租户、巨文件、恶意 HTML/链接、同名修订、过期、撤销和未授权路径；只上传用户批准的证据，不成为任意文件读取能力。

**B26 / 结构化 live session**（BL-LIVE-SESSION）
- 默认关闭，显式 opt-in；只发有限结构化状态，不 tail 任意 prompt/日志；复用既有 transitions，限量、限流、保留/停用清理。
- 验收：采集范围/注入/隐私/降级审计、离线/陈旧状态明确；事件体积与内存有界；关闭后不继续采集。

**B27 / 签名 steering**（BL-STEERING-V1）
- 上游先定 pause/cancel/note schema、验签与边界，再同步产品；独立签名槽位、expires/一次性/CAS/防重放，明确 ack 和实际生效状态。
- 验收：双向契约、伪造/到期/重放/错 repo/离线与阶段边界；交互模式呈报人类、自主模式作 halt 条件，不直接改 progress/status/features 或代签人闸门。

**B28 / 自动凭据轮换可行性**（BL-CRED-ROTATE-API）
- 先威胁建模 stolen-token 自锁、owner 授权、grace window、回退、审计与恢复；在手动 SOP 已验证后决策。
- 验收：仅调研/设计也可交付；未满足威胁模型前不实现自动轮换端点。

**B29 / 框架维护窗口**（三项 bridge/registry backlog）
- 受限 guest 错误枚举、terminal-message 与 D9 覆盖语义、惰性 registry 字段分开核对。
- 在上游仓修协议/实现和独立验收，发布后按锁版本同步；不直接改 tokenizer 镜像造成双真源。
- 验收：无模型文本/guest 内容泄出，覆盖语义一致、契约不漂移。与主产品发布正交，除非实测证明阻断。

## 5. 追踪矩阵

### 5.1 全工程 findings

| ID | 主责任包 | 必要验证 |
| --- | --- | --- |
| R01 | B02 | 实施当日公告/audit 处置 + 真实认证/构建回归 |
| R02 | B03 | 合成 Git 凭据从队列/HTTP/存储全链路清除 |
| R03 | B07 | 真实 SQLite 后更新/同刻/重启/回扫 |
| R04 | B07 | 两真实进程、ID ACK、queue/cursor 崩溃安全 |
| R05 | B09 | 真实 Next Cache + PG 迟到/修正/价格更新 |
| R06 | B03 | 默认最小化、范围预览、正文 canary 全链路 |
| R07 | B08 | 真实 PG 路径冲突/项目 CAS/跨设备 |
| R08 | B08 | PG revision 乱序/并发/合法下降 |
| R09 | B06 | HTTP/PG 输入边界 + 无前置副作用/死信 |
| R10 | B10 | 与 FR-001/007 合并的浏览器闭环 |
| R11 | B04 | 各平台安装/升级故障注入与回退 |
| R12 | B01 | 锁文件重放/PG/平台/契约发布 gating |
| R13 | B05 | digest/SHA/能力/备份 restore/兼容迁移 |
| R14 | B21 | 留存授权/真实规模/可重算守恒 |

### 5.2 前端 findings

| 工作包 | 原编号 | 闭环重点 |
| --- | --- | --- |
| B10 | FR-001/007/008/010/011 | 首同步、历史空窗、倒计时、安全深链、邮件配置错误 |
| B11 | FR-002/006/009 | 日期 draft/URL、先过滤再排名、时区首次一致 |
| B12 | FR-003/004/005/014 | Scan 局部恢复、抽屉焦点、表格、Cancel 契约 |
| B13 | FR-012/013/016/017 | a11y、语言、历史页文案、匿名主题 |
| B14 | FR-015 | 缺 quota 快照不误报没安装 |

新增能力不计为“修复完成”；水合/性能/DST/真实邮件等未验证项由专项证据关闭，不升格为未经复现的现网事故。

### 5.3 既有 backlog 的处置

| 既有 ID | 对应包 | 建议 |
| --- | --- | --- |
| BL-BUDGET | B17 | 账本/时间/定价正确后执行，替换旧“无依赖”前提 |
| BL-DEVICE-DECOUPLE | B24 | 改为兼容迁移，先于 live/evidence |
| BL-AGENT-SUPPLY-CHAIN | B04 | 从中期提前到止损阶段，补失败恢复，去 main 默认回退 |
| BL-QUOTA-PROVIDERS | B20 | 授权 probe -> go/no-go -> 条件实现 |
| BL-LIVE-SESSION | B26 | opt-in，仍是结构化事件而非日志 tail |
| BL-STEERING-V1 | B27 | 上游先行与签名边界，非直接远控状态 |
| BL-PERF-ANALYTICS | B23 | 成本可信后执行，精确归因先行；不重复归档 |
| BL-GATE-EVIDENCE-UPLOAD | B25 | 条件提升为决策上下文能力，隐私和解耦前置 |
| BL-CRED-ROTATE-API | B28 | 保留低优先级，先威胁建模 |
| BL-REGISTRY-LAZY-FIELD-CLEANUP | B29 | 上游维护窗口 |
| BL-BRIDGE-GUEST-FAILURE-TAXONOMY | B29 | 上游维护窗口，受限枚举 |
| BL-BRIDGE-D8-D9-OVERWRITE-ALIGNMENT | B29 | 上游维护窗口，契约与实现对齐 |
| BL-COST-PERF | B21 | 先修 R05 永久缓存，规模实测后优化 |
| BL-FRONTEND-REVIEW-REMAINDER | B10-B14 | 按本次实时 FR 分类，剔除已经修好的旧项 |
| BL-MODE-INTENT-DELIVERY | B19 | 有界重试、留痕、通知，绝不绕 HEAD |
| BL-CI-SIGTERM-FLAKE | B01/B04 | 提前，真实 handler-ready 和各平台验证 |
| BL-GATE-SIG-ECHO-REVIEW | B19 | 契约/DB acceptance 同步复核 |
| BL-DEAD-FONTS-COMPONENT | B21 | 性能/维护窗口，小步清理 |
| BL-ENROLL-SUCCESS-PREDICATE | B10 | 首用闭环中收敛，修恒真断言 |

## 6. 测试、验收与发布门槛

### 6.1 每批的必备产物

1. 新功能与协议有 `docs/specs/<batch>-spec.md`，写明 scope、兼容、拒绝行为、回退与非目标；纯 bugfix 也要把可验证不变量写进 acceptance。
2. Generator 只交付 diff、测试工具和 handoff；fresh-context Evaluator 根据实物运行，不采信实现者的“已通过”。Generator/Evaluator 模型家族不同，由编排者按实时 registry 解析，不在本计划预绑具体 agent。
3. `docs/test-cases/`、原始日志/截图、环境/commit/数据集、`verdict.json`/signoff 原样留档；失败、skip、未验证明确列出。每个 R/FR 有唯一主责任包与复验引用。
4. UI 新增/架构改造先确认 Stitch/原型是否存在，再更新设计稿或确认无需新增；本仓未发现 design-draft，不能据此宣称外部 Stitch 无稿。视觉人工验收与技术检查分列。

### 6.2 分层验证矩阵

| 层 | 必须证明 | 不能替代什么 |
| --- | --- | --- |
| L1 | 干净 Node 22 ci/lint/verify/test/build；边界和回归断言 | 单测数量不替代真实 DB/浏览器 |
| PG integration | 迁移全链、tenant、CAS、revision、身份、pricing/quota 边界、重算 | Prisma 替身不能签收并发或 SQL |
| Runtime cache | production Next + PG 的补报/修正/价格失效/两页口径 | cache 模型不能签收真实 Data Cache |
| Agent integration | 合成来源 + 多进程 + crash/restart + ACK + 真实 supervisor 升级 | 文件交错模型不替代平台故障注入 |
| Browser | 首用/空窗/日期/深链/admin/tenant/Gate/intent/网络恢复 | fixture session 不替代登录邮件送达 |
| UI | 320/375/768/1440px，中英/明暗、键盘/VoiceOver、长名称/unknown/free/unpriced | axe 与截图不替代完整人工可用性 |
| Contract | 锁定上游双向 fixtures、新旧协议兼容 | latest 上游或另跑 CI 不替代同 SHA 发布 gate |
| Operations | expected SHA、backup restore、迁移/镜像回退、canary、告警送达 | HTTP 200 不替代业务/签名/恢复能力 |
| Scale | 代表性规模与真实硬件、P95/内存/DB 增长、长稳 | 单次资源体积不是 CWV/容量结论 |

Chromium 承担 PR 最小旅程；Safari/Firefox/Windows 与真实移动设备放独立/夜间矩阵。涉及对应平台或安装器时，其 job 变成该发布物必过项，不允许用 Linux 服务端绿灯覆盖。

### 6.3 不变量与度量

- 安全：0 跨租户结果、0 默认正文/凭据 canary 泄出、所有高风险动作 owner+确认+审计。
- 数据：ACK 后事件守恒，重复只去重不漏；旧 revision 不覆盖新；项目历史不因路径复用变身份；聚合与原始明细在 Decimal 口径对账。
- 新鲜度：区分 source-final -> collected -> queued -> uploaded -> ingested -> rendered；首上传 ACK 后两个配置的可见页刷新周期内显示正确数据。hidden 页恢复后 catch-up，最多一个刷新在途。
- 体验：已确认 P1 清零；页面无横向溢出；局部失败可重试，filter/draft 不丢；语言/时区/主题首次一致。
- 运营：量测 queue age/bytes、revision conflicts、DLQ、quota stale、gate relay/ACK、DB/query P95、恢复时长；标签限制基数、错误/trace 不收原始正文和 secrets。
- 容量/SLO/RPO/RTO：B01/B05/B21 先测基线并取得目标批准，再冻结回归预算与告警阈值；不先编造 99.9% 或“支持百万级”的承诺。

### 6.4 四道交付闸门

**G0 / 批次可实施**：用户确定范围、资源和授权，spec/acceptance 锁定，当前 active batch 协调清楚；本计划不代表 G0 已通过。

**G1 / 稳态底座可验收**：M0-M3 阻断项闭环；特别是 R01-R09/R11-R13 及 6 项前端 P1 有真实对应证据；所有 17 项 FR 有结论，不能把未验证写成 PASS。既有 F005 未完成部分单独保留。R14 的规模风险不伪装成已消失，新增规模能力需 G3。

**G2 / 产品增量可发布**：M4/M5 的数据契约、权限、预算/通知语义和浏览器旅程独立验收；没有跨过 G1 扩功能。provider no-go 不阻断其他工作，未通过 provider 不上线。

**G3 / 规模和高级能力可开放**：M6 真实容量/留存/归因证据充分；M7 对所选功能完成 opt-in、授权、威胁模型/协议/平台闸门。未选高级能力保持关闭，而非等所有远期项一起发布。

任何紧急安全 hotfix 都按独立有限 scope 验收、明确承认未完成项，不借紧急性宣称整工程通过 G1。

## 7. 发布、数据修复与回退纪律

1. 外部 agent 只在自己的 worktree 留产物，**不得推送任何分支**；Coordinator 回流、选择性暂存、确认用户授权。保护原树无关模式变化，不顺手修权限或 reset。
2. 当前 live workflow 是 **push main 的非豁免路径会部署生产**；workflow/tests/scripts 等也不是“纯内部安全改动”。落地新 release gate 前，每次回流推送都按一次生产变更审批。docs-only 计划不授权任何 push。
3. code/DB/Agent 分开发布与回退矩阵：additive server/schema -> 新 Agent -> 观察 -> 收紧旧路径；Agent pin 的 minimum/feature/release 根据正式规格决定，不照抄 8 月版本占位。
4. immutable image 与已验证 Agent 小范围试点 -> canary -> 人类批准推广。记录 expected/actual SHA、schema/Agent/price revision、测试环境和观察窗口。
5. app 回退到旧 digest 前检查 schema 兼容；不可逆 schema 不自动 down migration。expand/contract 保留回退窗口，contract 前重新备份和恢复验证。
6. 历史 remote 清理/正文删除/replay/project merge/rollup purge 均独立授权：备份 -> 脱敏 dry-run 影响统计 -> tenant 范围确认 -> 分批幂等执行 -> 对账 -> 审计。现网秘密不在报告中展开；是否吊销由有权限操作者根据证据决定。
7. 发布健康核验包含 SHA、readiness/capability、受控 enroll/ingest/summary、受影响登录/签名链路和错误率/队列趋势。测试失败、数据不守恒、租户越界、升级不能恢复或业务 canary 异常即停止推广并按矩阵回退。
8. docs 更新覆盖实际 clean onboarding、配置、迁移、restore、升级/卸载和失败 SOP；不以 README 复制命令替代一次从空环境执行。

## 8. 启动建议与待确认项

**默认下一步**：批准 M0；由编排者安排 F005 的独立处理和 CI/真实 PG/浏览器门禁规格，再分别立 M1 的依赖/隐私和 Agent/部署安全包。先交付可以信任的稳态版本，预算和更多 provider 不抢在正确性前面。

仅三项需要在正式排期前确认，当前可按默认假设继续写规格：

1. 可用实现主线与独立验收资源；默认 1 条实现主线 + 独立验收，不按一人自评。
2. 是否允许受控生产/测试邮件、平台机器和历史数据修复；默认仅 synthetic/staging，所有历史删除/轮换另批。
3. 第一轮新增目标；默认 M4 的 Explorer/成本解释/预算，其次 M5 运维；M7 维持条件路线，不默认全选。

本次未改产品代码、状态、backlog、框架或实际 pending_gate.decision；未 commit/push/deploy、未访问厂商凭据、未发邮件或修改现网。计划文件的格式/覆盖/依赖校验与产品/发布验收严格分开。
