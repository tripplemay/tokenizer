# Windows queue worker 失败事实诊断 r1

本报告为 harness §1.5 独立只读事实诊断，不是功能 Evaluator，不评估修复质量、feature 验收或发布就绪。仅写本目录；未改产品、旧测试、timeout、assertion、状态机、原日志、main、生产或远端。未重试 CI。报告专用 worktree 从精确候选 `f754423387374afee0671f951730cac43bad7891` 创建。

## 结论

已定位到 **测试父进程的 `exit` 非零或 null 分支，将当时空的 stderr 转成空 Error，丢失决定性子进程退出信息**。尚不能定位失败 child 到达了哪一层，更不能据此判定 queue loss、flake 或修复引入回归。

特别澄清：这里不是 `child.on("close")`，原测试没有 close 观测。原日志中整个 unit step 的 `exit code 1` 不能当作某个 writer 的退出码。

## 精确 run -> Error -> lifecycle

下列新旧日志在本目录均为原文件逐字节副本，行号未变；原路径和 SHA256 见 `provenance.json`。

| 边界 | 原始证据 | 可以确认 |
| --- | --- | --- |
| run/job/source | `repair-ci-37813254244-completed-original.json:1`；`repair-ci-37813254244-windows-job-original.log:80-94` | run `37813254244` / Windows job `113518921402`，checkout HEAD 为 `f754423...`，unit step failure |
| native 环境 | 新日志 `10-19, 103-109` | Windows Server 2025，image `windows-2025-vs2026 20260925.250.1`，Node `v22.23.3` |
| 失败用例 | 新日志 `543-545` | `eight simultaneous native writers...` 失败，Vitest 报告耗时 286ms；同文件前一个顺序 quarantine 用例通过 |
| 空 Error | 新日志 `698-717`，重复 annotation `790-808` | `message: ''`，构造位置 `tests/cli/b07-prereview-process.test.ts:29:167`，stack 经 `ChildProcess.emit` / `_handle.onexit` |
| unit step 退出 | 新日志 `836` | 整个 npm/Vitest step exit 1；不是失败 child code |

精确候选源码：

- `tests/cli/b07-prereview-process.test.ts:25-30` 为 8 个独立 Promise 调用 `spawn(process.execPath, ["--import", "tsx", worker, "merge", payload])`，fixture 的 `HOME` 和 `USERPROFILE` 指向同一个临时 home。stdin 忽略、stdout/stderr 为 pipe。
- `:28` 仅累计 stderr，8s timer 的独立 Error 文本是 `worker timeout`。
- `:29` 监听 `error` 和 **`exit`**；`exit` 只接收 `code`，`code === 0` 才 resolve，否则 `reject(new Error(stderr))`。没有记录 code、signal、PID、writer index；没有 stdout 消费或 close-complete 缓冲。
- 因而运行时 stack 与候选源码共同支持：**至少一个 Promise 通过该 exit 分支拒绝，`code === 0` 为 false，构造时 stderr 变量为空**。不能还原 code 为数值多少还是 null、signal 是什么、或 close 时 stderr 是否仍为空。
- 这不是已报告的 8s worker timeout，也不是 Vitest timeout 或 `:31` 的队列内容断言失败。286ms 是 Vitest 用例总耗时，不是某个 child 的精确寿命，更不能仅靠它建立根因。
- `:31-35` 的 read/8 版本/ACK/后续 reject/权限断言位于 `await Promise.all(...)` 之后。此次 rejection 没有执行这些步骤；不存在失败时的队列计数或 missing-version 证据。Windows 分支本就跳过 `:34` 的 POSIX mode 断言，标题中的 owner-only 不能补充 Windows ACL 实测。
- `:36` finally 删除临时 home；该路径没有 allSettled、peer kill/join 或保留失败 fixture。源码允许其他 child 尚未结束时 cleanup 与 writer 重叠。**这只是可发生的二次扰动边界，不是本次首个 failure 的已证实原因。**

