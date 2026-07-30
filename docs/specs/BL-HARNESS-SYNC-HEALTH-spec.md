# BL-HARNESS-SYNC-HEALTH - Harness 同步健康与可观测性

## 1. 背景与目标

`tokenizer` 的后台 agent 已每 60 秒执行一次 harness 状态上报、模式意图暂存和人工闸门决策中继，
但结果目前只写入 `~/.tokenizer/logs/agent.log`。设备心跳、设备详情页和 Harness 控制台都看不到
这条链路是否成功。2026-07-28 的真实故障表现是：本机已有待批闸门，控制台没有出现；只能人工运行
`npm run cli -- harness` 才确认并补做上报。2026-07-30 的 agent 日志进一步证明，健康项目可持续成功，
同时 3 个项目因确定性 HTTP 400 每分钟重复失败；控制台仍无法区分“未运行”“部分成功”“完全失败”。

本批目标：

1. 把一次 harness 同步变成结构化、可测试的结果，不再依赖解析日志散文。
2. 在 agent 本地状态和设备心跳中记录最近一次 harness 同步健康快照。
3. 在设备页和 Harness 控制台显示成功、部分失败、失败、陈旧四类状态及有界问题摘要。
4. 保持用量同步、quota、闸门中继和模式意图互不阻塞；诊断失败不得拖垮主链路。
5. 用异厂商 dispatch 完成实现与独立验收，继续验证 local-cli generator + A2A evaluator 链路。

## 2. 用户与核心场景

主要用户是管理多台开发机和多个 harness 项目的项目负责人。

- 人工闸门没有出现在控制台时，从设备页直接判断 agent 是否跑过、是全失败还是部分项目失败。
- 某项目卡在“等待中继”时，区分设备离线、同步陈旧、HTTP 拒收和本机写入失败。
- 在终端用机器可读输出复现同一份健康快照，而不必 tail/grep agent.log。
- 老版本 agent 继续工作；服务端不能因缺少新诊断字段而清空历史值或拒绝心跳。

## 3. 功能范围

### 3.1 F001 - 结构化同步结果与安全错误分类

扩展 harness 同步结果，在保留现有 `reported/applied/stagedIntents` 与兼容字符串列表的同时，增加
有界 `issues` 数组。每项只允许以下结构：

```ts
type HarnessSyncIssue = {
  operation: "report" | "applied_ack" | "mode_intent" | "relay";
  project: string | null;
  code: string;
  retryable: boolean;
};
```

规则：

- HTTP 408、429、5xx、网络错误和超时为 `retryable=true`。
- 其余 4xx 与本机契约/写入拒绝为 `retryable=false`。
- 若服务端返回 JSON `code`，仅接受规范化后的安全 code；否则回退 `http_<status>`、
  `network_error`、`timeout`、`local_error` 等固定值。
- `project` 来自本机已发现项目名，截断到 200 字符；`issues` 最多 20 项。
- **禁止**把响应正文、异常 stack、token、URL query、绝对路径或任意自由文本放入结构化诊断。
- 单项目失败不阻断其他项目；上报失败不阻断 mode intent 或 gate relay，反之亦然。

### 3.2 F002 - Agent 本地健康快照与日志去重

每次 `runHarnessSync()` 结束（包括 CLI 手动运行、`runOnce` 和常驻 scheduler）都原子更新
`~/.tokenizer/state.json` 的 `harness` 字段：

```ts
type HarnessSyncSnapshot = {
  attemptedAt: string;
  status: "idle" | "success" | "degraded" | "failed";
  reported: number;
  failed: number;
  relayed: number;
  modeIntents: number;
  issues: HarnessSyncIssue[];
};
```

状态判定：无发现项目且无 issue=`idle`；无 issue 且至少一个成功=`success`；有成功也有 issue=`degraded`；
无成功且有 issue=`failed`。异常路径也必须落 `failed` 快照，不能保留旧的成功状态。

日志保留操作摘要，但连续轮次 issue 指纹不变时不重复刷逐条详情；指纹变化或从异常恢复时必须写一条。
日志去重只降噪，不改变实际重试频率和闸门周转上限。

### 3.3 F003 - 心跳、数据库与兼容契约

新增 Device 持久字段：

- `lastHarnessSyncAt DateTime?`
- `harnessSyncStatus String?`
- `harnessDiagnostics Json?`

