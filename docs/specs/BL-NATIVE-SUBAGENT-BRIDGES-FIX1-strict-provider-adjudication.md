# BL-NATIVE-SUBAGENT-BRIDGES Fix 1 · Strict Provider 开工前审计

> **发起者：** main context (Generator)
> **日期：** 2026-08-01
> **触发：** F001/F003/F004 验收失败后发现 spec、features 与当前 strict-provider 实现存在冲突；按 pre-implementation audit -> Planner adjudication 流程处理。
> **状态：** 已裁决；实现以本文件和更新后的 batch spec 为准。

## 1. 背景与目标

当前实现正确地把没有严格隔离边界的 Kimi external same-session bridge 隐藏并拒绝签发，但原规格要求该 bridge 可被发布、选择和签发。验收还发现 receipt 字段不足、临时凭据复制不满足隔离要求，以及 F005 对 Codex 真实 probe 的描述漂移。

本修复轮的目标是保留 fail-closed 原则，同时建立一个 Framework-owned `vm-v1` provider，使 Kimi bridge 仅在该 provider 生成新鲜、nonce-bound attestation 时成为可执行目录项。Kimi external bridge 覆盖 Planner、Generator、Evaluator 三角色；Codex 继续只有 local-cli。

## 2. 跨源审计

| 决议点 | 现有实现 / 验收事实 | 原 spec / feature 口径 | 风险 |
| --- | --- | --- | --- |
| Strict provider | Python/TypeScript catalog host gate 恒为 unavailable，sandbox 也拒绝 subagent | Kimi 被描述为当前可注册/可发布 | 直接放开 gate 会把同 UID、直接网络和临时凭据复制伪装成隔离边界 |
| 三角色 | Kimi manifest 仅 planner/evaluator，runner persona 目前统一为 coder | F001 要求三角色，用户要求 Kimi 也能承担 Generator | Generator 没有 source-handoff / 写入产物语义会导致角色承诺失真 |
| 凭据与 receipt | runner 复制用户 Kimi state；receipt 只存 child-call digest | D3 要求 nonce 有限标识、子代理类型，且不得读取凭据 | 外部 CLI 可接触原始认证状态，验收无法独立证明 child 条件 |
| F005 probe | features.json 写 Codex 与 Kimi bridge probe；spec 写 Kimi bridge probe + Codex local-cli health | 两份验收源不一致 | Evaluator 无法一致判断完成条件 |

## 3. 决议请求

| # | 决议点 | A 方案 | B 方案 | 建议 |
| --- | --- | --- | --- |
| 1 | Provider 边界 | 实现 Framework-owned `vm-v1` provider，按 strict schema 在 catalog 与 launch 两次 attested | 放宽现有 sandbox/profile gate | **A**：不能把 same-UID sandbox 当作秘密或生命周期隔离 |
| 2 | Kimi 角色 | 发布 planner/generator/evaluator 三种 persona，并为 Generator 补 source-handoff/受控产物协议 | 仅发布 planner/evaluator 并缩小 F001 | **A**：符合本批次用户目标 |
| 3 | 认证流 | provider broker 负责认证和网络，worker/Kimi 不获得 host raw credential，也不复制用户 Kimi state | 继续复制 temporary credentials | **A**：满足 provider contract 与 F003 |
| 4 | F005 canonical 口径 | Kimi 做真实 parent-child probe；Codex 只做 local-cli health | 两个 CLI 都做 child-bridge probe | **A**：与 Codex non-goal 一致 |

## 4. Planner 裁决（main context · 2026-08-01）

**短格式：** `#1:A #2:A #3:A #4:A`

| # | 决定 | 理由 |
| --- | --- | --- |
| 1 | A | 用户确认严格 provider 路线；provider 不可用或 attestation 漂移时必须继续隐藏 bridge。 |
| 2 | A | 用户明确要求 Kimi 支持 Generator；实现需使用 provider-owned copy-in/copy-out source-handoff，而不是扩张现有 local CLI 权限。 |
| 3 | A | 用户确认 L2 授权，但不授权把 host credential 暴露给 worker；brokered credential/network 是硬条件。 |
| 4 | A | 用户确认以现有 spec 的 Codex local-cli health 口径作为 F005 canonical 版本；Codex 不获得 child-bridge 路径。 |

### 同步文档更新

- 更新 `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-spec.md`：把 strict `vm-v1` provider、三角色 Kimi bridge、nonce/type receipt、brokered auth/network 和 F005 canonical probe 写为硬性约束。
- 更新 `features.json` F005：删除 Codex child-bridge probe 口径，改为 Codex local-cli health。

### 实施注意

- 禁止仅将 `external_same_session_bridge_provider()` 或 `externalSameSessionBridgeHostAvailable()` 改为常量 true。
- Provider 必须由 Framework 发现和验证；project registry、PATH、环境变量、设备 report 均不能自行授予 provider 身份。
- 若当前机器没有可启动的 VM runtime 或 broker，route 必须保持不可发布；不得用测试 stub 作为生产 attestation。
