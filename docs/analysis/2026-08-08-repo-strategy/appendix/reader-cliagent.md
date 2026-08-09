# tokenizer 本机 Agent CLI 分析报告

## 1) CLI 子命令清单与职责

入口 `src/cli/index.ts`（commander，`program.name("tokenizer")`，index.ts:14-16）。可执行外壳 `bin/tokenizer`：spawn `node --import tsx src/cli/index.ts`，强制 `cwd` 指到安装根以解析捆绑的 tsx（bin/tokenizer:6-13），并向子进程转发 SIGINT/SIGTERM/SIGHUP、保活到子进程退出，防止 launchd 杀掉 wrapper 后留下孤儿 daemon（bin/tokenizer:21-44）。**注意：agent 直接以 TS 源码 + tsx 运行，无编译产物。**

| 子命令 | 职责 | 位置 |
|---|---|---|
| `init` | 生成 `~/.tokenizer/config.json` + `device.json` | index.ts:18-23 |
| `configure` | 改 serverUrl / projectRoot | index.ts:25-29 |
| `enroll` | 一次性 token 换长期 deviceToken，写 `credentials.json` | index.ts:31-35、enroll.ts:25-43 |
| `harness` | 上报编排状态 + 中继签名闸门；`--list` 列项目、`--modes` 模式指纹行、`--status` 只读本地健康快照、`--json` 跑一轮同步输出快照 JSON | index.ts:37-43、harness-command.ts:37-91 |
| `collect` | 五个解析器（claude/codex/opencode/aider/kimicode）采集事件入本地队列 | index.ts:45-53、collect.ts:17-49 |
| `sync` | 队列批量上传后清队列 | index.ts:55-61 |
| `run` | collect+sync+heartbeat+quota+harness 一轮（cron 模式的执行单元） | index.ts:63-66、agent.ts:38-106 |
| `heartbeat` | 单次设备心跳 | index.ts:68-71 |
| `agent` | 前台常驻 daemon（默认心跳 60s、sync 15min） | index.ts:73-75、agent.ts:124-248 |
| `install-service` / `uninstall-service` / `service-status` | 按平台装/卸/查常驻服务 | index.ts:77-87、service.ts:31-208 |
| `status` | 打印 config/device/credentials/queue/state 路径与状态 | index.ts:89-95 |
| `diagnose [source]` | opencode / kimicode 日志目录探测 | index.ts:97-108 |

## 2) 常驻 Agent 生命周期

**安装**（`public/install.sh`，经 `curl -fsSL https://token.vpanel.cc/install.sh | bash` 分发，src/server/agent-version.ts:8-15）：
- 装 Node≥20 / git / 构建工具（install.sh:171-222）→ clone 仓库到 `~/.tokenizer/app` 并 `checkout --force origin/main`（install.sh:231-237）→ `npm ci` → 软链 `~/.local/bin/tokenizer`（install.sh:239-242）→ `init`/`configure`/`enroll`（首装必须 `--enroll-token`；已有凭据则忽略，`--force-enroll` 轮换，install.sh:137-159）→ `install-service` → 若 1 秒后没探测到 daemon（cron fallback 场景）用 nohup 兜底拉起（install.sh:266-278）。
- 升级前先卸服务、再按「wrapper + Node 子进程」双层特征精确停掉旧 agent，TERM→10 秒轮询→重验 PID 后 KILL，防 PID 复用误杀（install.sh:59-133）。

**launchd 常驻**（macOS，service.ts:91-123）：plist `~/Library/LaunchAgents/cc.tokenizer.agent.plist`，`RunAtLoad` + `KeepAlive` + `ThrottleInterval 30`，stdout/stderr 追加到 `~/.tokenizer/logs/agent.log`；把探测到的 node 目录烤进 PATH（resolveLaunchdPath，service.ts:42-65），并将 shell 的 HTTP(S)_PROXY 系列 env 快照进 plist（service.ts:73-100）。Linux 走 systemd user unit（service.ts:125-154），WSL/无 systemd 降级 crontab（**只每 syncMinutes 跑一次 `tokenizer run`**，service.ts:156-169），Windows 走 Task Scheduler + wscript 无窗口启动 + 15 分钟复活触发器（service-windows.ts:1-38）。

**单实例**：`acquireAgentLock`（agent-lock.ts:59-122）——`~/.tokenizer/agent.lock` 记 `{pid, token, startedAt}`，配套 `.coordination` 短锁序列化取放；活 PID 判定用 `kill(pid,0)` 且 EPERM 视为活（agent-lock.ts:34-43）；崩溃残留锁仅在 PID 已死时回收。daemon 主循环是 5 秒 tick 轮询墙钟而非 setInterval，睡眠唤醒 ~5s 内补跑（agent.ts:181-238）。

