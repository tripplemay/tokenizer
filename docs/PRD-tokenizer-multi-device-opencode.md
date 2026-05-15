# Tokenizer 多设备 Token 统计与 OpenCode 接入 PRD

## 1. 背景

Tokenizer 是一个用于统计 coding 过程中 AI 工具 token 消耗的个人分析工具。

当前 MVP 已支持：

- 本机采集 Claude Code usage
- 本机采集 Codex usage
- 上传到本地/云端服务端
- PostgreSQL 存储 usage events
- Dashboard 展示项目、模型、工具、时间维度的 token 消耗

用户未来会在多台电脑上开发同一个项目，并希望所有设备产生的 token 消耗统一上传到云端数据库中进行分析。因此系统需要从单机采集演进为多设备采集，并支持跨设备项目归并。

另外，OpenCode 是用户核心 coding 工具之一，当前尚未接入完整统计能力。已确认 OpenCode 本机真实 usage 数据源为 SQLite 数据库。

## 2. 目标

### 2.1 短期目标

实现 OpenCode 真实 token 统计能力。

具体目标：

- 从 OpenCode SQLite 数据库读取真实 token usage
- 将 OpenCode usage 转换为现有 UsageEventInput
- 通过现有 CLI collect/sync 流程上传
- Dashboard 的 Sources 中出现 `opencode`
- OpenCode 数据可以按项目、模型、日期维度汇总

### 2.2 中期目标

支持多设备采集。

具体目标：

- 每台设备拥有稳定 deviceId
- 用户可以手动命名设备
- 设备信息随 batch upload 上传
- 服务端按 deviceId 记录来源
- 同一设备重复上传不重复计数
- 不同设备的数据可区分、可汇总

### 2.3 长期目标

支持跨设备同项目归并。

具体目标：

- 同一个 Git remote 在不同设备、不同本地路径下归为同一个 Project
- Project 不再唯一绑定本地 workspacePath
- UsageEvent 保留本地路径作为 localWorkspacePath
- Dashboard 支持按 Project / Device / Source / Model / Time 分析

## 3. 非目标

当前阶段不处理：

- 团队多用户权限系统
- 企业多租户
- 云端账单支付
- 完整成本模型
- 项目手动合并 UI
- OpenCode 实时监听
- Prometheus/Grafana 集成

## 4. 当前系统现状

当前项目路径：

```text
/Users/zhouyixing/project/tokenizer
```

当前技术栈：

```text
Next.js
TypeScript
Prisma
PostgreSQL
Node CLI
```

当前核心表：

```text
Project
UsageEvent
CollectorState
```

当前 UsageEvent 去重约束：

```text
unique(source, sourceEventId)
```

当前已支持 sources：

```text
claude-code
codex
```

OpenCode 当前状态：

```text
parser skeleton only
diagnose only
```

## 5. OpenCode 数据源调研结论

### 5.1 OpenCode 配置目录

已发现：

```text
~/.config/opencode/opencode.json
```

该文件包含 provider/model 配置。

### 5.2 OpenCode 数据目录

已确认真实数据目录：

```text
~/.local/share/opencode
```

其中关键文件：

```text
~/.local/share/opencode/opencode.db
```

数据库类型：

```text
SQLite
```

### 5.3 关键表

```text
session
message
part
project
event
```

### 5.4 关键字段

`message.data` 中包含 assistant message 的真实 token usage。

示例：

```json
{
  "parentID": "msg_xxx",
  "role": "assistant",
  "mode": "plan",
  "agent": "plan",
  "path": {
    "cwd": "/Users/zhouyixing/project",
    "root": "/"
  },
  "cost": 0,
  "tokens": {
    "total": 193791,
    "input": 5045,
    "output": 330,
    "reasoning": 0,
    "cache": {
      "write": 0,
      "read": 188416
    }
  },
  "modelID": "gpt-5.5",
  "providerID": "guangcpa",
  "time": {
    "created": 1778835847044,
    "completed": 1778835867597
  },
  "finish": "tool-calls"
}
```

