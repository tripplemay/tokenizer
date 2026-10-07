# B04 Agent Release Round 3 独立验收报告

- 候选：`62dba5a77333816d614dcf5f61476f2bf2cc4dd4`
- Round 2 基线 verdict：`7b60bb6` 分支中的 `B04-agent-release-evaluator-round2-20261007/verdict.json`
- 原 Round 2 verdict SHA-256：`c21ca1ee368b7fdc13b94cdff8e9031d73975196575c4a8e638fd6e5b44d4678`
- GitHub Actions：[run 37647920920](https://github.com/tripplemay/tokenizer/actions/runs/37647920920)
- 结论：**BLOCK**

## 总体结论

候选修正了静态 CRLF 顺序断言，并增加了一个能拒绝 skip、缺失、重名和失败结果的 Windows CI gate；本地 Node 22 聚焦套件、全套件、类型检查、lint 与 actionlint 均通过。候选提交没有修改 `public/install.ps1`、`public/install.sh`、Agent 产品源码或 release manifest。

但 exact-SHA 原生 Windows run 终态失败。专用 fixture 在 fresh install 的 staging smoke 阶段即失败，未进入 `.cmd` shim、configure/enroll、锁竞争、upgrade、offline rollback、service restore 或凭据/队列断言。因此候选不具备 branch-CI readiness，Round 2 的 native Windows blocker 未关闭；release readiness 继续为 NOT_READY。

## 阻断问题

### [High] B04-R3-001：Windows fixture 的 `NODE_OPTIONS` 路径在原生 Windows 上无效

`tests/cli/agent-release-installer-windows.test.ts:25-29` 将带空格和反斜杠的路径写成：

```text
NODE_OPTIONS=--require="C:\...\tokenizer win-release-...\fake bin\node-preload.cjs"
```

Node 22.23.3 实际解析成不含反斜杠的 `C:UsersRUNNER~1AppDataLocalTemp...`，报 `MODULE_NOT_FOUND`。测试在 `tests/cli/agent-release-installer-windows.test.ts:114` 的 fresh-install `expect(...).toBe(0)` 失败。

这是 **fixture-only quoting defect**，不是已证明的生产安装器故障：

- `NODE_OPTIONS` 仅由测试 helper 注入，生产安装脚本没有设置它。
- 错误发生于 staged checkout 的直接 `node --import tsx ... --help` smoke；尚未执行 `New-CmdShim` 和 cutover。
- 候选提交对两个生产安装器及 `src/cli` 零 diff。
- `install.ps1` 正确把 native exit 1 转为非零失败，并在切换前停止，因此这次失败反而保持了 fail-closed。

影响是验收证据缺失：production-shaped `.cmd` 调用、exit 42/55、token redaction、restore、并发锁、offline rollback、queue/credential retention 均未在该原生 run 中执行。

要求：修正 fixture 的 Windows preload 传递方式，保留带空格路径覆盖，并在 exact fixed SHA 上重跑完整 Windows job。不得仅删除空格、禁用 `NODE_OPTIONS` 拦截或放宽 gate；必须看到精确 fixture 1/1 PASS、完整 Windows suite、owner-force-termination gate 和 PowerShell parser 全部执行成功。

## 未弱化检查

- **失败非零**：测试仍要求 manifest 503、错误 SHA、npm、configure、enroll 和并发失败均非零；独立 Node fixture 要求 configure=42、enroll=55。本轮原生 run 只证明 staging smoke 的 native exit 1 被 PowerShell 正确传播，不能替代其余 native 断言。
- **恢复与数据**：源测试仍对每个 pre-cutover failure 检查旧 HEAD、`credentials.json` 和 `queue.jsonl`，service-enabled configure failure 还要求旧 revision 的 `install-service` trace。原生 run 未到这些分支。
- **token**：源测试仍向 stdout/stderr 注入 enrollment canary 并要求安装器输出不含 canary；原生 run 在 enroll 前失败，故没有新的 Windows token-redaction 实证。
- **rollback/lock**：源测试仍要求 live-lock 拒绝、成功 upgrade、manifest 离线时 rollback 成功以及最终旧 HEAD/凭据/队列保留；原生 run 未到这些分支。
- **CRLF/POSIX 分离**：Windows source-order guard 分别生成 LF/CRLF 输入，使用锚定正则要求 staging 命令存在且早于 stop，并有缺失/提前 stop 负控。POSIX executable fixture 继续在 Windows 上 skip；Windows runtime fixture继续只在 `win32` 执行，CI gate 会拒绝 skip。

## Exact-SHA CI 终态

Run `37647920920`，`workflow_dispatch`，head `62dba5a77333816d614dcf5f61476f2bf2cc4dd4`：

| Job / step | 结果 |
| --- | --- |
| Verify | PASS |
| Verify (PostgreSQL 16) | PASS |
| Verify (authenticated browser) | PASS |
| Verify (Windows) | **FAIL** |
| Windows / Typecheck | PASS |
| Windows / Verify native Windows pinned installer | **FAIL, 1/1** |
| Windows / Run unit tests | SKIPPED |
| Windows / Verify Windows agent owner force termination | SKIPPED |
| Windows / Validate install.ps1 syntax | SKIPPED |
| Deploy | SKIPPED |

## 本地独立结果

- Node `v22.22.0`，`npm ci`：PASS。
- 聚焦 8 files：7 passed / 1 Windows-only skipped；43 passed / 5 skipped。
- 全套件：118 files passed / 9 skipped；1542 passed / 23 skipped。
- `npm run verify`、`npm run lint`、`actionlint`、两个新增 `.mjs/.cjs` syntax：PASS。
- 非 Windows gate 的 8 个负/正控：PASS；它们仅验证 gate 解析，不是 Windows installer 行为证据。

## 发布阻断边界

即使后续 Windows CI 转绿，也不能据此发布 Agent：

1. `src/shared/agent-releases.json` 最高版本仍为 `1.4.0 -> 2074991717abaf3cb34d9aad894bcd4357fefbc3`，不是 B04 候选。
2. 远端现有 candidate branch ref，但 `git ls-remote --tags origin refs/tags/agent/v*` 仍为空；没有不可变 `agent/v*` tag。
3. macOS launchd fresh install/upgrade/rollback 未验证。
4. fixture stub 了 `schtasks`，且 preload 截获 `install-service`；没有真实 Task Scheduler 接受证据。
5. Windows reparse-point containment、原生依赖失败、磁盘不足、cutover 各阶段 kill/restart、Linux cron fallback 等故障矩阵仍未闭合。

## 评分卡

- Correctness：2/5 — 本次目标是修复 native Windows acceptance，但 exact fixture 在第一阶段失败。
- Regression Risk：4/5 — 产品代码零 diff，Linux/PG/browser 与本地全套件通过。
- Security：3/5 — secret 断言未弱化，但 Windows token-redaction 分支未执行。
- Reliability：2/5 — rollback、lock、service restore 和 retained-data 原生矩阵未执行。
- Performance：N/A — CI/test-only 变更，无有意义运行时性能面。
- Maintainability：3/5 — exact-result gate 清晰，但 Windows `NODE_OPTIONS` 引用方式脆弱。
- Test Readiness：1/5 — 必需 native gate 红灯，且后续 Windows gates 被跳过。

相关维度归一化加权约 `53/100`；红线规则适用，最终等级 **D / Not ready**。

## 最终判定

- Candidate branch CI readiness：`BLOCKED_FAILED_EXACT_NATIVE_WINDOWS_GATE`
- Main/merge readiness：`BLOCKED`
- Agent release readiness：`NOT_READY`
- 可接受的下一步：仅修复测试 fixture 的 Windows preload 传递并再次运行非部署 exact-SHA CI；不能降低断言或绕过专用 gate。

本 Evaluator 未修改产品、状态文件或人闸门，未 push，未触发部署或改动本机 Agent 服务。
