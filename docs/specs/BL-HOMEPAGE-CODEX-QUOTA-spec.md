# BL-HOMEPAGE-CODEX-QUOTA

## 确认与范围

- 用户于 2026-09-11 确认：首页仅一个 Codex 用量区，默认展示最近上报账号，其他账号折叠；超过 15 分钟未更新或重置时间已到的额度标记待刷新；保留历史数据与账号隔离。
- 根因证据：`docs/analysis/2026-09-11-codex-quota/source-trace.md`。不得把诊断当作本批验收结论。
- 仅在 `codex/homepage-codex-quota-20260911` 独立 worktree 建批。主仓仍保留 BL-HOMEPAGE-FRESHNESS/verifying；其原状态备份在诊断目录 `previous-batch/`。回流代码不得覆盖主仓原批次状态。
- 禁止 push、部署、生产写入、数据库清理、凭据读取、协议修改、agent 能力版本升级与框架修改。
- Coordinator 落本规格，Codex Generator 在隔离 worktree 实现；Kimi 或 Claude fresh-context Evaluator 独立验收，同 family scope critic 不代替正式验收。
- 4 个 Generator feature 串行，各含回归与独立 commit；F005 为 Evaluator。仅 hotfix worktree 的状态可推进，不消费原 active batch 的 mode intent，不写 pending_gate.decision。

## 布局变更（明确授权）

有意将原首页多卡网格收成一个全宽 Codex 区域。仅替换现有 SubscriptionCard 内部结构，其首页位置、其他 KPI/图表/刷新机制不变。仓库没有 `design-draft/`，没有可用 Stitch 设计引用；本规格为该局部布局变更依据。

默认有且只有一个 Codex 标题和一个展开的账号快照。最近上报账号按合法 capturedAt 降序选择；相同时按 accountKey 稳定排序。不能依赖账号字典序，不能把最近上报称为当前登录/使用账号。其他账号在原生 `<details><summary>` 内默认折叠，键盘可展开，账号身份/时间可查，不再平铺多张大卡。单账号没有折叠控件；空状态保持原引导；legacy byProvider 形状继续渲染。

## 数据与新鲜度契约

1. 保留 userId + provider + accountKey + windowKey 分组和所有历史记录。每窗口 DTO 新增自身数据库行的 capturedAt ISO 字段，不能用账号最大时间替代。无 schema/migration。
2. 每个 rate-limit 窗口独立判定。合法 capturedAt 距本次服务端 render 的 now **大于 15 * 60 * 1000 ms** 为陈旧；恰好 15 分钟仍新鲜。合法 resetsAt 小于等于 now 即待刷新，不推断重置后 100%。
3. missing/invalid/future capturedAt 为待刷新；旧 cached DTO 缺窗口时间不能借用 plan 时间。resetsAt 缺失不影响年龄判定，存在但非法也不展示当前额度。utilization 非有限 [0, 1] 时显示未知，不能产生 NaN%、负宽或超过 100%。
4. 待刷新显示 `—` 与明确文字，进度条不呈现健康剩余值；不得继续强调陈旧百分比，不伪造 0% 或 100%。原值仍保留在数据库/API。
5. credit_balance 按自身时间执行年龄规则，陈旧/未知时不显示美元余额或无限额度。套餐标签为上报快照，不声明当前连接状态。
6. 账号脚注表示最近一次上报，不暗示所有窗口同时采集；各窗口自身采集时间可查。重置使用绝对日期时间和用户时区，区分重置于/重置时间已过；不再出现“几小时前后重置”或重复“前”。
7. 复用首页现有 30s AutoRefresh，不新增轮询、客户端计时器或依赖。

## Features

- **F001 / generator**：窗口级 capturedAt DTO 与局部更新回归；保留账号/租户隔离和旧字段。
- **F002 / generator**：一个 Codex 区域、最近上报默认展开、其他账号 native details 折叠；单/多/空/legacy/乱序/同时间回归。
- **F003 / generator**：逐窗口 15 分钟/重置失效与 unknown fail-closed；包含 credits、局部新旧窗口及边界回归。
- **F004 / generator**：中英采集/重置/快照文案，真实 locale 格式与占位符回归；布局保持本节定义。
- **F005 / evaluator**：独立源码实物检查、lint/verify/test/build、桌面/窄屏实际组件 UI 验证，报告明确未部署生产。不得按 Generator 自述给 PASS，不修改产品。

## D-i18n：subscription 命名空间扩展

- 仅 en/zh-CN 完整翻译，新增其他账号快照、最近上报说明、待刷新、采集时间未知及重置状态等所需键；占位参数保持一致。
- 项目没有行业词同文 allowlist 守门；保留既有 `subscription.codex.title = Codex / ChatGPT`。不加不必要 ICU plural，数量可用 `{count}`；若用 plural 则两语 shape 一致。
- 除 mock-key 测试外，使用真实翻译验证无 raw key、缺 placeholder、重复过去式或 invalid date。

## 交付与验证

Generator 每功能自测后提交代码与状态；独立 scope critic 仅检查本规格的范围约束，不代替异厂商验收。

Evaluator L1：`npm run lint`、`npm run verify`、`npm test`、`npm run build`。如需 DB，只创建隔离 scratch，禁止连生产。UI 可用测试产物从真实 SubscriptionCard SSR 渲染 fixture HTML + 项目编译 CSS，在本地只读服务器用浏览器检查，不能手写仿造卡片；说明这不覆盖生产登录/采集链路。

正式产物 `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-verdict.json` 由异厂商 Evaluator 原样落盘，使用 `.claude/autonomous/verdict-artifact.schema.json`，可另附 signoff。生产部署与上线后登录态复核不属于本次授权，交付明确未部署。
