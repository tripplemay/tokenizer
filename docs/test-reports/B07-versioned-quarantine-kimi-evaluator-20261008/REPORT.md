# B06+B07 client flow 独立正式技术验收（异家族 Evaluator）— 2026-10-08

## 裁决：技术验收 PASS（附 limitations）；release_ready = false

- 候选 exact SHA：`541287603bf3ee41d1d86adde8328d2f9b3ae437`（验收全程 HEAD 未变）
- 基线对照 SHA：`4979042e3cf8d2c5f06ed5de13372e49d0bab855`
- 角色：Kimi 模型家族独立 Evaluator；非本候选 Generator；未信任任何 Generator/同家族
  prereview 结论，所有结论以源码 + 本报告所附原始运行输出重新取证。
- 同家族 prereview（`docs/test-reports/B07-queue-prereview-20261008/`，verdict BLOCK）
  仅作为「待复核声明清单」使用：其 Q-01（版本化隔离丢失）与 Q-02（Windows CRLF）
  两项发现均被本验收**独立复现于基线**、并验证**在候选上修复**。
- 本验收为技术验收，不等于发布批准。发布仍需人闸门与正常发布/部署流程。

## 边界与合规事实

- 仓库无 remote（`git remote -v` 为空）；未 push、未触发任何 workflow、未 commit。
- 未修改产品代码/配置/历史 tests/历史报告/progress/status/gate；`git status` 最终仅剩
  本报告目录为未跟踪项（`next dev` 对 `AGENTS.md`、`next-env.d.ts` 的副作用已还原）。
- 全部临时环境在 /tmp：fresh PG16.13 实例（initdb 于 /tmp/b07-eval/pgdata，已停）、
  HOME 隔离目录、worktree 基线对照（已移除）。
- 运行环境：Node v22.22.0（nvm 真实 22，非系统 Node25）、PostgreSQL 16.13、
  macOS arm64、真实 `next dev` HTTP 服务 + 真实 PG16 + native 子进程。
  见 `evidence/local-runtime.json.txt`。

## CI 只读核对（gh -R tripplemay/tokenizer，未触发/未推送）

run `37672224127`（workflow_dispatch）：`headSha=541287603bf3ee41d1d86adde8328d2f9b3ae437`
与本地 HEAD 完全一致；Verify / Verify (Windows) / Verify (PostgreSQL 16) /
Verify (authenticated browser) 全部 success；**Deploy = skipped**。
原始 JSON：`evidence/gh-run-37672224127.json`。

## 独立负控与实测结果（全部为自研探针，非候选自带 tests）

### 1. Server partial row admission（真实 PG16 + HTTP，20/20 PASS）
`evidence/probe-server-partial-admission.log`
- 3 行批（好/坏 source/好）→ 200：`accepted`=[行0,行2] 带 source+sourceEventId，
  `rejected`=[{row:1,invalid_event}]，`received`=2；DB 仅落 2 行好事件，坏行缺席。
- 全拒批 → 200 accepted=[] rejected=2；user.timezone、device.lastSyncAt、事件表
  全部零写入（前后值逐字节相等）。
- 空批（partial 头）→ 保留 heartbeat：lastSyncAt 实际更新。
- legacy（无头）同批坏行 → 整批 400 `{code:invalid_event,row:1}`，好行不落库。
- partial 头下 envelope 失败仍为整请求 400（invalid_timezone）；设备不符 403；
  无 token/假 token 401；201 行 → batch_too_large。
- 结构层毒行定位（转义 NUL / 孤立代理项 / 行内 35 层嵌套）：partial 头 →
  `400 {code:invalid_json,row:1}`；legacy → 同毒行 rowless `invalid_json`。
  无法解析的字节流（含裸控制字符）→ 两种头均 rowless 400（安全 400，非路由异常）。

### 2. Wire/HTTP 错误分类与 ACK ID/版本校验（16/16 PASS）
`evidence/probe-ack-validation.log`（stub server 控制 wire，独立 HOME 逐例隔离）
- 伪造 ACK（改 sourceEventId / 改 source）、缺行不完全分区、重复行、越界行、
  received≠accepted 数、协议字串不符 → 客户端全部 fail-closed 抛错；
  **请求恰 1 次（不重试伪造 ACK）、queue 字节不变、零隔离**。
