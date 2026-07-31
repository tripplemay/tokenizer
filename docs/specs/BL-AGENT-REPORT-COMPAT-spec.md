# BL-AGENT-REPORT-COMPAT - Agent 上报兼容与升级可见性根治

**批次类型：** 混合批次（3 个 Generator feature + 1 个独立 Evaluator feature）

**用户确认：** 2026-07-31，用户要求启动此修复批次并按 Harness 规则完成上线。

## 1. 背景

`tokenizer` 的本机 Agent 仍在正常发送 heartbeat，但 Harness 项目上报在服务端被
`invalid_tool_catalog` 拒绝。该 Agent 来自工具目录协议升级前的安装副本：面对
`tool-integrations/1` 注册表时，它按旧逻辑上报
`dispatch.enabled=false`、空 `toolCatalog`。服务端把所有出现 `toolCatalog` 的快照都按新版
可用目录解析，因而拒绝整份 report；`HarnessProject.reportedAt` 无法刷新，控制台最终显示
“项目上报已过期，已禁止签发”。

同一副本的 heartbeat 虽然携带了不同的 `agentVersion` SHA，但首页的升级汇总只比较
`agentFeatureVersion` 和 `agentReleaseVersion`。旧副本和当时服务端都报告 feature 6 / release
`1.0.0`，所以被错误归类为 latest。该问题不能用任意 SHA 黑名单修补：SHA 不可排序，且会让从
源码运行的合法 Agent 陷入永久“落后”。正确的升级边界是正式发行版本和单调递增的能力级别。

## 2. 目标与非目标

### 2.1 目标

- 让历史 Agent 的**精确**空目录快照重新能完成 report，从而刷新 `reportedAt`；不放松新版目录的严格校验。
- 发布 Agent `1.1.0` / capability 7，明确要求 capability 6 的工具绑定 Agent 升级。
- 让首页对旧本机显示真实的升级提示与 `1.1.0` 的功能说明；仅版本未确认的设备也不能被首页静默隐藏。
- 用报告 route、版本契约和渲染语义回归，防止未来再把“协议不兼容”伪装成“最新版”。

### 2.2 非目标

- 不以 Git SHA 作为用户可操作的升级判定，不回写既有 Device/HarnessProject 数据，也不放宽签名模式意图校验。
- 不让 legacy 空目录用于 v2 tool-binding 签发；它只允许旧 Agent 恢复健康 report。
- 不修改 Prisma schema、数据库迁移、Harness framework 或用户保存的下批次模式意图。
- 不在人工闸门批准前 push、部署或更新本机安装的 Agent。

## 3. 关键设计裁决

### D1 - 最小且可证明的旧协议兼容分支

在 `parseModeSnapshot()` 的公开目录校验中，仅在以下全部成立时允许空目录持久化：

```ts
dispatch.enabled === false && Array.isArray(dispatch.toolCatalog) && dispatch.toolCatalog.length === 0
```

该分支只服务于 report 的 `requireUsable=false` 路径，结果仍是空目录。任何 disabled 非空目录、非数组目录、
超长目录、启用状态的畸形目录、或 v2 签发时要求可用目录的请求仍必须 fail-closed 为
`invalid_tool_catalog`。这样兼容的是已安装旧客户端的确定输出，而不是把“目录不可用”改写成“目录有效”。

### D2 - 协议变更必须形成可升级发行

新增 manifest 发行 `1.1.0`，其 `agent_feature_version` 与源码的 `AGENT_FEATURE_VERSION=7` 一致；
`MIN_AGENT_FEATURE_VERSION` 也升至 7，`MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION` 升至 7。
既有 v1 mode-intent 阈值保持 4。能力 6 可以在服务端兼容下恢复 report，但不能继续签发或消费 tool-bound
intent；这保证控制台先显示可执行的升级路径，再允许用户变更项目编排。

发行 manifest 是展示“最新功能说明”的唯一来源。新增测试要求末项的 capability 与当前 Agent build 一致，
避免只改代码常量却遗漏正式发行记录。

### D3 - 首页区分“须升级”与“未确认”

首页在 `outdatedCount > 0 || unknownCount > 0` 时都渲染提示。存在须升级设备时，提示展示最新发行功能、
安装命令和可选的未确认数量；只有未确认设备时，提示只说明需要在 Devices 核验，不能错误地声称它们必须
升级或展示不适用的安装步骤。旧本机的 feature 6 将因 capability 7 门槛走“须升级”路径，显示 `1.1.0` 的
真实说明。