`DeviceDiagnostics` 增加可选 `harness` 快照。心跳端严格校验时间、状态、非负安全整数、数组长度、
operation 枚举与规范化 code；非法新字段返回 400，不写半份数据。合法快照写入以上三列。

兼容要求：

- 老 agent 不发送 `harness` 时，不覆盖已有 harness 诊断列。
- 本地 state 缺失/损坏时，heartbeat 仍成功，只省略 harness 字段。
- 数据库迁移可重复部署，不修改既有业务数据。
- 这是 schema-affecting heartbeat capability，`AGENT_FEATURE_VERSION` 与
  `MIN_AGENT_FEATURE_VERSION` 同步从 4 升至 5，并补 history 注释。

### 3.4 F004 - 控制台诊断展示

在现有页面增量展示，不新增页面、不改变导航和信息架构：

- `/devices`：诊断列增加 Harness 状态 badge；失败/部分失败与陈旧状态可扫描。
- `/devices/[id]`：客户端诊断区增加最近 Harness 同步、成功/失败项目数、中继数、模式意图数，
  并列出最多 20 条规范化问题（项目、操作、code、是否可重试）。
- `/harness`：项目卡利用关联 device 的 harness 快照显示 `success/degraded/failed/stale/not-reported`，
  并提供设备详情链接；人工闸门区保持当前最高视觉优先级。

新鲜度统一以 `lastHarnessSyncAt` 计算：超过 3 分钟为 `stale`。状态映射与样式抽成 shared helper，
避免三个页面各自实现阈值。英文和简体中文 key 同步新增，placeholder 形状保持一致。

仓库没有 `design-draft/` 或对应 Stitch 原型。本批是现有诊断区的内容扩展，不做页面架构变更；
变更后必须沿用现有 Card、badge、字号与颜色语义，桌面和窄屏不得溢出或遮挡。

### 3.5 F005 - CLI、回归测试与运维文档

- `tokenizer harness --status` 只读本地最新快照，不发网络请求。
- `tokenizer harness --json` 完成一次同步后输出单个 JSON 对象，stdout 不混入项目列表或散文；
  人类默认输出保持兼容，并追加安全的结构化 issue 摘要。
- README 补充两种诊断命令和四类状态含义。
- 覆盖同步结果分类、20 项上限、state 原子写入/损坏恢复、日志去重、heartbeat 新旧 payload、
  非法 payload、shared freshness helper、CLI stdout 契约和关键 UI 渲染分支。

### 3.6 F006 - 异厂商独立验收

Evaluator 锁定实现 SHA，自行读取 spec 与实物，至少执行：

1. 目标 Vitest 文件与全量 `npm test`。
2. `npm run verify`、Prisma generate/migration SQL 静态检查和 `npm run build`。
3. 临时 HOME/临时 state fixture 下验证 `harness --status` 与 `harness --json` stdout 是合法契约，
   不泄漏模拟 response body/token/绝对路径。
4. 模拟全成功、部分 400、全网络失败、恢复四轮，核对本地 snapshot、心跳 body 与日志去重。
5. 静态检查设备列表、设备详情、Harness 项目卡三处共享同一 freshness helper，且中英文 key 对称。

验收输出 `docs/test-reports/BL-HARNESS-SYNC-HEALTH-verdict.json`，符合既有 verdict schema。

## 4. 关键设计决策

### D1 - 诊断是镜像，不是第二真相源

真实编排状态仍在各仓库 `progress.json/features.json`。Device 诊断只描述最近一次传输尝试，不用于推进阶段、
签发决策或判断 gate 已消费。

### D2 - 原始错误只进本机日志，不进结构化持久层

服务端响应正文可能包含敏感片段。上传和数据库只保存枚举 operation、规范化 code、项目显示名和布尔
retryable；不得上传自由文本 detail。CLI JSON 同样使用这一白名单结构。

### D3 - 不降低闸门轮询频率

永久 400 的请求退避不在本批范围。agent 仍每 60 秒尝试完整同步，保证已批准闸门的现有周转上限。
本批只对重复日志降噪并让失败可见；自适应 backoff 可在有数据后另立批次。

### D4 - 数据模型使用显式列 + 有界 JSON

时间和总状态使用显式列，便于页面查询与陈旧判断；计数和 issue 列表放 `harnessDiagnostics` JSON，避免
为每个计数建立低价值列。服务端写入前完成完整运行时校验。

### D5 - 执行车道与编排