**升级提示**：双轨机制。
- 能力版本 `AGENT_FEATURE_VERSION = 9` / `MIN_AGENT_FEATURE_VERSION = 9`（src/shared/agent-feature-version.ts:50-51，附 1→9 完整变更史，同文件 19-49 行注释）；随每次 heartbeat 的 `device.diagnostics` 上行（sync.ts:116-123）。
- 发布版本 SemVer 账本 `src/shared/agent-release-version.ts`（读 `agent-releases.json`，模块加载时缓存，旧 daemon 报启动时版本而非磁盘版本，第 27-30 行注释）。
- 服务端 `deviceAgentUpdateStatus`（src/server/agent-version.ts:54-66）：feature 低于阈值或 release 落后 → `upgrade-required`，在 web 控制台聚合展示（getAgentUpdateSummary，同文件 76-95）并给出安装命令。heartbeat 路由还做**单调 reporter 接受**：版本比已存记录旧的心跳被拒，防升级后残留旧 daemon 覆盖新诊断（app/api/devices/heartbeat/route.ts:32-52）。
- 升级本身 = 重跑 install.sh（git fetch + checkout），无自更新通道。

**卸载**：`uninstall-service`（service.ts:171-194）删 plist/systemd unit/crontab 行；**不删** `~/.tokenizer/`（凭据、队列、state）、`~/.tokenizer/app` checkout 和 `~/.local/bin/tokenizer` 软链——无完整卸载器。

## 3) Harness 上报与闸门中继

纯**轮询**（无推送通道）。一轮 `runHarnessSync`（harness.ts:640-693）串行三步，互不阻塞（任一步 catch 后另两步照跑）：

1. **上报**（reportHarnessState，harness.ts:326-395）：`discoverHarnessRepos` 在 projectRoots 下扫**一层**子目录，判据 = 同时存在 `progress.json` + `harness-rules.md`，repoKey = 归一化 git remote 或 `local:sha256:<路径哈希>`（harness.ts:150-186）。载荷含 status/batch/fixRounds/features/headSha/signoff/dashboardUrl/autonomy/模式指纹快照/modeDefaults/modeIntent + 仅未决策的 pending_gate + 有界 dispatchRuns（buildReport，harness.ts:206-284）。单项目失败不中断其余（harness.ts:343-393 注释明示原因）。
2. **模式意图中继**（applyHarnessModeIntents，harness.ts:416-480）：拉签名 intent → `stageHarnessModeIntent` 验 Ed25519 签名、schema、repo_key 三方一致、`expected_head_sha` 匹配 HEAD、harness.json 干净，然后原子写 `harness.json.mode_defaults` 并单文件 commit，失败路径逐级回滚（harness-mode-intents.ts:311-454）→ 回 ACK staged/failed；commit 返回但验证不到提交 SHA 时进 `ack_pending`，推迟到精确重试（442-447）。
3. **闸门中继**（applyHarnessDecisions，harness.ts:526-605）：GET 已签名决策 → 逐条守门：repoKey **精确匹配**（不做别名归一，549-558）、多仓同 key 拒写、`.claude/console/console.pub` Ed25519 验签（与服务端共用同一 `canonicalJson`，verifyDecision 500-515，签名无效**宁卡不写**）、progress.json 无未提交改动、pending_gate 存在且 id 一致且无已有 decision → 原子写 + 只 `git add -- progress.json` 单文件 commit（592-598）。

**频率**：daemon 模式下 harness 独立节拍 `HARNESS_MS = 60_000`，单飞防叠加（agent.ts:189-225，注释明确这是「人批准后机器拿到」的体感上限）；`runOnce`（cron 模式）在 sync 尾部非致命附带跑一次（agent.ts:94-98）→ **cron fallback 主机的闸门延迟 = syncMinutes（默认 15 分钟）**。

**失败处理**：单请求 30s 超时（harness.ts:49）；HTTP 408/429/5xx 与网络错误分类为 retryable（harness.ts:87-119），靠下一 tick 自然重试（服务端幂等），无指数退避；issues 有界（`HARNESS_SYNC_ISSUE_LIMIT` 截断，harness.ts:662），健康快照 `success/degraded/failed/idle` 写入 `state.json.harness`（harness.ts:663-678）并随下次 heartbeat diagnostics 上行（sync.ts:110,122）；日志用 issue 指纹去重，仅变化时打详情（harness.ts:628-634、agent.ts:19-32）。