- legacy 无 partial 字段 200 → 整批 ACK，queue 排空，计数聚合正确。
- 401/403 → 各 1 次请求即抛（不进 5s/15s 重试，实测 <4s），queue 不变。
- 503 → 恰 3 次尝试，实测 wall=20061ms（5s+15s 真实 backoff），queue 不变。
- 旧 B06 兼容（400+行号，invalid_event 与 row-located invalid_json 两例）→
  毒行隔离一次、好邻居立即无 backoff 重试成功、第 2 请求确不含毒行、rejected=1。
- rowless invalid_event / invalid_batch → 非按行兼容响应：抛错、queue 不变、零隔离。

### 3. Two-process exact-version queue merge/ACK（PASS）
`evidence/probe-twoprocess.log`：两个 native 进程共享 HOME，40 轮竞速
（collector 先入旧版本、同步中再入同 ID 修正版；syncer ACK 旧版本）：
- 40/40 修正版在旧版本 ACK 后存活；旧版本全部 ACK 清零；
- 80 个各自事件零丢失零重复；queue 始终可解析；无 .tmp/.steal 残留、无遗留锁。

### 4. Versioned quarantine（PASS；基线 FAIL 对照成立）
`evidence/probe-quarantine-version.log`（HEAD）/ `evidence/baseline-4979042-quarantine.log`
- 旧版本被拒入隔离 → 修正版同 ID 再入队；修正版再被拒 → **隔离区同时保留
  old+corrected 两行**（基线仅保留 old，修正版从 queue 移除却未入隔离 = 静默丢失，
  基线 FAIL 复现 prereview Q-01）。
- 完全相同拒绝重放 → 隔离文件字节不变（exact retry dedupe）。
- 对旧版本的 ACK 不删除同 ID 修正版（版本键 ACK）。

### 5. 文件权限与最小化（PASS）
`evidence/probe-privacy-perms.log`
- queue.jsonl / rejected-usage.jsonl = 0600；产品自建 ~/.tokenizer = 0700。
- 预存 755 目录不被 chmod（atomic-file 设计注释「不对既有目录产生副作用」）；
  文件内容仍 0600 保护 —— 记录为观察项 F-01，非回归。
- gitRemote 凭据剥除（`https://oauth2:secret@…` → `https://github.com/…`）；
  repoKey 同样去 userinfo（remote 派生 identity 优先，符合 sanitize 语义）；
  不可解析 remote → null；非 codex rawJson 整体丢弃；未知附加字段不持久化；
  codex rawJson 仅保留六个累计计数器；隔离文件无源文本/凭据/调试字段。

### 6. quarantine→active 写故障/崩溃一致性（PASS）
`evidence/probe-quarantine-version.log` §7-8、`evidence/probe-crashkill.log`
- chflags uchg 注入 checkpoint 失败（rename EPERM）：解析抛错；**隔离已在失败前
  提交且仅一行；active queue 全量保留**；解锁后重放幂等收敛、隔离不重复。
- 25 轮 SIGKILL 随机点杀 native 子进程：两文件始终可解析、事件不丢失不重复、
  无 .tmp 残留；最终收敛 queue=0 / quarantine=25。
- 隔离文件损坏 → 解析 fail-closed 抛错，active queue 字节不变（不覆盖损坏隔离）。

### 7. 旧 B06 rowless invalid_json fallback（PASS）
`evidence/probe-rowless-fallback.log`
- 毒行批：请求序列实测 `3,2,1,2,1,0,1` —— 二分收窄、好行先行 ACK、
  恰一次空批探针证明单行毒 → 仅毒行隔离（code=invalid_json），好邻居零隔离、
  全部上传，queue 排空，无 transient backoff。
- 全局失败（连空批也 400）→ 原错浮现、**零隔离、3 行全部保留 active** ——
  好邻居与全局失败被明确区分。