- Planner：当前主上下文。
- Generator：`builder-codex`，`local-cli` 独立 worktree，串行实现 F001-F005；这些功能跨越共享类型、
  agent、schema 和 UI，文件重叠明显，不做并行 building。
- Evaluator：`reviewer-kimi-a2a`，A2A loopback fresh context 验收 F001-F006；与 Generator family 互斥。
- 自治关闭；不访问生产、不执行部署、不运行 `prisma migrate deploy`，不使用真实付费模型 API。
- 实现 commit 由编排者机械回流、复跑 L1 后推送；跨 `verifying -> done` 必须人工批准。

### D6 - i18n 命名空间扩展计划

**扩展命名空间：** `device.diagnostics`、`devices.diag`、`harness`，不新增顶层 namespace。

**翻译策略：**

- 仓库当前只有 `messages/en.json` 与 `messages/zh-CN.json`，两份由 Generator 同 commit 手填。
- `Harness` 是产品功能名，英文与中文允许保持相同字面；项目没有 locale-coverage allowlist 脚本，
  因此本批不新增虚假的 CI 白名单。
- 本批新 key 不使用 ICU plural；若实现中引入 `{count, plural, ...}`，两种 locale 必须保持相同 shape。
- 新增 key 的路径与 placeholder 集合必须在两份 locale 中逐项对称，并由测试机械比较。

### D7 - Prisma JSON 写入

`harnessDiagnostics` 写入值必须先完成运行时白名单解析，并以 `Prisma.InputJsonValue` 类型落库；不使用
`Record<string, unknown>` 直接赋值，也不以 `@ts-ignore` 绕过。迁移只给既有 `Device` 加列，不创建
新表，故不触发新表 RLS policy 条款。

## 5. 数据与接口

### Prisma

```prisma
model Device {
  lastHarnessSyncAt  DateTime?
  harnessSyncStatus  String?
  harnessDiagnostics Json?
}
```

迁移只执行 `ALTER TABLE Device ADD COLUMN ...`（以项目当前 PostgreSQL 命名为准），无 backfill。

### Heartbeat payload

```json
{
  "device": {
    "diagnostics": {
      "harness": {
        "attemptedAt": "2026-07-30T14:21:45.000Z",
        "status": "degraded",
        "reported": 6,
        "failed": 3,
        "relayed": 0,
        "modeIntents": 0,
        "issues": [
          {
            "operation": "report",
            "project": "example",
            "code": "sensitive_summary_data",
            "retryable": false
          }
        ]
      }
    }
  }
}
```

本批不新增 API route，因此不引入新的 rate-limit 面；沿用现有 device token 鉴权与 heartbeat 频率。

## 6. 非目标

- 不自动批准、驳回或消费任何人工闸门。
- 不从控制台反向修改本机日志或重启 agent。
- 不为永久 4xx 实现退避/隔离队列，不改变 60 秒同步频率。
- 不新增通知、邮件、Webhook 或外部告警。
- 不访问生产数据库，不触发生产部署，不做历史诊断 backfill。
- 不修改 harness-template 源码；本批只改 tokenizer 产品。

## 7. 验收矩阵

| Feature | 最低机械证据 |
|---|---|
| F001 | HTTP/网络/本机错误分类测试；issue 上限；四条子链互不阻塞；无原始正文进入结构化结果 |
| F002 | success/degraded/failed/idle 判定；所有入口落 state；损坏 state 恢复；重复日志只打一轮且恢复有记录 |
| F003 | migration + Prisma generate；新旧 heartbeat payload；非法嵌套字段 fail-closed；版本常量均为 5 |
| F004 | 三处 UI 状态分支；共享 3 分钟 freshness helper；中英文 key 对称；窄屏 class 无固定宽度溢出 |
| F005 | `--status` 零网络；`--json` stdout 可直接 JSON.parse；默认输出兼容；README 与测试齐全 |
| F006 | Kimi A2A 合法 receipt/verdict；全量 test/verify/build 证据；安全泄漏负例；结论逐项对应 F001-F006 |

## 8. 完成定义

- F001-F006 均为 `completed`，`completed_features=6`。
- Generator 与 Evaluator 工件通过各自 schema，锁定 SHA 可追溯。
- 编排者复跑全量 test、verify、build，迁移 SQL 与 Prisma schema 一致。
- `progress.json` 进入 `verifying` 并创建一次性 `phase_advance` 人工闸门；人工批准前不得置 `done`。
