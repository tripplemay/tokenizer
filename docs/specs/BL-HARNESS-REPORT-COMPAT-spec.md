# BL-HARNESS-REPORT-COMPAT - Harness 上报身份与摘要兼容修复

## 1. 背景与目标

`BL-HARNESS-SYNC-HEALTH` 部署后，生产 agent 能稳定暴露 Harness 传输健康，但真实九个项目中仍有三个
被 `/api/harness/report` 以 `sensitive_summary_data` 拒绝：

- `harness-console-demo`、`wearwhat` 没有 Git remote；客户端回退为 `local:<绝对路径>`，与“不上传本机
  绝对路径”的持久化契约直接冲突。
- `aigcgateway`、`wearwhat` 的合法 feature 标题包含 `/v1/...`、`/api/...`、`喜欢/不喜欢`、
  `门禁/限制/计费` 等斜杠语法；当前 POSIX 绝对路径检测把路由引用和自然语言分隔符误判为本机路径。

本批目标是消除这三个确定性 400，同时保持服务端对本机路径、原始 prompt/stdout/stderr、环境变量、
凭据和自由日志的 fail-closed 防线。修复后一次同步应能报告全部九个项目，健康快照进入 `success`。

## 2. 功能范围

### F001 - 无远端 Harness 仓库的匿名稳定身份

- `discoverHarnessRepos()` 对有 Git remote 的仓库继续使用既有规范化 remote，零迁移、零行为变化。
- 对无 remote 的仓库，不再生成 `local:<root>`；改为
  `local:sha256:<sha256(normalized-root)>`，不得把原始 root、用户名或路径片段放入上报体。
- 同一路径重复发现必须得到同一 key；不同路径必须得到不同 key；输出只含小写十六进制摘要。
- 哈希输入使用项目既有跨平台路径规范化 helper，避免 Windows 分隔符造成无意义漂移。
- 该身份只在当前设备上稳定，不承诺跨设备关联；项目显示名仍来自目录 basename。

### F002 - feature 标题斜杠语法的精确安全校验

- `feature.title` 允许完整、边界明确的 Harness 命令引用，以及只含安全 route segment 的
  `/api/...`、`/v<数字>/...` 引用。
- 词内或自然语言中的斜杠分隔符（如 `喜欢/不喜欢`、`i2i/edits/MCP`、独立的 ` / `）不视为
  POSIX 绝对路径。
- 仍拒绝 `/Users/...`、`/home/...`、`/srv/...`、`/tmp`、`file://...`、Windows drive path、反斜杠或正斜杠
  UNC path（例如 `\\server\\share`、`//server/share`）、
  路径形状的未知 slash command、换行、raw channel 标记和凭据。
- route 例外只对 `feature.title` 生效；`errorSummary`、mode issue、gate detail 等其他持久摘要继续使用
  严格规则。
- 错误响应保持只返回字段名与安全 code，不回显被拒原文。

### F003 - 真实失败形状回归与兼容证明

- CLI 测试证明无 remote 时 payload 不含临时 HOME/仓库绝对路径，并且 repoKey 可被服务端接受。
- 服务端测试覆盖本批真实合法形状：`REST /v1/images/generations`、`POST /api/trip/generate`、
  `喜欢/不喜欢`、`门禁/限制/计费`。
- 负例覆盖真实本机绝对路径、反斜杠与正斜杠 UNC、route traversal/path-shaped suffix、凭据、raw channel、换行和非标题字段；
  所有拒绝必须发生在 Prisma 首次查询/写入之前。
- 聚焦测试、全量 `npm test`、`npm run verify`、`npm run lint`、`npm run build` 全绿。
- 这是纯 bug fix，不修改 Prisma、UI、i18n、Harness framework 或 agent feature version。

### F004 - Kimi A2A 独立验收

- Evaluator 锁定实现 SHA，从 fresh context 自行审查完整 diff 和安全边界。
- 自行运行聚焦测试、全量测试、verify、lint、build；不得只复述 Generator handoff。
- 用临时 HOME 构造 remote + local 仓库，验证上报体无绝对路径、合法标题全接收、敏感负例 fail-closed。
- 结论写入 `docs/test-reports/BL-HARNESS-REPORT-COMPAT-verdict.json`，符合 verdict schema。

## 3. 关键设计决策

### D1 - 本地路径只参与单向哈希

服务端不能接收原始路径后再哈希，因为上传本身已经违反数据最小化。匿名 key 必须在 agent 侧生成；
服务端继续把 `repoKey` 当普通不透明身份处理。

### D2 - 按语义缩小误报，不关闭路径检测

不能简单删除 POSIX path 正则。实现应先从 `feature.title` 的扫描副本中移除精确允许的命令/route token，
再对剩余文本执行严格路径、raw channel 和凭据检测。例外不得扩散到其他字段。

### D3 - 无数据迁移与版本 bump

两个本地项目从未成功写入 HarnessProject，因此新 opaque key 不产生重复历史行。该修复不改变 heartbeat schema
或 agent 能力协商，按项目规则不提升 `AGENT_FEATURE_VERSION`。

### D4 - Dispatch 与生产边界

- Planner/Orchestrator：当前主上下文。
- Generator：`builder-codex`，`local-cli` 独立沙箱，实现 F001-F003。
- Evaluator：`reviewer-kimi-a2a`，loopback A2A fresh context，验收 F001-F004。
- Generator/Evaluator family 互斥；自治关闭。
- 本批不 push 产品代码、不部署、不访问生产数据库；生产九项目 `success` 只在后续用户显式授权发布后 smoke。

## 4. 验收矩阵

| Feature | 最低机械证据 |
|---|---|
| F001 | remote 不变；local key 固定格式、稳定、区分路径；payload/state/stdout 不出现绝对路径 |
| F002 | 四类真实合法标题接收；POSIX/Windows/UNC/file URL、raw channel、凭据与非标题字段继续拒绝 |
| F003 | 真实失败形状端到端 route 测试；Prisma 前 fail-closed；全量 test/verify/lint/build |
| F004 | A2A receipt + schema 合法 verdict；fresh-context 独立命令与安全审查证据 |

## 5. 完成定义

- F001-F004 全部 `completed`，Evaluator verdict 全 PASS、`waiting=null`。
- 实现、测试和报告 commit 可追溯，工作树干净。
- `progress.json` 进入 `verifying` 后创建一次性 `phase_advance` 人工闸门；批准前不得置 `done`。
- 未获得新一轮显式 ops 授权前，不 push 会触发生产部署的产品路径。