### D4 - 编排、验证与上线边界

- 本批无已签发的下批次 mode intent，采用默认快车道：主上下文完成 Planner/Generator 编排，Evaluator 必须是
  fresh-context 子会话，且不修改产品代码。
- F001 与 F002 可并行（服务端 parser 与版本合同文件集不重叠）；F003 依赖 F002 的发行数据后执行。
- Evaluator 从锁定 SHA 自行读取实物与运行命令，不接受实现过程叙述；正式上线前必须通过
  `verifying -> done` 的一次性人工 `phase_advance` 闸门。
- 用户已经明确授权本批上线；闸门只批准状态机完成，推送、CI/CD 和安装后 smoke 在闸门消费后按本批发布清单执行。

## 4. Feature 与验收

### F001 - 旧 Agent 空工具目录上报兼容

**范围：** `src/server/harness-mode-intent-api.ts`、Harness report route 测试。

**验收：**

- feature 6 旧 Agent 的精确 snapshot（`dispatch.enabled=false`、空 `agents`/`integrations`/`toolCatalog`）可以经
  `/api/harness/report` 持久化，upsert 数据包含新的 `reportedAt`。
- 空目录不被转换为可签发目录：`modeToolCatalogFromSnapshot()` 和 v2 签发仍拒绝它。
- disabled 非空/畸形目录与 enabled 畸形目录继续在 Prisma 查询前以 `invalid_tool_catalog` 拒绝；现有敏感字段和
  unknown-field fail-closed 语义不变。

### F002 - Agent 1.1.0 发行与能力门槛契约

**范围：** `src/shared/agent-feature-version.ts`、`src/shared/agent-releases.json`、版本/模式兼容测试。

**验收：**

- 新 build 上报 capability 7 和 release `1.1.0`；manifest 严格递增，末项 capability 与源码常量一致。
- feature 6/release `1.0.0` 被 `deviceAgentUpdateStatus()` 判为 `upgrade-required`，最新版仍为 latest，未来版本不被要求降级。
- tool-bound intent 的 UI/API 门槛为 7；旧 v1 intent 的能力门槛仍为 4。
- `1.1.0` 中英文 highlights 只描述本批的 report 兼容与升级可见性，而不是旧发行的无关功能。

### F003 - 首页升级提示语义完整性

**范围：** `app/layout.tsx`、`app/_components/upgrade-banner.tsx`、中英文消息与组件/静态渲染测试。

**验收：**

- 旧 feature 6 设备触发首页升级提示，目标为 `v1.1.0`，功能说明来自 manifest 最新条目。
- 仅 `unknownCount>0` 时首页仍提示版本待核验，但不伪称必须升级；同时有 outdated 与 unknown 时两种信息均可见。
- 两个 locale 的消息键和插值对称，文本不会显示过期发行说明或把 unknown 当 latest。

### F004 - 独立验收、闸门与发布后收敛验证

**范围：** `docs/test-reports/BL-AGENT-REPORT-COMPAT-verdict.json` 及只读/测试证据；禁止产品代码修改。

**验收：**

- Fresh-context Evaluator 在锁定 SHA 上自行审查 diff，运行 F001-F003 聚焦测试、全量 `npm test`、
  `npm run typecheck`、`npm run lint` 和 `npm run build`，并逐项输出 PASS/PARTIAL/FAIL、证据与 `waiting=null`。
- 验证 live-old fixture 可重新持久化 report，所有恶意/畸形目录仍 fail-closed；验证 capability/release/banner 三态。
- 全 PASS 后创建一次性 `BL-AGENT-REPORT-COMPAT-verifying-done-w1` 人工闸门；批准、提交、推送、CI/CD 完成后，更新本机
  Agent，确认新 heartbeat 是 release `1.1.0` / feature 7、Harness report 成功且 `invalid_tool_catalog` 不再出现。

## 5. 完成定义

- F001-F004 均为 completed，独立 verdict 为全 PASS，人工闸门已由控制台签发并由本机验签消费。
- 产品与状态机提交可追溯；不包含 `.claude/dispatch/agents-registry.example.json` 的本机定制。
- GitHub Actions 的 Verify、Windows Verify 与 Deploy 通过，生产 `/api/health` 对应发布 commit。
- 安装后的本机 Agent 能在一次正常同步周期内恢复 Harness 项目上报，并在控制台显示新发行状态。
