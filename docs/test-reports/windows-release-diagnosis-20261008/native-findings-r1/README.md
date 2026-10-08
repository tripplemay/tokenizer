# Windows 原生诊断：运行分支补证 r1

## 结论和边界

这是 §1.5 支持性、只读技术诊断，不是 Generator 修复或独立发布验收。
本报告新增证据，不改写 `ec7b439` 原报告及 `98c30de` 仪器修订。
`releaseAcceptance=false`、`releaseReady=false`；原 F004 Windows 发布失败未解除。
没有重跑 CI、产品/旧测试/fixture 修改、状态修改、push、生产或凭据操作。

本次可锁定两个**产品修复候选**：

- **W04 隐私**：Windows 对 regular-file 后代返回 ENOENT，产品回退到现存
  regular ancestor 后未验证它是目录，确实错误保留 event。
- **W07 进程监督**：合计输出超限已触发；目标随后正常关闭，taskkill 再以128退出，
  worker 将已锁定的 output 原因重分类为 supervision。fixture拥有 PID 在返回时已不活。
  这是分类竞态补证，不是整拥有树cleanup已权威验证；没有该证明前unknown仍须supervision。

另两项确认的是**测试/fixture 假设**而非已见产品逃逸：W01 精确 LF 提取不能处理
CRLF；W06 inherited fixture 的父/后代已死、pipe close 提前完成，没有存活 holder。

**必须保留四项未证状态**：W02 parent 的两个 hook 都未进入；W03、W05、W08
均在第一 preview 的首个 native-attribute 检查失败，后续语义断言全部未到。
不能沿用原先“很可能只是多次调用合计超过5s”的推断作为已经证实的根因。

## 来源与完整性

- 原发布候选：`76d916ba2e3a7147acda5ac9ef15fa70a9cd9958`。
- 原生专用诊断：run `37808814119`，job `113420026669`，HEAD
  `f6b89d781a74f7baff4db0d47733e813f04b839c`，outcome failure。
- 原生 runtime：Windows Server2025 Datacenter `10.0.26100`；Node `v22.23.3`；
  libuv `1.51.0`；Git `2.55.0.windows.5`；runner image
  `windows-2025-vs2026 / 20260925.250.1`。见 `original/.../provenance.json` 和
  `original/ci-37808814119-original.log:10-19`。
- 本次 HEAD 对基线的 `src/`、`tests/`、`deploy-vps.yml`、package/lock diff 为空；
  两诊断脚本对 `98c30de` diff 为空。本次不是混入产品修复后的观察。
- 父编排下载的30个 JSON/JSONL 加 full job log/meta 共32文件，逐字节复制在
  `original/`；`SHA256SUMS` 和 `analysis.json.evidenceInventory` 记录原件哈希。
  不修改、归一化、过滤、重排原始 bytes。
- JSON 嵌套 stdout 解析、trace 行号、时序均来自复制原件。
  `analyze.mjs` 只读取它们并写本目录派生产物，没有执行产品或访问网络。

### Job exit1 的准确解释

7个 case 的外层 Node 均 `status=0, signal=null, stopped=false`，但内部 `measure`
会捕获产品异常，**case exit0 不代表产品通过**。
7份 cleanup 全部 `liveFixturePids=[]`、未截断、没有 stale PID signalling。
唯独 `subprocess.trace-health.json` 有5个 pending PID：
`4924,2180,5028,880,10148`；没有 missing、invalid、failed logger sidecar。
其余6份 health 为 complete。因此脚本 fail-closed 汇总为
`diagnosticCompleted=false`，对应 job exit1，而非汇总所有产品异常。

被 taskkill 或推断的父 job 关闭终止的进程不保证执行 Node exit sidecar 写入。
pending 只能表示**trace completeness unknown**；不能改判为 cleanup failure，
也不能静默抹掉它或声称完整 trace。明确的 worker 结果与独立 PID liveness
仍可按各自证据使用。日志没有 fixture PID 的 runner orphan-cleanup 明细；最终
16s 审计已经是 job结束之前，不能拿 job完结才清 orphan 解释本次早期死亡。

## 八项失败逐项映射