### 5.5 当前本机数据规模

已确认：

```text
message 中有 token 的记录：597 条
part 中 step-finish 有 token 的记录：597 条
```

OpenCode 当前可聚合数据示例：

```text
/Users/zhouyixing/project/minigame_agent  gpt-5.5          70.3M
/Users/zhouyixing/project                 gpt-5.5          12.3M
/Users/zhouyixing/project/trade           gpt-5.5           1.3M
/Users/zhouyixing/project                 minimax-m2.5      380.5K
/Users/zhouyixing                         minimax-m2.5      330.4K
/Users/zhouyixing/project                 mimo-v2.5         173.8K
/Users/zhouyixing/project/trade           minimax-m2.5       36.0K
```

预计 OpenCode 总量约：

```text
84.8M tokens
```

## 6. OpenCode Parser 方案

### 6.1 事件粒度

采用 message 粒度：

```text
一条 assistant message = 一条 UsageEvent
```

原因：

- `message.data` 已包含完整 token 信息
- `message.data` 已包含 model/provider/path/cost
- 去重简单
- 与当前 Codex/Claude usage event 粒度接近

不采用 `part.step-finish` 作为第一版粒度。

### 6.2 依赖选择

推荐新增：

```text
better-sqlite3
@types/better-sqlite3
```

原因：

- 同步读取 SQLite，适合 CLI parser
- 不依赖系统 sqlite3 命令
- 实现简单可靠

风险：

- `better-sqlite3` 是 native dependency
- 极少数环境可能需要编译工具链

备选：

```text
sqlite3 CLI
```

不建议默认采用，因为跨平台和错误处理更差。

### 6.3 数据库路径探测

OpenCode parser 按顺序探测：

```text
$XDG_DATA_HOME/opencode/opencode.db
~/.local/share/opencode/opencode.db
~/Library/Application Support/opencode/opencode.db
```

当前本机实际路径：

```text
~/.local/share/opencode/opencode.db
```

### 6.4 查询策略

为提高兼容性，SQL 只做基础 join，不依赖 SQLite JSON functions 做强筛选。

推荐 SQL：

```sql
select
  m.id as message_id,
  m.session_id,
  m.time_created,
  m.time_updated,
  m.data as message_data,
  s.directory,
  s.path,
  s.project_id,
  s.agent,
  s.model as session_model,
  p.worktree,
  p.name as project_name
from message m
join session s on s.id = m.session_id
left join project p on p.id = s.project_id
order by m.time_created asc;
```

TypeScript 负责：

- JSON.parse(message_data)
- 判断 role 是否为 assistant
- 判断 tokens.total 是否大于 0
- 字段映射
- 异常行跳过并 warning

### 6.5 字段映射

OpenCode message 映射为 UsageEventInput：

```text
source                 = opencode
sourceEventId          = opencode:<message_id>
sessionId              = session_id
workspacePath          = message.data.path.cwd || session.directory || project.worktree
projectName            = basename(workspacePath) 或 project.name
model                  = message.data.modelID || session_model.id
inputTokens            = tokens.input
outputTokens           = tokens.output
cachedInputTokens      = tokens.cache.read
reasoningOutputTokens  = tokens.reasoning
totalTokens            = tokens.total
costUsd                = message.data.cost
occurredAt             = message.data.time.completed || message.data.time.created || m.time_created
rawJson                = message + session/project metadata
```

当前 UsageEventInput 暂不新增字段：

```text
provider
cacheWriteTokens
messageId
```

这些字段先放入 rawJson：

```json
{
  "messageId": "msg_xxx",
  "providerID": "guangcpa",
  "cacheWriteTokens": 0,
  "agent": "plan",
  "session": {},
  "project": {}
}
```

后续 schema 演进时再结构化。

### 6.6 OpenCode Diagnose 增强

当前 diagnose 需要补充：

```text
~/.local/share/opencode
~/.cache/opencode
```

输出内容建议：

```text
OpenCode config directories
OpenCode data directories
opencode.db found / not found
log files found
tokenized messages count
```

