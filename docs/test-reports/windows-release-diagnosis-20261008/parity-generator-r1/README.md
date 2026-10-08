# Runtime parity second diagnostic：受限 Generator 交付

## 交付和冻结基线

仅实现已锁 §1.5 supporting diagnostic，不是 Windows 产品修复或发布验收。
`releaseAcceptance=false`、`releaseReady=false`。未运行 Windows、旧 tests 或任何产品
runtime；本机只做 Node22 syntax/schema、纯数据与 VM mock 语义控制、workflow static。
未 push、访问生产/SSH/Secrets、改状态或修改旧原件。

- 指定 source freeze：`7c6936b97a54f13d1ceb3272f810cf51d28a34f1`。
- 父编排的 common-guard 澄清已原样 cherry-pick；实际 implementation scope base：
  `846e8e07614a97dcebd9d2cd2bdb678f971651fd`。
- 产品仍精确原失败 `76d916ba2e3a7147acda5ac9ef15fa70a9cd9958`；
  初版 native run `37808814119`、32 raw、native-findings-r1、旧两个仪器不变。
- 仅新增 `../native-runtime-parity.mjs` 和本目录 check/report artifacts；专用 workflow
  只换明确CLI路径、对应step标签及诊断CLI/source-freeze metadata。
  trigger/job ref、permissions、immutable checkout、Node22/npm ci、12min与artifact allowlist
  均保持精确原字节。checks用“冻结 workflow + 唯一允许字符串替换”比对完整文件。

`local-checks.json` 包含10个冻结 tree/blob object与当前 committed object对应，32原件
sha验证结果、2syntax、actionlint、5环境边界、5admission边界、9guard mock。
`handoff.json` 提供新CLI、workflow与report/check文件的SHA256/bytes；不自我引用哈希。
它不是独立 Evaluator verdict，提交后必须 scope critic 复核，Coordinator 才能另行运输。

## 原生执行入口与输出

经独立 scope review 后，仅指定隔离Windows CI运输此命令：

```sh
node docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs
```

CLI拒绝非win32/Node22、ad-hoc case/arm或重试参数。输出沿用现有allowlist目录
`native-output-parity-<timestamp>/`，无新的workflow artifact范围：

- 每case `*.json`：arm/trace模式、达到的门、耗时、返回类型、minimized数值/boolean、
  protocol/canary/budget/diagnostic completion；不保存raw stdout/stderr或environment values。
- `*.guard.jsonl`：共同守卫metadata，spawn/exit/close、native预算abort；
  `*.trace.jsonl` 仅旧trace on模式，原trace-preload原样执行。
- `*.health.json`：guard health和old trace health独立；pending/failed/missing/invalid明确
  incomplete，不推断产品cleanup失败。
- `*.cleanup.json`：历史PID只做liveness记录、不signal；明确不能由stdio close或PID死
  普遍证明整拥有树；forced/ownership-observer-incomplete保守cleanupUnknown并保留ownedroot。
- `powershell-counter.jsonl` 与 `parity-summary.json`：全局实际计数、选中arm、not-reached。

parent会先检查stdout严格字段/枚举allowlist再保存parsed报告；未通过只存false状态、
bytes/canary布尔，不dump替代raw。输出超限的canaryCoverageComplete=false，不假装检查了
被丢弃部分。产品/PowerShell stderr从不落盘，只有bytes或固定errno metadata。

## E0–E4 / off–on 分支和解释边界

baseline只保留PATH/SystemRoot/WINDIR/ComSpec/PATHEXT，全部HOME/USERPROFILE/TEMP/
TMP/TMPDIR为fresh ownedroot，空Gitconfig/promptoff。每次构建以同root的E0比较key差集并
断言恰好等于以下唯一key；不同case freshroot属于共有fixture，不是继承runner env。

|arm|唯一key变化|来源|
|---|---|---|
|E0|无|原严格synthetic baseline|
|E1|SystemDrive|已允许SystemRoot的local drive|
|E2|APPDATA|fresh owned synthetic目录|
|E3|LOCALAPPDATA|fresh owned synthetic目录|
|E4|PSModulePath|仅SystemRoot/System32/WindowsPowerShell/v1.0/Modules|

E4不读registry、User/Process module路径、自定义Machine模块或真实profile。
它是builtin machine-system path控制，**不代表所有机器module环境等同原CI**。
无optionalCombinedArm、E5、全runner-env或隐式补键。E4仍失败则如实unknown，不扩arm。

确定顺序为 off E0–E4、on E0–E4，各freshroot；同宿主缓存/暖启动影响仍可能存在，
单次观测不提供完全因果或原测试环境等价证明。每种form仅first完整P2-success arm可被
明确选中一次；没有重试挑绿样本。