下文短路径 `*.trace.jsonl`、`*.json` 均位于
`original/run-37808814119-original/windows-release-diagnosis-20261008/native-output-1791476860167/`。
对应原8项测试位置及原失败文本保留在上级原报告；机器结果见 `findings.json`。

### W01 — workflow 静态 guard 提取

`workflow.json`：checkout 有821 CRLF；六个 job 的 `index=-1`、提取长度1，
`guardPresent=false`。仅在内存转换为 LF 后六项全部找到且 guardPresent=true；
同内容构造 CRLF 后重复失败。与原测试 `slice(-1)` 得到 `\n` 精确吻合。
这是读取/提取假设，**不是 guard 缺失或授权绕过**。

窄建议：单独批准静态解析对 LF/CRLF 等价，并断言 marker 确实存在再 slice；保留
全部授权与 inventory 断言，不改 workflow 运行 guard 或偷偷改 checkout。

### W02 — parent afterRead message mismatch

`parent.json` 明确两 hook 均 `hookReached=false, hookStep=not-entered`。
trace 25/44行已有 regular leaf stat；28/47行首个 powershell spawn；
29/48行约7s后 taskkill；taskkill close0，powershell 被终止后 close1；
34/53行 workerKind=timeout；随后 `readBoundedReplayFile` catch245–247
把非 `Replay refused:` 异常映射为 generic safe-open refusal。

未见 source open/read、renameSync、替换 mkdir 或 hardlink。**本次没有任何原生
rename errno，也没有 afterRead 后置 gate 证据**。原发布 afterPathStat 控制确实成功，
而本次连它也未到，所以不能把新 generic refusal 当作原失败的相同根因。
原测试先 message mismatch，后面的 reached assertion 没执行，不可声称它已为 true。

窄建议：先补同宿主/同预算的环境、preload、冷暖 native-attribute 对照；gate
可用后再观察原 hook 每步 errno 与 parent identity。现在不建议改 parent 产品检查。

### W03 — final confirmation negatives 5s timeout

`confirmation.json` 只有 preview：`7175.6856ms` 后 generic refusal；首个
PowerShell worker timeout（trace24–32）。没有 digest，projectRoots/mode/同大小内容
三项 execute 都未进入；`mergeCalls=0` 在这里是**没有执行的结果**，不是负例通过。

原测试若全部到位需要7次读取/14次 native-attribute 调用，这只是源码路径计数，
本次实际只有1次。原5s timeout 不包含 stage trace，根因仍未定位。
窄建议：先解决诊断 precondition，证明每个 unchanged 语义路径及耗时；若最后确认
纯 aggregate 问题，才另批有界独立负例，不提高全局 timer、删除断言或放宽10s操作期限。

### W04 — regular-file ancestor 错误 admission（优先）

trace17–19：`regular\child` realpath.native=ENOENT，lstatSync=ENOENT；
随后 `regular` realpath 成功。event返回 count1，应0，且仍是原输入对象。
trace22–24 对 invalid include rule 使用相同 fallback；rule count0 的原因只是 event
位于root而不在 `regular\child` 下，**不能把这个0当作物理路径已安全拒绝**。

ancestor 是诊断成功执行 `writeFileSync(regular,'not-directory')` 构造的普通文件；
仪器未包裹 writeFileSync/未直接对这个成功 ancestor 做 stat，故没有独立
`isFile=true` trace 行。产品的 realpath-success 分支也完全没有 directory 判断。
这条证据边界不妨碍受控 file fixture 与错误 event admission 的端到端结论。

控制：cycle 得 ELOOP 并拒绝（25–28行）；broken junction 的 lstat显示
symlink=true并拒绝（29–38行）；普通现存目录下 missing/child 得 ENOENT，
回退到目录 allowed 并保留（39–44行，count1）。

窄建议：**missing suffix 非空时**在拼接前验证 canonical existing ancestor 是目录，
stat/realpath 不确定 fail closed。保留有效目录 alias、正常缺失目录后代、事件对象/
sourceEventId/cursor/wire identity；不能用“全部 ENOENT 拒绝”或“全部 symlink 拒绝”
来通过。祖先目录身份/race 检查应保持已有 fail-closed 契约，不能声称 stat提供原子性。
本次只证明 filter 错误 admission，没有尝试 queue、传输或真实敏感内容。