示例：

```text
OpenCode database: /Users/zhouyixing/.local/share/opencode/opencode.db
Tokenized messages: 597
Logs: 8 files
Parser: ready
```

## 7. 多设备采集方案

### 7.1 设备命名决策

已确认：

```text
允许手动命名设备
```

推荐 CLI：

```bash
tokenizer init --device-name "MacBook Pro"
```

如果未传入名称，默认使用 hostname：

```text
zhouyixing.local
```

### 7.2 本地设备配置

新增：

```text
~/.tokenizer/device.json
```

示例：

```json
{
  "deviceId": "dev_01HXABCDEF123456789",
  "deviceName": "MacBook Pro",
  "hostname": "zhouyixing.local",
  "platform": "darwin",
  "createdAt": "2026-05-15T00:00:00.000Z"
}
```

要求：

- `deviceId` 初始化后保持稳定
- `deviceName` 可修改
- 上传时带上 device 信息
- 同一设备重复 sync 不重复计数

### 7.3 服务端 Device 表

新增：

```text
Device
  id
  name
  hostname
  platform
  createdAt
  lastSeenAt
  metadata
```

### 7.4 UsageEvent 增加 deviceId

UsageEvent 新增：

```text
deviceId
```

未来去重约束从：

```text
unique(source, sourceEventId)
```

升级为：

```text
unique(deviceId, source, sourceEventId)
```

原因：

- 同一设备同一事件不能重复入库
- 不同设备可能生成相似 sourceEventId
- 多设备上传必须隔离去重范围

### 7.5 API Payload

未来 batch upload 使用：

```json
{
  "device": {
    "id": "dev_01HXABCDEF123456789",
    "name": "MacBook Pro",
    "hostname": "zhouyixing.local",
    "platform": "darwin"
  },
  "events": []
}
```

服务端流程：

```text
1. upsert Device
2. update Device.lastSeenAt
3. 对每条 event 归并 Project
4. insert UsageEvent
5. 使用 unique(deviceId, source, sourceEventId) 去重
```

### 7.6 历史数据迁移策略

新增 Device 后，需要给已有 UsageEvent 绑定默认设备：

```text
Device: Local Device
```

历史数据迁移：

```text
UsageEvent.deviceId = Local Device.id
```

## 8. Git Remote 项目归并方案

### 8.1 项目归并决策

已确认：

```text
同一项目跨设备归并以 Git remote 为准
```

### 8.2 Project 身份

Project 的稳定身份应从 workspacePath 切换为 repoKey。

新增/调整 Project 字段：

```text
repoKey
repoRemote
name
```

UsageEvent 新增：

```text
localWorkspacePath
repoKey
gitRemote
gitBranch
gitCommit
```

### 8.3 归因优先级

项目归因优先级：

```text
1. repoKey
2. git root basename
3. workspacePath basename
4. Unknown Project
```

### 8.4 Git Remote 标准化

这些输入应统一为同一个 repoKey：

```text
git@github.com:tripplemay/aigcgateway.git
https://github.com/tripplemay/aigcgateway.git
https://github.com/tripplemay/aigcgateway
ssh://git@github.com/tripplemay/aigcgateway.git
```

标准化结果：

```text
github.com/tripplemay/aigcgateway
```

### 8.5 CLI 采集 Git 信息

采集时尝试执行：

```bash
git -C <workspace> rev-parse --show-toplevel
git -C <workspace> remote get-url origin
git -C <workspace> branch --show-current
git -C <workspace> rev-parse HEAD
```

失败处理：

```text
如果不是 git repo，不应导致整个 collect 失败
```

### 8.6 Project Upsert 规则

服务端归并：

```text
有 repoKey:
  upsert Project by repoKey
无 repoKey:
  fallback by workspace/projectName
```

注意：

```text
Project 不再唯一绑定 workspacePath
workspacePath 应改为 UsageEvent.localWorkspacePath
```

## 9. Dashboard 演进

### 9.1 首页

首页继续以 Project 分析为主。

新增/增强指标：

