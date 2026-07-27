# BL-HARNESS-DETAIL-MODEINTENT — Harness 下钻、模式意图与 dispatch 历史

**批次类型：** 混合批次（F001-F005 Generator；F006 Evaluator）  
**车道：** Generator=`builder-codex`（local-cli）· Evaluator=`reviewer-kimi-a2a`（A2A loopback）  
**框架源：** `/Users/yixingzhou/project/harness-template`；tokenizer 中的 `framework/` 与 `.claude/` 只能由 `harness.sh sync` 同步

## 背景与目标

`/harness` 已能看多项目进度、模式指纹和人闸门，但项目卡不能下钻，模式也只能看不能调整。
本批次增加可操作的项目详情页，同时守住 Console Mode 的边界：控制台不直接改 `progress.json`、
`role_assignments` 或 `autonomy-policy.json`，只签发一条人类意图；本机 device agent 验签后把它暂存为
项目拥有的 `harness.json.project.mode_defaults`，下一次 `/plan` 再消费。当前批次任何阶段都不被改写。

另把 dispatch 的结构化执行事实保存到控制台，解决 run-meta 只留在临时目录、无法从项目下钻回看的问题。

## 已确认决策

1. 首版同时开放执行/角色模式与自治策略，不分批延后。
2. 模式意图暂存后只在下一次 `/plan` 生效；不提供“立即影响当前批次”。
3. 保存脱敏 dispatch 摘要；不得上传原始 prompt、stdout/stderr、环境变量、凭据、源码或本机绝对路径。
4. deny-list、sandbox、`.claude/console/console.pub`、Agent 注册表、凭据与框架升级始终只读，不可从面板修改。
5. 模式不是单枚举：`fast` 表示默认快车道（无显式 role assignments）；`heterogeneous`/`slow`
   必须显式选择 Generator 与 Evaluator，并由 transport 推导；任一 a2a 即为 `slow`。
6. 自治授权使用绝对 `expiresAt`，不可在每次 `/plan` 自动续期；过期即 fail-closed 回到手动规划。

## 数据与签名契约

### `HarnessModeIntent`

至少保存：`intentId`、`harnessProjectId`、`userId`、完整 `payload`、`signature`、`status`、
`issuedBy/issuedAt/intentExpiresAt`、`relayedAt/stagedAt/appliedAt/failedAt`、`appliedBatch`、
`stagedCommitSha`、`failureCode/failureDetail`。状态集合：
`issued | relayed | staged | applied | failed | superseded | expired`。

同一项目只能有一个非终态意图；新意图事务内把旧的 `issued/relayed/staged` 标为 `superseded`。

签名 payload 使用递归 canonical JSON，字段固定为：

```json
{
  "intent_id": "uuid/cuid",
  "repo_key": "normalized remote",
  "expected_head_sha": "40-char sha",
  "desired": {
    "execution": {
      "profile": "fast | heterogeneous | slow",
      "role_assignments": null
    },
    "autonomy": {
      "enabled": false
    }
  },
  "issued_by": "human identity",
  "issued_at": "UTC ISO8601",
  "intent_expires_at": "UTC ISO8601"
}
```

异构/慢车道时 `role_assignments` 必含 `generator` 与 `evaluator`。自治开启时还必须含：
`expires_at`、`auto_cross`（仅 A/B）、`budget.max_tokens/max_cost_usd/max_wakes/max_fix_rounds`，
可选 `wake_interval_s` 与 `notify_on`。所有字段都参与签名。

### `harness.json.project.mode_defaults`

device agent 验签后原样保存 `{ intent: <payload + sig>, staged_at, staged_commit_sha? }`；不得只保存
拆散后的 desired，否则 `/plan` 无法再次验证人类授权。写入前要求 repoKey、完整 HEAD、intent 有效期匹配，
且 `harness.json` 没有未提交改动；使用原子写与只 add/commit `harness.json`。

`/plan` 开始时运行框架机件验证签名、有效期、Agent 角色白名单、transport 与 family 互斥。通过后：

- fast：本批 `role_assignments=null`；异构/慢车道：复制签名内的 generator/evaluator。
- autonomy.enabled=false：本批不创建自治策略；true：按签名字段创建锁定新 batch id 的
  `autonomy-policy.json`，`authorized_by="user"`，沿用绝对过期时间且不得续期。
- 在 `progress.json` 记录 `mode_intent: { intent_id, applied_batch, applied_at }`，供 agent 上报后把意图标为 applied。
- 本地人工仍可直接在 `/plan` 中选择角色并创建策略；没有控制台时 Harness 必须照常工作。

## API 契约

- 会话侧 `/api/harness/mode-intents`：GET 历史；POST 校验并签发；DELETE 仅撤销尚未 staged 的本人意图。
- device 侧 `/api/harness/mode-intents/relay`：GET 只返回本 device、未过期、带签名的意图；POST 幂等 ACK
  `staged | applied | failed`，校验 project/device 归属与合法状态迁移。