### W05 — replay binding 5s timeout

`binding.json` preview `7214.5001ms` 后 generic refusal；trace24–32首检
worker timeout。bad digest、privacy scope/mode、文件增长四种 execute 全未到。
mergeCalls=0同样无语义证明力；原7reads/14checks的 aggregate 推断未被实测证实。
窄建议与W03相同；特别不能去掉绑定/隐私 gate 或仅增时换取测试绿灯。

### W06 — inherited pipes 不抛 TimeoutError

trace43/46行 worker5348→parent7292→resistant child880，均 non-detached。
49/50行 parent exit0→close0，仅相隔 `0.4254ms`；51行 workerKind=ok。
API `356.2108ms` 返回（worker355.6876），早于500ms期限；该 mode 未 spawn taskkill。
`subprocess.json` 两拥有 PID 在返回和+100ms时均不活；cleanup16s后仍全部不活。

因此本次 **没有 surviving holder、held pipe 或 leak**。原 fixture假定parent exit
以后 non-detached Node child 仍活，不适用于此运行。父 job 关闭自动杀子与精确
Node/libuv源码一致，但 trace 未查询 job membership/handle，**机制仍推断**。
不能从 descendant pending sidecar 单独证明 parent auto-kill；死亡 liveness 才是独立证据。

原测试第一 `toThrow(TimeoutError)` 失败，后续 PID count/poll断言未到。窄建议是另批
additive Windows 真正继承 pipe 的 holder canary：握手证明启动并仍活、拥有关系、
独立15s self-cap和有界cleanup；不能仅 flip assertion、skip native case，或断言普遍
Windows树清理正确。没有此控制前，产品“ok 时漏清理”未证实。

### W07 — combined stream output error 被改成 supervision

worker6920 的单进程 monotonic 时序（`subprocess.trace.jsonl:57-64`）：

| line | ms | 事件 |
|---|---:|---|
|57|104.9153|stdout600 bytes|
|58|105.6115|stderr600 bytes，1200 >1024|
|59|110.1197|spawn taskkill5640，目标884|
|60|114.3598|目标884 exit0|
|61|114.9256|目标884 close0|
|62|173.3054|taskkill exit128|
|63|173.8317|taskkill close128|
|64|外层不同进程|workerKind=supervision，helper status0|

worker `collect`60–67只能在 combined bytes 超限锁定 output；`finish`52–57
进入 killTree；Windows `status===0` 返回false，最终 `successful && closed` 为false，
改为 supervision。API在209.444ms抛 `subprocess cleanup failed`，而不是外层
watchdog/protocol 错误；目标拥有PID at-return不活。这重现原错误类别并定位分支。

控制：同 fixture max=1200 成功，stdout/stderr各600（65–74行）；长期overflow
被taskkill0清理并产生OutputError（75–91行）；resistant/descendant均timeout且无残留。
所以不支持“Windows taskkill整体不可用”。taskkill stderr被ignore，不能硬编码128
代表某种原因，或把所有nonzero当作安全。

窄建议：**现在不能仅为通过原assert更改类别，整拥有树证明未具备时unknown保持supervision**。
未来可保留最先 output/timeout cause，但仅对**独立证明拥有范围已终止且close完成**
的 benign already-gone 竞态保留 OutputError；真实活残留、权限失败、cleanup超时或
无法验证仍应 supervision。`closed`只代表直接子进程与stdio，不普遍等价整棵树死，
不能简单将 `successful && closed` 改为 `closed`/OR；修复设计须明确 Windows
拥有树/Job及已经退出PID的身份边界，避免PID复用和无关PID signalling。

### W08 — healthy replay/Git 5s timeout

trace16–18行仅3次 synthetic Git setup，分别54.1051/93.9877/31.8356ms，status0。
preview7194.9511ms失败在首个 PowerShell检查（29–37行），还没到 product Git
enrichment；execute不存在。preview后queue hash不变、backlog retained、无canary，
是早期拒绝控制，不是“普通Git/确认admission/remote脱敏通过”。

