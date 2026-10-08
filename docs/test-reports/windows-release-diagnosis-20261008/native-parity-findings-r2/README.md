# 第二轮原生 Windows 运行事实与最小后续提案

本报告是 `harness-rules.md` §1.5 的支持性只读诊断，不是 Evaluator 验收、Generator 修复、F005 结论或 release verdict。`release_ready=false`。

## 结果

- 原始 run `37822555762` 的 workflow `SUCCESS` 与 CLI `exit_code=0` 表示诊断完整执行并记录了拒绝，**不表示 Windows 产品测试通过**。
- 10 个 P0 固定 marker 全部完成；10 个 P1 固定 synthetic `ConvertFrom-Json '[1,2]'` 全部在配置的 7 秒原生子进程 deadline 后返回 `BoundedSubprocessTimeoutError`。
- 全部 10 个 P2 未调用，`selectedArms={}`；parent、confirmation、binding、healthy 的 off/on 共 8 个 downstream root 均未启动。
- 本轮没有证据定位 P1 内部究竟停在 cmdlet 查找、模块自动加载、初始化还是 JSON 转换；不能据此选择产品改动。

## 来源与冻结边界

实际 CI 执行 ref 与开始检查时 HEAD 为 `719c2df0d54f62b1b3b3e711a2045ffd8ea5e711`，与下载的 CI metadata、checkout log、provenance 一致。报告期间 Coordinator 归档原始证据后 HEAD 变为 `56a326dab9b44da8cd5ca27e16148092a9e518a6`；离线 diff 仅见 docs/evidence，且 CLI、trace preload、三个 inspected product 文件和 workflow 与 CI ref 的 SHA-256 完全相同。**不声称 56a326d 执行过 native run。**

报告绑定 57 个上传原始文件和 2 个 CI metadata/log 文件，共 59 个文件、121007 bytes；所有 SHA-256 在 `original-sha256.json`，没有覆盖原件。后来归档的 watch log 不用于推断原生行为，未纳入这份限定 inventory。

- 上传原件：`docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/windows-release-diagnostics-719c2df0d54f62b1b3b3e711a2045ffd8ea5e711/`
- 原始日志/元数据：`docs/test-reports/windows-native-ci-20261008/runtime-parity-ci-37822555762-original.{log,json}`
- 原生记录：上传原件下 `windows-release-diagnosis-20261008/native-output-parity-1791483248698/`，55 个 JSON/JSONL 文件。
- Windows Server 2025 Datacenter `10.0.26100`，runner image `windows-2025-vs2026` / `20260925.250.1`；Node `v22.23.3`，libuv `1.51.0`，`win32 x64`，Git `2.55.0.windows.5`。PowerShell 版本未记录。
- 当前诊断 CLI SHA-256：`1030e91a2ea4dc2a9e81e876aa391ad19e401fb42c07d91435804d2da6f2603c`，与当前 Git HEAD 相同。provenance 的 `source_freeze_head=7c6936b97a54f13d1ceb3272f810cf51d28a34f1` **不是该新增 CLI 的内容身份**：该 ref 尚无此文件。
- `src/cli/bounded-subprocess.ts`、`src/cli/bounded-subprocess-worker.mjs`、`src/cli/replay.ts` 当前字节均与 Git HEAD、上述 source freeze 及失败发布基线 `76d916ba2e3a7147acda5ac9ef15fa70a9cd9958` 相同。具体哈希在 `analysis.json`。

这些是本地下载字节与捕获日志的关联检查，不是远端签名证明或完整运行时源码 attestation。

## 每组实际可达性

每组都有 common budget/lifetime guard；`off` 仅关闭旧 trace preload，不是无 instrumentation 的原始 CI。E0 是剥离环境；E1–E4 各只改一个获准 key，不是原始 CI environment parity。

| old trace | arm / 相对 E0 的变量 | P0 完成 ms | P1 timeout 返回 ms | P2 | downstream admission |
|---|---|---:|---:|---|---|
| off | E0 / 无 | 313.890 | 7183.334 | 未到 | 无 |
| off | E1 / SystemDrive | 274.417 | 7190.429 | 未到 | 无 |
| off | E2 / synthetic APPDATA | 299.250 | 7183.975 | 未到 | 无 |
| off | E3 / synthetic LOCALAPPDATA | 263.617 | 7184.415 | 未到 | 无 |
| off | E4 / builtin-only PSModulePath | 278.304 | 7187.576 | 未到 | 无 |
| on | E0 / 无 | 299.806 | 7193.061 | 未到 | 无 |
| on | E1 / SystemDrive | 285.404 | 7184.113 | 未到 | 无 |
| on | E2 / synthetic APPDATA | 273.912 | 7182.766 | 未到 | 无 |
| on | E3 / synthetic LOCALAPPDATA | 276.110 | 7193.561 | 未到 | 无 |
| on | E4 / builtin-only PSModulePath | 278.880 | 7185.040 | 未到 | 无 |

P0 每组 status 0 / signal null、21 bytes stdout、0 bytes stderr、固定 marker 匹配。P1 返回耗时包括 worker 启动与终止/响应开销，不能把 7182–7194 ms 称为 JSON 转换耗时。

## 原始记录与源码如何闭环