- `/api/harness/report` 扩展 mode defaults/active intent 与 dispatch summaries；所有 upsert 按 tenant + project 归属。
- 签发前要求最近上报、设备 `agentFeatureVersion>=4`、40 位 HEAD、可用 mode snapshot；否则 UI/API 明确提示。
- 签发失败必须 fail-closed，不允许先落一条无签名记录。

## Dispatch 摘要

新增项目关联的幂等记录，字段包含：`runId/taskId`、batch、feature、role、agentId、modelFamily、transport、
lockedSha、startedAt、finishedAt、duration、outcome、exitCode、verdict、artifactPath、artifactSha256、errorSummary。

框架确保 local-cli 和 a2a 的 run-meta 都复制到项目根 `.harness-dispatch/`。device agent 只扫描该目录，
只接受有界数量、合法 JSON、与当前仓库 HEAD/批次可关联的记录；绝对 artifact/log/worktree 路径只取 basename
或仓内相对路径。服务端按 `(harnessProjectId, runId)` upsert，详情页默认显示最近 50 条。

## 下钻页信息架构

Dashboard 上整张 Harness 项目卡可点击，保留清晰 focus 样式并进入 `/harness/[id]`。

- **Overview：** 项目/设备、repoKey、关联用量项目、完整 HEAD、上报新鲜度、当前 batch/status、阶段轨迹、
  feature 明细、完成率、fix rounds、signoff、last halt、待处理 gate。
- **Modes & Agents：** 当前实际模式与待生效模式并列；模式编辑器；每个 Agent 以独立卡展示 id、roles、
  capabilities、model family、transport、adapter、sandbox 声明；展示 family 互斥、框架漂移、hook、deny-list、签名模式。
- **Activity：** mode intent 状态时间线、gate 历史、最近 dispatch 摘要；失败原因可见但不得展示原始日志。

模式编辑器使用分段选择执行形态、下拉菜单选择 Agent、开关控制自治、数值输入预算、复选框控制 A/B gate。
提交前展示“仅在下一次 /plan 生效”。安全机件以只读健康状态呈现，不制造可编辑假象。

本仓库没有 Harness 对应 Stitch/design-draft 原型；本批明确属于新布局，沿用现有控制台排版、颜色、暗色模式
和 `PageBanner`/表格语汇。不得套娃卡片；移动端长 repoKey、SHA、错误文本必须换行或截断，不能横向溢出。

## F001 — Harness 通用契约

在 harness-template 新增 mode intent 验签/消费规则与 dispatch run-meta 项目内落点，升级框架版本并写 CHANGELOG。
用 `harness.sh sync --from /Users/yixingzhou/project/harness-template` 同步 tokenizer；不得手改托管副本。

## F002 — 数据模型与纯函数

添加 additive Prisma migration、共享 TS 类型、desired 校验/规范化与通用签名函数。纯函数覆盖非法 profile、缺角色、
Agent 不存在/角色不符、同 family、transport/profile 不符、自治字段缺失/C gate/预算越界/过期。

## F003 — API 与上报

实现会话/device API、租户隔离、状态迁移、签发和 ACK；扩展 report 幂等写 dispatch summaries 与 mode intent 激活信息。
所有输入限制长度与数量，错误正文不得回显私密 payload。

## F004 — Device agent

实现 mode intent 拉取/验签/暂存/定向提交/ACK，且和 report、gate relay 三步互不阻塞；扩展 mode snapshot 的
Agent capabilities 与 defaults 摘要；采集脱敏 run-meta；能力版本 3→4。补齐单元与集成测试。

## F005 — UI

实现卡片链接、详情 server page 与 client editor，所有查询按 session.user.id；404 不泄露他人项目存在性。
补齐中英文键，沿用现有相对时间与暗色模式。按钮提交中禁用，成功后刷新；错误就地显示。

## F006 — 独立验收

Evaluator 锁定 Generator 完成后的 SHA 自行取证，不采信 handoff 结论。除 L1 外，必须：

1. 用 fixture 验证签名篡改、过期、HEAD 漂移、脏 harness.json、重复/越权 ACK、family 冲突。
2. 证明 intent staged 后当前 progress/role/policy 不变；模拟下一次 `/plan` 后才出现新 role assignments 与 policy。
3. Playwright 以桌面与移动 viewport 检查项目卡下钻、三个视图、编辑器校验、pending/staged/applied/failed 状态；
   截图并检查浏览器 console，无重叠、横向溢出和缺翻译。
4. `npm run lint`、`npm run verify`、`npm run test`、`npm run build` 全绿，migration 可由 `prisma migrate deploy` 读取。
5. 经 `reviewer-kimi-a2a` 产出 schema 合法的 verdict；本地重跑 receipt 后才可签收。

## 非目标与回滚

不做 registry/凭据/guardrail 远程编辑，不做立即切换，不做真实跨物理机 A2A，不上传原始日志，不自动部署生产。
数据库迁移只新增表/字段；旧 agent 继续只读上报。应用层回滚后未消费意图保持 inert，不会直接改变任何仓库状态。
