# tokenizer「agent 编程项目管理系统」落地计划（总控）

> 日期：2026-08-09 · 依据：用户确认 2026-08-08 战略分析（keep-separate + 三阶段路线图）
> 产出方式：12 个批次规划 agent 并行落方案（每份均实地核对代码路径），主上下文做全局排序与冲突收口。
> 逐批次详细方案：`batch-plans/BL-*.md`（12 份，含 features/acceptance/涉及文件/风险）。
> 需求池：已物化进 `backlog.json`（近期 high / 中期 medium）。

---

## 0. 紧急事项：生产部署管道当前已冻结 🔴

规划期实跑发现（非推测，`npx vitest run tests/shared/framework-version.test.ts tests/shared/mode-badges.test.ts` = **7 failed | 14 passed**）：
`7eda92e` 升级框架 v1.7.1 只更新了 manifest 镜像，但两个测试文件仍硬编码 "1.7.0"；该 push 全走 paths-ignore，CI 从未跑过，红灯无人看见。**当前任何产品改动 push 都会 verify 失败 → deploy 被 `needs: verify` 拦截。**

→ 处置：BL-REPO-MECH 的 F003（版本测试去税）打头阵，它同时根治这类税（测试期望值改从 manifest 动态生成）。

## 1. 执行顺序（12 批次 + 2 个派生 backlog 项）

### 近期（顺序执行）

| # | 批次 | 规模 | 一句话 | 关键依赖/理由 |
|---|---|---|---|---|
| 1 | **BL-REPO-MECH** | M | 解冻部署（F003 先行）+ 上游 contract-fixtures（框架 v1.8.0）+ contract-conformance CI + paths-ignore 扩 `docs/**` + CLAUDE.md 修正 + keep-separate ADR | 解除冻结是一切的前置；契约 CI 保护后续所有触碰跨仓契约的批次；F004 生效后 docs/analysis 全目录可入库 |
| 2 | **BL-TRANSITION-LOG** | S+ | HarnessTransition 流转事件表 + 详情页 timeline tab（纯服务端，agent 零改） | 是成本归因的前置数据；**建议吸收 BL-PERF-ANALYTICS 的 F001（HarnessBatchArchive 归档表 + done/superseded 触发）**——同文件同事务同测试模式，且归档晚上线一天就是一天批次历史永久丢失 |
| 3 | **BL-GATE-INBOX** | M | 全站待批徽章 + 闸门邮件通知（Resend 已有基建）+ evidence 先行版 + dashboardUrl/artifactPath 补显 | 规划核实：收件箱聚合本体已在 /harness 列表页，缺的是全局触达；与 #2 同改 report/route.ts → 串行 |
| 4 | **BL-AGENT-LATENCY** | M | cron 双条目（闸门延迟 15min→≤2min）+ 轮询退避抖动 + enroll 自愈 fetch + /events 分页；agent release 1.3.0 | 独立；账本条目押最后一个 commit，使升级提示晚于代码就绪 |
| 5 | **BL-COST-BATCH-V1** | M | 成本×批次/阶段归因 v1（时间窗 join）+ 两页成本卡片 + 归因精度实测审计（evaluator feature） | 硬依赖 #2；排在 #4 后使 F004 审计有真实 transitions 数据可用 |
| 6 | **BL-BUDGET** | M | Budget 表（user/project/model 三级月度 cap，用户时区自然月）+ 75%/90% banner 告警 + /budgets 管理页 | 无依赖；只告警不熔断（观测面不是网关，产品边界写入 spec） |

### 中期（顺序建议，可按需调整）

| # | 批次 | 规模 | 一句话 | 关键依赖/理由 |
|---|---|---|---|---|
| 7 | **BL-DEVICE-DECOUPLE** | M- | Device 表 harness 三列拆 `HarnessDeviceSync`（含数据平移 migration，破坏性删列，F001-F003 必须一次 push） | 必须先于 LIVE-SESSION，防新功能长在旧列上 |
| 8 | **BL-AGENT-SUPPLY-CHAIN** | M | `agent/v*` tag 规范 + 锁版安装（manifest commit 锚点 + SHA 校验，两步发布法防自引用）+ `--purge` 卸载 + 凭据轮换 SOP + **顺带修 Windows CI 既有失败** | 先于所有 bump feature version 的批次——让后续 agent 发布都有锁版可回退 |
| 9 | **BL-QUOTA-PROVIDERS** | M | 两段式：PROBE 子批次（Evaluator-only，Claude/Kimi 数据源 go/no-go 调研）→ 主批次按结论裁剪实现 + SubscriptionCard 泛化 | 本机实测：Kimi OAuth 凭据落盘可读；Claude macOS 无明文凭据（Keychain 非交互可读性是 go/no-go 单点，预设 Claude 更可能 no-go） |
| 10 | **BL-LIVE-SESSION** | M | P3 兑现 v1：结构化会话事件（**非**日志 tail，复用既有凭据/raw 通道拒收防线）+ live tab + LIVE 徽章；opt-in 默认关；fv 9→10（MIN 保持 9，不强推升级） | 在 #7 之后；status_change 读 HarnessTransition，事件表只保留 feature/gate/commit 粒度（两表不存同一事实） |
| 11 | **BL-STEERING-V1** | L | 第三种签名下行：任务指令通道（pause/cancel/note，建议槽位非控制通道）；跨仓——框架先落契约（steering.schema + 验签器，框架 v1.9.0），tokenizer 再实现；独立根文件 `steering.json`；fv→11 且 MIN 同步（旧 agent 不轮询 relay，签发的 pause 会永远躺着） | 硬依赖框架发版；受益于 #1 契约 CI 与 #4 延迟修复；语义红线：交互模式呈报人类、自主模式作 halt 条件，永不直接改 status |
| 12 | **BL-PERF-ANALYTICS** | S+（F001 已前移） | 聚合层 + /harness/analytics「成本×质量」页（一次通过率/返工轮数/每 feature 成本，evaluator-only 批次单独打标）+ 详情页历史 tab；可裁剪项 F005（evaluator_feedback 有界摘要，additive-optional 协议项） | 归档表自 #2 起已积累数据；成本列消费 #5 |