## 4) 与服务端的 API 契约

鉴权基座：`POST /api/devices/enroll` 用一次性 enrollToken 换 `deviceToken`（enroll.ts:34-41，**无** Bearer）；此后所有端点 `authorization: Bearer <deviceToken>`，凭据存 `~/.tokenizer/credentials.json` 并尽力 0600（config.ts:115-123）。harness 类端点额外带两个身份头 `x-tokenizer-agent-release-version` / `x-tokenizer-agent-feature-version`（src/shared/harness-relay-identity.ts:3-4，harness.ts:51-58），服务端据此拒绝陈旧 reporter 的控制面写入（feature≥9 强制，agent-feature-version.ts:67-71）。

| 端点 | 方向/方法 | 用途 | 客户端位置 |
|---|---|---|---|
| `/api/devices/enroll` | POST | 注册换 deviceToken | enroll.ts:34 |
| `/api/devices/heartbeat` | POST | 存活 + diagnostics（版本、queueDepth、lastError、harness 快照）+ timezone | sync.ts:130-146 |
| `/api/usage/events/batch` | POST | 用量事件，批 200 条、60s 超时、批间重试 5s/15s（服务端 skipDuplicates 幂等） | sync.ts:28-84 |
| `/api/quota/snapshots/batch` | POST | 配额快照 | src/quota/sync.ts:14-23 |
| `/api/harness/report` | POST | 编排状态镜像，响应回 `harnessProjectId` | harness.ts:352-365 |
| `/api/harness/decisions` | GET | 拉已签名闸门决策（服务端只下发 `decisionSig` 非空且未 consumed 的，标 relayedAt；consumedAt 由后续 report 回收，app/api/harness/decisions/route.ts:33-66） | harness.ts:530 |
| `/api/harness/mode-intents/relay` | GET/POST | GET 拉签名 mode intent（issued→relayed 状态机 + 过期回收，relay/route.ts:31-68）；POST 回 ACK staged/applied/failed | harness.ts:310-317、420 |

## 5) 成熟度与短板

**成熟面**：原子写 + 文件锁贯穿本地状态（atomic-file.ts、updateState config.ts:144-161）；单实例锁含 PID 复活/EPERM 边界（agent-lock.ts）；睡眠感知 tick 调度（agent.ts:181-187）；direct/proxy 双通道自愈 fetch（fetch.ts:45-63）；闸门/模式意图全程 Ed25519 验签 fail-closed 且与服务端共用 canonicalJson 防实现漂移（harness.ts:494-515）；四平台服务后端各有针对性 KeepAlive 设计（service-windows.ts 头注释尤其详尽）;版本双轨 + 服务端单调接受防旧 daemon 回写；测试厚实（tests/cli/ 18 个文件，harness.test.ts 643 行、harness-mode-intents.test.ts 436 行、harness-tool-catalog.test.ts 1304 行，含 install-agent-lifecycle.test.ts 对 install.sh 进程治理的测试）。

**短板**：
1. **纯轮询、无推送**：daemon 模式闸门延迟上限 60s 尚可，但 **cron fallback（WSL 等）下闸门/模式意图只随 `tokenizer run` 每 15 分钟走一次**（service.ts:156-169 + agent.ts:94-98），人批准后机器最长干等一个 sync 周期。
2. **升级链路 = 追 main HEAD**：install.sh:233 `checkout --force origin/main`，非 tag/锁定版本；curl|bash + GitHub 依赖构成供应链单点，无签名校验。
3. **无完整卸载**：`uninstall-service` 不清 `~/.tokenizer` 数据、app checkout、软链、凭据（service.ts:171-194）。
4. **凭据形态弱**：单一静态 deviceToken 明文 JSON 落盘（仅尽力 0600），轮换只能人工 `--force-enroll`；enroll 请求用全局 `fetch` 而非自愈的 `agentFetch`（enroll.ts:34），代理环境下首装可能失败而常驻期正常，行为不一致。
5. **重试策略粗**：harness 轮询固定 60s 无退避/抖动；不可重试 issue 也会每 tick 重撞一次（只有日志指纹去重，无请求侧抑制）。
6. **发现机制受限**：harness 项目只扫 projectRoots 一层子目录（harness.ts:149 注释承认为权衡），更深的项目布局静默漏报。
7. **tsx 源码运行**：每次启动付解释/转译开销，且运行正确性依赖安装机 `npm ci` 成功——无预构建产物或完整性校验。
8. 代理端口变更需重装 service 才能感知（fetch.ts:16-20 注释自认，已知未修）。