```text
Devices active
Stale devices
Unknown Project tokens
Unknown Model tokens
OpenCode parser status
Last sync by device
```

### 9.2 Device 维度

新增页面或模块：

```text
/devices
```

展示：

```text
Device name
Hostname
Platform
Last seen
Total tokens
Sources
Projects
```

### 9.3 Project 详情页

项目详情页增加：

```text
按设备拆分
按 source 拆分
按模型拆分
按本地 workspacePath 拆分
```

## 10. 分阶段实施计划

### Phase 1：OpenCode SQLite Parser

目标：

```text
让当前本机 OpenCode 597 条真实 token message 进入数据库
```

改动文件：

```text
package.json
src/parsers/opencode.ts
README.md
```

可能新增：

```text
better-sqlite3
@types/better-sqlite3
```

验收标准：

```text
tokenizer diagnose opencode 能显示 opencode.db 和 tokenized message count
tokenizer collect 能采集 opencode events
tokenizer sync 后 Dashboard Sources 出现 opencode
OpenCode token totals 与 SQLite 聚合大致一致
重复 sync 不重复计数
npm run typecheck 通过
npm run build 通过
```

### Phase 2：Device 维度

目标：

```text
支持多台电脑独立采集并上传
```

改动：

```text
新增 Device 表
UsageEvent 增加 deviceId
API batch 接收 device
CLI init 生成 device.json
去重约束升级为 unique(deviceId, source, sourceEventId)
历史 UsageEvent 绑定默认 Local Device
```

验收标准：

```text
tokenizer init --device-name "MacBook Pro" 可写入 device.json
Device 表出现本机设备
UsageEvent 有 deviceId
重复 sync 不重复计数
Dashboard/API 可按 device 统计
```

### Phase 3：Git Remote RepoKey 项目归并

目标：

```text
同一个 Git remote 在不同设备、不同路径下归为同一个 Project
```

改动：

```text
新增 repoKey / gitRemote / gitBranch / gitCommit / localWorkspacePath
实现 git 信息采集
实现 remote 标准化
Project upsert 改为 repoKey 优先
```

验收标准：

```text
同一 git remote 不同 workspacePath 归为同一 Project
Project 表有 repoKey
UsageEvent 保留 localWorkspacePath
Project Ranking 不再因路径不同重复拆分
```

## 11. 风险与注意事项

### 11.1 better-sqlite3 native dependency

风险：

```text
部分环境可能需要编译工具链
```

应对：

```text
如安装失败，可降级为 sqlite3 CLI 或 sqlite npm 包
```

### 11.2 OpenCode schema 变化

风险：

```text
OpenCode 后续版本可能调整 SQLite schema 或 message.data 格式
```

应对：

```text
parser 做 defensive parsing
diagnose 输出版本和表结构摘要
异常行 warning，不中断整体采集
```

### 11.3 Project 归因迁移

风险：

```text
从 workspacePath 切换到 repoKey 会影响已有 Project 统计
```

应对：

```text
分阶段迁移
保留 localWorkspacePath
给已有 Project 尝试补 repoKey
无法补齐的保持原项目
```

### 11.4 多设备重复统计

风险：

```text
同一份日志被复制到另一台设备后，可能作为另一设备事件重复统计
```

判断：

```text
如果确实是复制日志，不是独立使用，理论上会重复
```

短期应对：

```text
按 deviceId 视为不同来源
后续可增加 raw event fingerprint 去重
```

## 12. 已确认决策

```text
1. OpenCode parser 使用 SQLite message 粒度
2. OpenCode sourceEventId = opencode:<message_id>
3. OpenCode 优先读取 ~/.local/share/opencode/opencode.db
4. 设备名称允许手动命名
5. 同一项目跨设备归并以 Git remote 为准
6. 多设备去重最终使用 unique(deviceId, source, sourceEventId)
7. Phase 1 先实现 OpenCode parser，不同时引入 Device/repoKey migration
8. Phase 2 再引入 Device
9. Phase 3 再引入 Git remote repoKey 项目归并
```