### 8. B03 local-only→sync backlog（PASS）
`evidence/probe-b03-backlog.log`、`evidence/probe-cli-status.log`
- local-only 采集入 durable queue；syncEvents 被 privacy mode 拒绝且 0 网络请求。
- configure(sync) 自身 0 网络请求、不动 backlog；状态文案披露「下次 cycle 自动上传」。
- exclude 规则编辑不删除已准入 backlog；下一 sync cycle 原样上传全部 3 条。
- 真实 CLI `tokenizer status`：隔离区路径+条数（25 events; manual repair/replay
  required）、损坏隔离区 unreadable/fail-closed 披露、local-only backlog 文案均正确。

### 9. 隐私与资源边界（PASS）
`evidence/probe-resource-bounds.log`
- 实际 1,048,745 字节 body → body_too_large；chunked 无 Content-Length 流式
  1.1MB → 字节计数截断 body_too_large，服务存活；
- 声明超长 Content-Length → 早期 body_too_large；text/plain → invalid_content_type；
  截断 JSON / 非法 UTF-8 → 安全 400 invalid_json；虚假小 Content-Length 连接被
  复位后服务存活（401 探针复验）。

## 候选自带 gates 复跑

- L1 本机全绿：`npm run lint`=0、`npm run verify`（tsc）=0、`npm run test`
  **130 files / 1690 tests 全过**（11 files/27 tests 为环境门控跳过）。
  `evidence/l1-local.log`
- 真实 PG16 DB probes（EVAL_B06/B07_DB_URL + _scratch 库）：b06-batch-db 3/3、
  b06-partial-ack-db 1/1、b07-queue-id-ack-db 1/1 全过。`evidence/db-probes-pg16.log`

## Windows archive 取证（Q-02 复核）

- 三份历史 B06 evaluator 测试 blob 自引入起全仓库仅 1 次提交、与基线 blob 完全一致
  （字节未变）；pinned sha256 `fb406333…` 与 blob/工作树一致。
- effective .gitattributes：`git check-attr text` 三份均为 `unset`（HEAD），
  基线为 `unspecified`。
- core.autocrlf=true 检出模拟（/tmp 双 clone，git 属性/EOL 代码路径与 Windows 相同）：
  **HEAD 三份工作树字节 == blob（CR=0，SHA-PASS）；基线三份全部被 CRLF 改写
  （CR=31/212/29，pinned SHA-FAIL）**。`evidence/windows-archive-autocrlf-probe.log`
- 原生 Windows 非本机执行：以 run 37672224127 的 Verify (Windows) success（同 SHA）为
  原生证据；本机模拟不冒充原生 Windows。

## Limitations（不虚称通过）

1. **原生 Windows 未由本 Evaluator 执行**：CRLF/属性证据为本机 git 模拟 + 字节核对；
   原生覆盖面仅来自同 SHA 的 CI Verify (Windows)。
2. **无断电/fsync 级崩溃证明**：已做 SIGKILL 25 轮与 rename 故障注入；物理断电恰好
   落在 quarantine rename 与 queue rename 之间的窗口无法在进程内诚实复现。
3. 认证浏览器 E2E 未在本机复跑（CI Verify (authenticated browser) 同 SHA success）。
4. 429 的退避未单独计时（与 503 共用 retryable() 路径，503 已实测 20s 真实退避）。
5. 全拒批的 cache/pricing 零副作用由路由代码路径确认（无 accepted → 不触发
   invalidate/trigger），未单独做故障注入。
6. quota snapshots 端点属 B06 有界校验范围，本验收聚焦 usage 客户端流；quota 路径
   由候选自带 tests（全量 vitest 含）与既往 B06 验收覆盖。
7. macOS 单平台原生运行；Linux/Windows agent 生命周期未在本机执行。

## 观察项（非阻塞）

- F-01：既有 `~/.tokenizer` 目录权限不被修改（设计如此）；若目录先由 config 写入
  以 0755 创建，queue/quarantine 文件仍为 0600，目录本身保持 0755（文件名可枚举，
  内容不可读）。产品自建目录为 0700。

## 证据清单

`evidence/`：上述全部原始日志 + `probes/`（独立负控脚本源码，可复现）+
`gh-run-37672224127.json` + `local-runtime.json.txt`。