1. `native-runtime-parity.mjs:596-609` 将 P0/P1/P2 各自交给冻结的 bounded worker，原生 timeout 为 7000 ms。P1 捕获失败后 `previous=false`，P2 记录 `previous-smoke-did-not-complete`。
2. 10 份原始 guard 各 14 events：P0 PowerShell close status 0；随后 P1 PowerShell 启动，约 6998–7011 ms 后启动 owned `taskkill.exe`；taskkill close status 0；P1 PowerShell close status 1。该 status 1 出现在强制终止之后，不能当作 timeout 前的脚本错误。
3. 5 份原始 trace-on 各 34 events，冻结 worker 的 `workerKind` 均按次序为 `ok`、`timeout`；P1 没有 stdout/stderr byte event。`bounded-subprocess.ts:101` 将 `timeout` 转为原始记录中的 `BoundedSubprocessTimeoutError`。
4. `bounded-subprocess-worker.mjs:52-57,70` 的 timer 触发 `finish(timeout)`；若 owned cleanup 失败，结果会替换为 `supervision`。本轮 trace-on 实际记录的是 `timeout`，不能归因为 taskkill 失败。
5. `native-runtime-parity.mjs:507-510` 的 diagnostic completion 判断的是协议/观测/健康/清理完整性，允许 P1 本身失败；`:536` 另以 `p2Succeeded && diagnosticCompleted` 决定 downstream 入场。故完整记录 10 次 timeout 可以令 CLI exit 0，却没有任何 P2/downstream。
6. P2 literal 与 `src/cli/replay.ts:150` 相同，但从未调用。全部 8 个 downstream 文件都有 `rootProcessStarted=false` 与 `no-complete-P2-success-arm`，不只是断言没通过。

## 计数、trace、清理与 canary 的核对及限制

- 独立解析 140 guard events、170 trace events；每个 PID sequence 连续，guard preload PID 集与 health expected/complete PID 集一致。共 30 个 guard complete 状态，trace-on 共 15 个 trace complete 状态；published guard/trace bytes 与文件长度一致。无 guard budget abort、child-error、owned-lifetime-expired；无 evidence suppression/overflow。
- 20 条 counter 全为 `powershell-admission/smoke`，与 20 次 PowerShell spawn 一致；10 次 taskkill，0 次 downstream admission，远低于既定 38/76 launch cap。没有执行 combined arm。
- 10 份 cleanup 原始记录的两次 observed-PID liveness 均为空、`cleanupUnknown=false`、`rootRetained=false`，summary retainedRoots 为空。核对的是捕获记录的一致性，**不是重新检查远端进程/目录**。健康汇总背后的逐 PID health 原文件没有单独上传；PID 抽样不证明整个树不存在。
- root bounded-output canary flags 全 false、scan complete、stderr 0、无 output overflow；55 个 native-output 文件中无已知 synthetic canary literal。该覆盖仅限诊断 root 所捕获输出。timeout worker 不保留 native 原始 stdout/stderr，因此不能把 canary booleans 等同于 P1 内部数据流或未执行的 queue/privacy 验收。
- E4 仅为 `SystemRoot/System32/WindowsPowerShell/v1.0/Modules`，不代表完整 machine module search path，更不是个人路径。单次有序 off/on 环境观察不足以作完整因果判断。

原始 aggregate 5 秒失败、parent rename/mkdir/hardlink、confirmation/binding 拒绝、healthy queue/admission 以及历史 taskkill 问题均不能由本轮不可达断言归因或结案。

## 下一步：仅提案，必须新范围授权

最小下一项先停留在 **P1 最早不确定阶段**：申请新的明确窄范围，在一个 E0 / old-trace-on / common-guard-on 的 P1-only 诊断中，以 owned synthetic 记录保存固定阶段编号：cmdlet resolution 前、resolution/module ready 后、同一个固定 JSON 转换后；即使冻结 worker 返回 timeout，也只保留固定阶段/耗时/allowlisted error code，不导出 raw env、个人 module path 或 native stderr。

先不运行 P2/downstream；不改冻结产品 worker/replay；保留 7 秒 native、10 秒 operation、16 KiB native output 和原有 lifetime/cleanup/global bounds。若阶段证据指向 module loading，再单独提议一个 machine-only 的 cmdlet/module refinement，例如明确解析/导入获准 builtin utility module；它仍只是待审假设，不是产品修复。

**任何新 recorder、当前诊断脚本变化、cmdlet/import refinement、extra arm/key、combined env、额外 native 运行或 time-budget 变化都须新的明确 scope；本报告未实现或执行。** 不放宽旧测试 timeout，不据诊断 SUCCESS 宣称发布门通过。

## 产物及离线复核

- `analysis.json`：每组 PID/trace/计数/可达性、事实与推断、缺口、提案。
- `original-sha256.json`：59 个原始 artifact/meta/log 文件的路径、长度、SHA-256。仅绑定下载字节，不作远端真实性证明。
- 报告作者本次仅新增上述两个文件与本 README；未运行 native CLI、未 network/GH/SSH/生产操作、未改状态机/产品/旧报告/测试/workflow、未 commit/push。Coordinator 同期的证据归档不是报告作者操作。

离线只读校验原件哈希：

```sh
node -e 'const fs=require("fs"),c=require("crypto"),a=JSON.parse(fs.readFileSync("docs/test-reports/windows-release-diagnosis-20261008/native-parity-findings-r2/original-sha256.json"));for(const x of a.files){const b=fs.readFileSync(x.path);if(b.length!==x.bytes||c.createHash("sha256").update(b).digest("hex")!==x.sha256)throw Error(x.path)}console.log(a.file_count+" original files unchanged")'
```