原测试是 preview/execute 两个fresh Node/tsx probes；新诊断设计是一进程暖缓存，
且严格env不同，因此即使新healthy通过也不等价原测试时序。现在更不能称其通过。
窄建议：原生 gate对照明确后，再测unchanged cold preview/execute分阶段；保留
操作deadline、不renew、原断言和state保护，不提高global timeout。

## 五次首检：操作预算与 aggregate 的区别

产品 `MAX_ELAPSED_MS=10000`；Windows从remaining扣3s监督/清理allowance后，
首个 PowerShell获得约7s。下面是**同worker monotonic差**，不是跨进程拼接计时：

| case | PS PID / worker PID | spawn→taskkill ms | helper ms | 后续业务阶段 |
|---|---|---:|---:|---|
|parent afterPathStat|9660 /8208|6995.7352|7166.0316|hook未到|
|parent afterRead|5704 /6184|6996.3325|7174.9214|hook未到|
|confirmation|9076 /6644|6995.5963|7169.3595|execute未到|
|binding|5976 /4536|6985.9228|7205.4619|execute未到|
|healthy|7288 /4680|6994.1735|7188.9775|enrichment/execute未到|

五次全无 captured stdout/stderr行，taskkill close0，PS close1（被终止之后），
worker timeout；不能误读PS close1为脚本主动检查到reparse。所有耗时是仪器开启值。
本次没有Vitest5s timer，仍在产品首检发生有界超时；故不能把新run解释成timer aggregate。

新诊断仅继承 PATH/SystemRoot/WINDIR/ComSpec/PATHEXT，覆盖 synthetic
HOME/USERPROFILE/TEMP/TMP/TMPDIR，空Gitconfig；原 parent/confirmation/binding
直接沿用runner环境，原healthy用 `{...process.env}`并覆盖部分HOME/tmp字段。
新preload额外同步trace及健康sidecar，并观察子流；先前fail-safe修订保持native
成功/错误与errorMonitor语义，但不能宣称耗时/调度完全无影响。
现有原件没有PowerShell内部启动/模块/命令阶段标记、非仪器对照或环境差异运行，
**无法区分环境、冷启动、native检查命令、仪器或其他宿主因素**。这不是证明产品
永久不可用，也不是证明诊断fixture有效到所有后续branch。

## 最小 native-runtime-parity 计划（先提案，不实现/执行）

下一步先补首检runtime parity，不先修parent或timer。机器计划见
`runtime-parity-plan.json`；必须经父编排adjudicate再独立运输新脚本。

- **环境基线E0**：本次严格allowlist、synthetic HOME/TEMP、空Gitconfig。
  E1仅增加必要非secret `SystemDrive`；E2仅增加synthetic `APPDATA`；
  E3仅增加synthetic `LOCALAPPDATA`；E4仅增加machine-only `PSModulePath`。
  每个arm分别对E0，只变一个键；不得直接继承runner process/user PSModulePath。
  synthetic appdata目录提前在ownedroot建好，SystemDrive从已允许SystemRoot的drive取；
  PSModulePath只读取Machine作用域，核对为系统安装module路径，不读取User或完整env。
  若单变量结果显示初始化需组合，可另设E5依次添加已审计的必要字段，每一步只变一个键；
  不能事后自行补任意字段直到绿灯。只记录arm名、键存在/来源类别，不dump任何值。
- **命令分层**：P0纯固定PowerShellmarker，无JSON/路径；P1单独
  ConvertFrom-Json固定synthetic JSON smoke；P2原exact GetAttributes/check脚本，
  输入仅owned parents/regular source。P0失败则该arm的P1/P2标记未到，P1失败则P2未到。
  marker、JSON和完整gate分开计时，不能把前两个通过当reparse安全检查通过。
- **仪器对照**：每个arm对应preload off/on，只有NODE_OPTIONS trace import改变；
  父诊断仍记录bounded worker结果与PID，off arm不要求trace sidecar。trace on若pending
  依旧是incomplete，不能吞原生异常/误报为cleanupfail。读取trace只记录metadata。