### 远期（方向性，不入 backlog）

P4 跨机调度（steering 通道形状直接演进为派活，对齐 MCP Tasks / A2A 生命周期）· 标准三件套（OTel `gen_ai.*` 导出、A2A Agent Card 映射、AGNTCY 对齐）· 看板编排面（backlog→features 拖卡触发 intent/派活）· 企业治理层（多操作员、审批分级、`expires_at` 限期授权启用、hooks 集中下发）· 回放/快照。

### 派生 backlog 项（规划过程中裁剪出的独立批次）

- **BL-GATE-EVIDENCE-UPLOAD**（low）：evidence 内容上传与内联查看——需独立上传端点 + fv bump，从 BL-GATE-INBOX 刻意剥离
- **BL-CRED-ROTATE-API**（low）：凭据轮换 API 化——「被盗 token 可自轮换锁死合法设备」需独立威胁建模，从 BL-AGENT-SUPPLY-CHAIN 刻意剥离

## 2. 标识符序列规则（消解并行起草的冲突）

12 份方案并行起草，版本号各自认领，以下规则收口（**以 /plan 时账本实况为准，方案内数字视为占位**）：

- **框架版本**：BL-REPO-MECH F001 = v1.8.0（contract-fixtures）；BL-STEERING-V1 F001 = 下一个 minor（≈v1.9.0）。每次框架发版按其发布契约走三件套 + tag。
- **agent release**：按批次实际完成顺序对 `agent-releases.json` 末项顺延——LATENCY≈1.3.0 → SUPPLY-CHAIN≈1.4.0（首个 `agent/v*` 锁版 tag）→ QUOTA≈1.5.0 → LIVE-SESSION≈1.6.0 → STEERING≈1.7.0。
- **AGENT_FEATURE_VERSION**：全程只有两次 bump——LIVE-SESSION 9→10（MIN 保持 9，opt-in 不强推）；STEERING-V1 →11（MIN 同步 11，强推有据：不升级则签名指令永远无人拉取）。其余批次一律不动（含 PERF-ANALYTICS F005，additive-optional 不需要 bump）。
- **HarnessTransition 契约**（TRANSITION-LOG spec 评审时冻结）：COST-BATCH-V1 需要的 `batch` ↔ 表设计的 `toBatch`、`occurredAt` ↔ `observedAt`；`@@index([toBatch])` 已在表设计中，两方案字段名以 TRANSITION-LOG 的为准，COST 侧引用时做映射。

## 3. 执行形态与操作注记

- **下一批次执行形态已被签名意图钉住**：`harness.json.project.mode_defaults` 有 active intent（tripplezhou@gmail.com 2026-08-09 签发，08-16 过期）——profile=heterogeneous，generator=codex/local-cli，evaluator=kimi/local-cli，Planner=Coordinator，自主关闭。下次 `/plan` 消费后，BL-REPO-MECH 将按此派发；改 `.github/workflows/**` 等敏感文件的 diff 须过 spec-lock critic 稽核（dispatch 四道锁在位）。
- **push=deploy 纪律**（每个批次方案的协议节都已单独写明）：产品代码批次集中 push（1-2 次/批）；BL-DEVICE-DECOUPLE 的删列 migration 必须 F001-F003 单次 push；状态类/docs 豁免路径随时可推。
- **每批次完成后**：按两步发布法处理 agent tag（SUPPLY-CHAIN 落地后生效）；勾掉本文件与 backlog 对应项。

## 4. 与既有 backlog 的关系

既有 3 条（BL-REGISTRY-LAZY-FIELD-CLEANUP / BL-BRIDGE-GUEST-FAILURE-TAXONOMY / BL-BRIDGE-D8-D9-OVERWRITE-ALIGNMENT）均为框架仓 dispatch/bridge 域问题，与本计划正交，保留原优先级；可在 BL-REPO-MECH 或 BL-STEERING-V1 的框架仓工作窗口顺带消化（由 /plan 时用户裁决）。