## 最早不确定边界与 queue primitive 静态追踪

**最早未观测边界：父进程 `spawn` 到 Node `--import tsx` / 模块加载 / fixture 操作入口。** 现有日志没有失败 writer 的启动、import 完成、operation-entry 或 queue-stage 标记；即使 exit handler 已运行，也不能证明它执行了 `mergeQueueEvents`。不要先从 queue lock/ACL/rename 猜起。

若 worker 正常进入，候选源码的路径是：

1. `tests/fixtures/b07-prereview-worker.ts:1-7` 导入 queue/rejected-events、解析 payload，`merge` 调用 `mergeQueueEvents`。
2. `src/cli/config.ts:30-31` 在模块初始化时定义 home 下 queue/quarantine 路径。child 的实际 resolved home/path 未记录。
3. `src/cli/queue.ts:72-73` -> `mergeQueue:40-69` -> `withFileLock`。锁内读现有 queue `:47`、按规范化完整版本去重 `:48-54`、序列化并 `writeFileAtomic` `:64-67`。版本函数为 `src/cli/queue-event-version.ts:5-10`。
4. `src/cli/atomic-file.ts:157-209` 的锁默认 5s / stale 30s（`:26-28`），包括 mkdir、`openSync(lock,"wx")`、token stamp、执行 fn、finally release。`writeFileAtomic:56-96` 包含 temp open、限制 owner、write/close、rename 与有限 transient retry。
5. Windows owner restriction 静态分支为 `src/cli/file-permissions.ts:43-55` 的 principal 检查及 `icacls`；若返回失败，`atomic-file.ts:69-71` 形成含上下文的 Error。**本次未记录是否到达该阶段或其原始错误，不能将 icacls 当作原因。**
6. merge 返回后，fixture `:11` 还会调用 `readQueue()`、`readRejectedUsageEvents()` 再打印 JSON；`readQueue` 也取锁且必要时重写（`queue.ts:25-33`）。父进程未读取这个 stdout，所以**worker failure 即使在 merge 之后，也不能直接解释成 merge 未提交或 queue loss**。

锁、ACL、parse、rename 的机制描述是源码导航，不是这次 Windows failure 的运行阶段实证。

## 与旧基线的只读比较

- 基线 run `37803611472` / Windows job `113401991277` / source `76d916ba2e3a7147acda5ac9ef15fa70a9cd9958`，由既有 run metadata、checkout log 和报告交叉定位。
- `baseline-ci-37803611472-windows-full-job.log:597-602` 明确给出同名用例 PASS、`MULTIPROCESS_CONTROL {"beforeCount":8,"afterAckCount":7}` 和 2726ms。不是“旧报告未列失败所以推测通过”。
- 基线日志 `11-17, 107` 的 OS/image/Node 与本次记录一致。相同 image 标签不证明进程负载、runner 实例、文件系统时序或完整环境相同。
- `provenance.json` 对照两个 git 对象：测试、worker、queue、atomic-file、config、queue-event-version、file-permissions、rejected-events、两个规范化 helper、package/lock/tsconfig/vitest/workflow 的 blob 完全相同。
- **不宣称依赖闭包完全不变**：`config.ts:8` 传递导入的 `privacy.ts` 有差异，修改位于 `physicalScopePath` 的 `:44-47`；worker merge/read 分支未显式调用该函数。测试集合另外有改动/新增，完整套件总数从 2039 到 2060。静态未见调用不等于运行时排除加载影响，前后各一次 run 不能判定因果。
- 既有 `docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/native-ci-failure.md:16-25` 已要求先保留失败证据与收集决定性 filesystem/child 分支；本诊断不修改或软化该报告。
- 同 run 其他队列用例通过（新日志 `351, 533, 553, 581, 666`）和顺序 quarantine 通过 (`537-544`) 不能抵消这条并行 writer failure，也不能作为本路径的 queue soundness 证明。

