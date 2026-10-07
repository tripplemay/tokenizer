# B04 Agent Release Round 4 独立复验

- 候选：`26607f5e9174656a5fd086dd62e6e106a702de7c`
- fixture 比较基线：`62dba5a77333816d614dcf5f61476f2bf2cc4dd4`
- 前轮独立报告：`8acf5ba28739cb647abccb2344c37361f54bedc9`
- exact-SHA CI：[run 37651552909](https://github.com/tripplemay/tokenizer/actions/runs/37651552909)
- 窄范围 verdict：**PASS_CI_GATE_ONLY**
- B04 Agent 发布：**NOT_READY**

## 总体结论

本轮只修正测试 fixture 的 `NODE_OPTIONS` Windows 路径编码。相对 `62dba5a`，非报告变更只有两个 Windows fixture 测试及一个 test helper；`public/install.ps1`、`public/install.sh`、`src/cli` 和 release manifest 均为零 diff。独立负控复现 raw `C:\...` 在 Node 22 option parser 中丢失反斜杠，修正后的 `/` 路径保留空格和分隔符。

exact SHA `26607f5e...` 的 GitHub run 终态为 `SUCCESS`。原生 Windows 专用 installer fixture 1/1 通过，完整 Windows suite、direct-owner termination gate 和 PowerShell parser 全部通过；因此 Round 3 的 fixture-only CI blocker 已关闭。候选可进入**不部署的候选分支集成**。

这不是 Agent 发布批准。manifest/tag、macOS launchd、真实 Windows Task Scheduler，以及 disk-full/kill/dependency 等破坏性故障矩阵仍是硬门；而且本仓库 `push main` 会触发生产部署，本 verdict 不授权 push main。

## 候选变更真实性

- `tests/fixtures/agent-release-node-options.ts:1-4` 将 test-only preload path 中的 `\` 归一化为 `/`。
- `tests/cli/agent-release-installer-windows.test.ts:28` 只改用该 helper；rollback、queue、credentials、secret redaction、并发锁等断言没有被删除或放宽。
- `tests/cli/agent-release-installer-windows-fixture.test.ts:9-22` 保留显式负控：legacy raw path 的诊断变成 `C:tokenizer fixturefake binmissing-preload.cjs`，修正值保持 `C:/tokenizer fixture/fake bin/missing-preload.cjs`。
- 前轮 `report.md` / `verdict.json` 与 `8acf5ba` 对应 blob 的 SHA-256 完全一致，没有改写历史独立 verdict。

## 原生 Windows 验证

Run `37651552909`：`workflow_dispatch`，head SHA 精确为 `26607f5e9174656a5fd086dd62e6e106a702de7c`，`completed/success`。

| Job / gate | 结果 |
| --- | --- |
| Verify | PASS |
| Verify (Windows) | PASS |
| Verify (PostgreSQL 16) | PASS |
| Verify (authenticated browser) | PASS |
| Deploy | SKIPPED |
| Windows dedicated installer | 1/1 PASS，artifact `success=true` |
| Windows full suite | 119 files passed / 8 skipped；1533 passed / 33 skipped |
| Windows direct-owner termination | PASS |
| `install.ps1` parser | PASS |

两次 Windows fixture 执行均输出 `B04_NATIVE_FIXTURE_OBSERVATIONS`。专用执行的决定性字段为：

```json
{"platform":"win32","node":"v22.23.3","configFailureExit":1,"serviceConfigFailureExit":1,"enrollmentFailureExit":1,"completedUpgradeExit":0,"offlineRollbackExit":0,"activeCommitAfterRollback":"bc70265a879ebddfb89db0de803c373403e9630d","expectedOldCommit":"bc70265a879ebddfb89db0de803c373403e9630d","queueCanaryRetained":true,"credentialCanaryRetained":true}
```

含义及边界：

- configure、service-enabled configure、enroll 均由 PowerShell installer fail-closed 为非零；fixture trace 同时断言底层注入 exit `42` / `55`。
- upgrade 和离线 rollback 均为 `0`，rollback 后 HEAD 与旧 commit 相同。
- 每个 pre-cutover failure 及最终 rollback 都保留 `credentials.json` / `queue.jsonl`；输出不得含 `enroll-secret-canary` 的断言随专用测试原生通过。
- live install lock 竞争拒绝与 separate direct-owner force-termination/stale-lock recovery 均通过。
- 这仍不是实际 Task Scheduler 验收：fixture 在 `tests/cli/agent-release-installer-windows.test.ts:85` 创建 `schtasks.cmd` stub，并用 preload 截获 `install-service`。

## 本地 Node 22 独立结果

- 环境：macOS arm64，Node `v22.22.0`。
- `npm ci`：PASS，671 packages。
- preload parser/real Node fixture：3/3 PASS；单独保存 legacy 负控解析结果。
- 聚焦 8 files：7 passed / 1 native-Windows skipped；26 passed / 1 skipped。
- 全套件：118 files passed / 9 skipped；1543 passed / 23 skipped。
- `npm run verify`、`npm run lint`、`actionlint`：PASS。

本地 POSIX installer 覆盖 manifest/fetch/npm/configure failure、离线 rollback、credential/queue retention、锁与外部 symlink rollback containment；但 macOS 上 Windows fixture 的 skip 不能冒充原生 Windows证据，同样，本地 POSIX 测试也不能冒充 launchd 服务验收。

## 剩余硬门

### [Critical] Immutable release identity 未建立

`src/shared/agent-releases.json:78-81` 仍是 `1.4.0 -> 2074991717abaf3cb34d9aad894bcd4357fefbc3`，不是 B04 候选；`git ls-remote --tags origin 'refs/tags/agent/v*'` 为空。没有 manifest pin 和 immutable `agent/v*` tag，不可发布。

### [High] 两个真实 service manager 未闭环

- 没有 native macOS launchd fresh install / upgrade / failure restore / rollback / restart 证据。
- Windows fixture 使用 `schtasks.cmd` stub，不能证明真实 Task Scheduler 的注册、停止、重启、升级恢复及 rollback 行为。

### [High] 破坏性故障矩阵未闭环

本 fixture-only candidate 没有补充 native disk-full、真实 dependency install failure（现有 npm 失败为 stub exit）、cutover 各阶段 process/host kill 与 restart、Windows reparse-point containment、Linux cron fallback recovery。现有 happy/fail-closed fixture 不能替代这些演练。

## 评分卡（只评价本轮 fixture 修正）

- Correctness：5/5 — 负控直接复现旧解析错误，exact native Windows gate 转绿。
- Regression Risk：5/5 — 产品零 diff，本地与 exact-SHA full suites 通过。
- Security：4/5 — token redaction 与数据保留断言原生执行；真实服务管理器和完整 containment 属发布后续硬门。
- Reliability：4/5 — rollback/lock 原生通过；破坏性 fault injection 尚未完成。
- Performance：N/A — test-only path encoder。
- Maintainability：5/5 — helper 隔离了易错 parser 边界，并有直接回归测试。
- Test Readiness：5/5 — dedicated exact-result gate、完整 Windows suite 与 artifact 均在 exact SHA 上通过。

归一化约 `93/100`，fixture-only correction 等级 **A / Ready**。此分数不评价完整 B04 发布；发布状态仍为 **NOT_READY**。

## 最终判定

- Candidate branch CI readiness：`PASS`
- Fixture-only integration readiness：`READY`
- Push main readiness：`BLOCKED_BY_PRODUCTION_DEPLOY_POLICY_AND_RELEASE_GATES`
- Agent release readiness：`NOT_READY`

本 Evaluator 仅新增本报告及证据；未修改候选产品、`progress.json`、gate/status，未 push、tag、发布或部署。