- **预算**：P2沿用10s产品操作/约7s subprocess/16KiBoutput；P0/P1也不得超过这份
  原生首检预算。每case40s watchdog、64KiB汇总、512KiBtrace；最多38个PS smoke launch
  （5arms×2trace×3smoke=30，预先批准的combinedarm最多6，选定有效arm冷暖最多2）。
  downstream analog在内总PS launch上限76，先到数量/时间上限者停止。
  整体600s截止；12minjob外层保持，达到上限即报告unknown，不增加timer或无限retry。
- **后续分支条件**：仅P2成功环境可走2个parent hook及confirmation/binding/healthy
  aggregate analog；仍不改变产品或原tests。记录全部gate/hook阶段、各操作耗时与整case
  总耗时；区分原10s操作上限与旧Vitest5saggregate。若首检失败，explicit blocked，
  不把zero merge/unmodifiedqueue当下游安全断言已通过。
- **安全运输**：owned synthetic path/canary、只上传allowlistedmetadata JSON/JSONL；
  仍活的直接拥有handle/确证身份树才可有界cleanup。PID未知只记录、不盲杀，无全系统
  enum、env dump、Secrets、network、部署。不存在“继承所有runnerenv”的对照arm。

## 其他有界 additive 补证候选（不是本次最小parity任务）

不改任何原产品/旧测试/global timer；同一不可变Node22 Windows runner，顺序运行。

1. **PS首检内部阶段**：每组以同一ownedregular source/parent清单，在原10s操作预算内，
   first marker→ConvertFrom-Json→逐路径GetAttributes→final marker，只记录阶段编号、
   类型/errno/耗时，路径用ownedlabel。先纯固定字符串，再exact native script。
   instrumentation on/off一变量对照；另组仅恢复显式批准的系统初始化env键（如
   PSModulePath/system program paths，合成APPDATA/LOCALAPPDATA），不dump环境或继承
   credential/CI token。不是直接复制全部runner env。冷/暖各一次，不自动无限重试。
2. **Parent**：只有首检正控制成功后才运行原hook形状；记录before/afterPathStat/
   open/fstat/read/afterRead/postcheck每门耗时、hook每步errno及directory/leaf identities。
   不将hook异常吞成成功，不弱化expected changed assertion。若不能到门，报告blocked。
3. **Combined**：既有短命600+600与additive持续活输出控制，保持1024/1200边界；
   记录latched cause、target exit/close、taskkill bounded metadata/errno、已验证拥有树
   liveness。多次样本须预先有固定数量（如3次），不能靠retry找到绿样本。
4. **Inherited**：先证明Windows holder与ownedPID确实活、继承同一stdio，parent正常
   退出后仍活的握手，再观察product500ms timeout。fixture不满足前提则记录invalid，
   不据此降级断言。独立15s cap，40s父watchdog；仅仍持有handle/确证身份的owned树
   cleanup，不凭stalePID、image名或全系统process扫描盲杀。
5. **Confirmation/binding/healthy**：native gate成功后才记录preview、每个execute及
   mutation hook阶段；计算各操作与整case总时长，分开10s操作期限和5s旧测试aggregate。
   同一数据只验最小化结果、merge次数/queuehash、cursor/config bytes；不记录raw行。

补证上限沿用40s/case、64KiB总stdout/stderr、512KiB trace；只上传allowlisted
JSON/JSONL，原始内容/credentials canary泄露即failclosed，不抹掉真worker结果。
sidecar pending/failed仍独立report incomplete；任何未知PID仅记录、不盲杀。
上述计划不是允许重跑、改fixture或修复产品的指令，本任务未实现/执行它。

## 本机复算（非 Windows 验收）

在本worktree用Node22，仅解析已归档bytes：

```sh
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node --check docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1/analyze.mjs
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1/analyze.mjs
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1/check-local.mjs
cd docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1
shasum -a 256 -c SHA256SUMS
```

哈希表路径相对 `native-findings-r1/`，故最后一条须在上述cd后的目录执行；
可移植复算直接用Node22运行analyze，无产品import、childspawn、网络或外部目录枚举。
本机syntax/schema、32原件与父下载hash对比、确定性复算记录见 `local-checks.json`。
`check-local.mjs`仅针对本机已存在的父下载路径与主worktree Ajv；没有安装新dependency。
所有macOS动作均为分析校验，不充当新的Windows runtime、测试或release PASS。