## 可判 / 不可判

可判：这是相比旧基线新增的**失败观察**，定位至父测试的非成功 exit 拒绝；信息投影过早且不足，关键 child status 和 stage 已丢失。

不可判：失败 writer 的精确 code/signal、是否完整执行或进入 fixture、完整 stderr/stdout、失败队列状态；更不能判 queue loss、ACK 错删、lock timeout、ACL failure、Node crash、antivirus、repair-caused regression 或 flake。

## 最小本地复现的边界

执行 `node docs/test-reports/windows-queue-failure-findings-r1/local-exit-information-loss.mjs`，exit 0。输出保存在 `local-exit-information-loss-output.json`。

该脚本仅在 **macOS arm64 / Node v25.7.0** 生成两个无 stderr 的标准库 child：数值 exit 17，以及 `code=null/signal=SIGTERM`；按原测试 `new Error(stderr)` 投影，两者都得到空 message。它证明空 Error 不能唯一还原退出类型；**不运行 tsx/queue、不复现 Windows failure、不替代 native acceptance**。

## 最小后续观测计划：proposal only，未执行

1. 先补最外层失去的证据。在另行明确授权的 exact-candidate Windows diagnostic 中，以独立 sidecar 记录 8 个 writer 的 index、synthetic event/version、PID、单调时间、spawn/error/exit/**close**、精确 code/signal、timeout/kill 来源，以及有界 stdout/stderr 的 byte count 和 close 后完整缓冲。**保留原测试 exit-based settlement、timeout、assertions 和产品代码；不要将改成 close 伪装成已修复。**
2. 失败 fixture 删除前保留 synthetic queue/quarantine/lock/temp 的文件状态与 SHA；观测 peers 直到 close，区分首个失败与 cleanup 后续失败。不能根据 finally 之后的状态推断首个失败时的原始状态。独立探针可以保留自己的 fixture，但必须标明与原测试 cleanup 的差异和 instrumentation effect。
3. 仅当上述还不能定位 stage，才在另一个诊断 worker 设置最早 body/operation-entry、merge 前后、read/print 前后标记。若证据证明到达 merge，再对 lock acquire/read-normalize/temp-open/ACL/write/rename/release 分支收集有界观测；before-worker-entry 则留在 Node/tsx loader/native termination 边界，而不是扩散为 queue 结论。
4. 保留相同未改 candidate 的原始全套 run 作为参照，后续每次只改变一个条件；focused 成功也不自动宣称原 Windows full-suite path 已闭合。此计划没有授权 rerun、push、workflow dispatch、生产访问或代码/旧测试更改。

## 哈希和重放

`provenance.json` 记录 16 个候选源码/config 的 canonical git blob SHA256、两端 blob OID、local-byte match，以及 6 个原始证据哈希。Windows checkout 的实际 CRLF 字节未记录；源码 SHA 是仓库 blob 字节，不能混称 native working-copy hash。

- 新 raw log SHA256：`d45f104b41195b1feddddd02576ae1288ea2a447ca02e4f4f7e4b89a3625b494`。
- 新 metadata SHA256：`5c1091cad74e73909c1fc694bdb776930497e7ce184c3aca496b3c342171b884`。
- 旧 full-job log SHA256：`e219e8c1f8c9d8cebb7ef3b4c6d8f1b6c79dccb9a3d614e6b4f3a0e4fa2f7ec2`。
- 旧 unit original log SHA256：`1d6ccd9641c573f1de858ef723e75f59ba662b5c3f80505e6b80cfa0a22fdb4e`，与旧报告值一致。

副本 SHA/逐字节相等在 `capture-provenance.mjs` 中 assert 后输出。它只读源码/git 对象/证据，不访问远端。报告 bundle 验证脚本和哈希表由本目录 `verify-report.mjs`、`SHA256SUMS` 提供；提交范围需保持只有本目录。