- P0：纯固定PowerShellmarker。
- P1：固定synthetic JSON的ConvertFrom-Json smoke，和P0分开调用/计时。
- P2：与冻结 `src/cli/replay.ts` literal精确相同的native attribute script，检查owned
  source及其必需ancestor链，严格marker/status/signal检查。
- 前门失败，后门明确 reached=false；不将P0/P1通过说成完整安全gate通过。

两form都有 **common budget/lifetime guard on**。off只关闭旧trace-preload，不能称
uninstrumented/original CI自然环境。共同guard通过同一新CLI的 `?guard=1` self-preload
进产品Node worker，便于机械计数PowerShell；没有stream data listener。oldtrace on才加
旧trace import。共同guard仍有metadata IO/调度成本，不能宣称完全零污染。

guard使用errorMonitor，不消费产品原本unhandled error；正常native返回值/异常身份不变。
logger stat/append/serialization错误fail-safe，健康sidecar独立变failed/missing，parent不
静默信任不完整数据。只有预算/生命周期门允许主动abort；预算abort标为
diagnostic-budget-not-reached，不能把产品catch后generic refusal误报产品缺陷。

## 机械预算与拥有范围

- 全局600s；owned-case40s；每case启动要求剩余至少43s（包括3s cleanup/output）及
  worst-case PS数量，synthetic目录setup后、native launch之前再次admit。
  child与parent timers截断到global deadline，余量不足不启动。
- smoke最多38、总PS最多76。同步全局counter在原async spawn之前admit并计数；
  不可读取/写入counter则拒绝该native launch、report独立diagnostic abort。
  unexpected synchronous PowerShell不提供旁路。所有case顺序执行，没有counter并发重试。
- P0/P1/P2每native child7s、16KiB，保留10s产品操作budget；原bounded worker/watchdog/
  cleanup allowance原样。没有改MAX_ELAPSED_MS、timeout或原tests。
- 每case汇总stdout/stderr64KiB、每trace/guard512KiB。旧trace最多一row越界可能性不
  改旧仪器；新parentcopy最多512KiB，记录original bytes/truncated，完整性false。
- common guard40s lifetime只清理仍active的本进程直接拥有ChildProcess handle；
  parent watchdog同样仅其直接拥有root handle。没有根据历史PID、process image或全系统
  scan盲杀。child.exitCode/signalCode已终止时不再signal。未知历史PID只probe并记unknown。
  owned树/Job权威证明不是此脚本输出：任何forced root/lifetime/ownership observer不完整
  都保持cleanupUnknown，不据taskkill返回或直接child close形成整树product PASS。

产品原来taskkill128/error reclassification未修改；本次不测试/修复它，也不做整树ownership
新推断。所有native侧结果待运输后观察，本机mock不替代它。

## 条件下游：parent优先、公平analog、不能把未到当通过

只有一个完整P2成功arm/form可进入下游。两个form先各parent；再逐kind off/on公平轮换
confirmation、binding、healthy，仍逐caseworst budget检查（分别3/14/14/6次PS）。
两form全部analog可能加smoke超过76；任务不要求全coverage，cap不足显式not-reached。

- parent记录afterPathStat/afterRead hookReached、每步rename/mkdir/hardlink、native errno；
  保持原product默认10s及generic catch，不预设rename根因。on有原fs trace；off无额外fs
  observer，不假装所有read gate都有相同granular trace。
- confirmation/binding缺preview digest即所有execute reached=false，merge0会明确标为
  zeroDoesNotProveUnreachedNegative，不声称stale安全断言已通过。
- healthy仅synthetic Git setup/queue；失败preview下execute未到。暖单进程analog与原
  两个coldNode probes不同，明确记录。只有minimized admissions/backlog/hash/canary boolean。
  setup不fetch、不请求server、不读用户config/credential。
- 每条measure是本次采样而非assert转PASS；product拒绝、diagnostic预算abort、未到门和
  instrumentation/cleanup unknown分开，release接受始终false。

## 本机校验与重放

在指定generator worktree，Node22.22.0/darwin；已有主worktree Ajv和actionlint只读使用，
没有install或dependency变更：

```sh
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r1/checks.mjs
```

checks导入新CLI的纯函数，但不启动Windows入口或产品。VM用内存fs、fake ChildProcess/
process/timer，无真实native进程/文件访问。9控制包括正常返回身份、native spawn/spawnSync
异常身份、unhandled error仍throw、logger stat/append失败不替换结果、counter失败/上限
主动abort、lifetime只kill active owned handle、已closed不kill。schema/actionlint/syntax另验。

所有原证据32sha及冻结trees/blob已核对；`handoff.json`/hash原样运输。剩余必须是独立
scope critic与授权Windows运行，不得用这个Generator自检代替native/独立验收或发布PASS。
