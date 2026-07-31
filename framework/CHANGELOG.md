# Framework CHANGELOG

记录框架每次迭代的内容、来源批次和触发原因。
每条记录由 Planner 提案、用户确认后写入。新条目追加在最上方。

---

## v1.5.3 — 2026-07-30（发布清单契约：控制台与框架版本不得漂移）

**来源：** tokenizer `BL-FW-RELEASE-CONTRACT`。框架源码、项目镜像和控制台各自维护
发布历史，导致本地账本已是 `v1.5.2` 时，控制台仍把 `v1.4.6` 当作最新版本。

- 新增 `harness/framework-releases.json` 作为 v1 正式发布历史的机器事实源；`VERSION`
  必须等于其末项，`CHANGELOG.md` 的全部 v1 标题与发布日期必须双向一致。
- 新增只读校验器、失败 fixture 与 PR/push CI；非法 SemVer、前导零、空或乱序清单、重复版本、
  `VERSION` 漂移和 changelog 单边条目都会 fail closed。
- 清单随既有 `harness/` 递归镜像物化为项目的
  `framework/harness/framework-releases.json`，由 `harness.lock` 使用现有双 SHA 规则管理。
- 历史 v1.1 / v1.2 / v1.3 标题规范为三段式版本号，与已有 tag 和发布契约一致；v0 历史不进入
  v1 发布次数清单，保留控制台对旧项目的无计数兼容语义。

## v1.5.2 — 2026-07-29（macOS pending-gate Ed25519 验签兼容）

**来源：** tokenizer `BL-DISPATCH-LIFECYCLE` 的 `verifying → done` 批准已由设备 agent
中继，但 macOS 系统 `LibreSSL 3.3.6` 不支持 Ed25519，`validate-pending-gate.sh guard`
把「算法不可用」误报成「签名无效」，导致有效批准无法被可靠消费。

- pending-gate guard 与 mode-intent validator 统一 OpenSSL 选择语义：依次检查
  `HARNESS_OPENSSL` 显式覆盖、PATH 中的 `openssl` 和 Homebrew OpenSSL 3 标准路径，
  只选择宣告 Ed25519 支持的实现。
- 无可用 OpenSSL 3 时明确报「运行时不支持」；只有在可用实现上验签失败才报
  「签名无效」，避免把环境缺口误判为批准被篡改。
- 新增 pending-gate 回归 fixture，覆盖有效签名放行、签名字段篡改拒绝和闸门消费后
  无需密码学运行时的收尾路径。

## v1.5.1 — 2026-07-27（dispatch deadline 与生命周期收束）

**来源：** BL-DISPATCH-LIFECYCLE F001-F005。

- local `repo.url` 在创建 state/workroot/clone/worktree 前规范化到 git top-level，并与调用入口仓库
  做身份等值检查；不匹配或非 git 目标会同时报告两侧身份并 fail closed。框架默认 adapter、validator、
  timeout helper 与 runner 资源改为相对 dispatch 脚本解析，显式 CLI 覆盖仍保留。
- `deadline_s` 与 descriptor `timeout_s` 统一为 `60..86400` 的非 boolean 整数；有效任务上限是
  `min(deadline_s, timeout_s)`，缺少 deadline 时保持 descriptor cap（缺省 3600 秒）。schema、手工
  校验器、local-cli 和 a2a client 共用同一常量与算法。
- 新增 stdlib timeout helper：使用绝对 wall clock、独立 session/process group、TERM 后有界 KILL、
  子进程收尸和终止来源 status。只有 helper 自己到期才被 sandbox 判为 TIMEOUT；外部 TERM 与子命令
  自行返回 124 都不会伪装成 helper deadline。
- A2A task store 和 Executor 的终态、事件与 process map 由锁协调。CancelTask 幂等，终态只写一次；
  runner `--stop` 先取消并回收活动进程组，持久化 `finished_at`/终态事件/`events_complete`，在有界 drain
  内继续提供 GetTask/SSE，再移除 pidfile 退出。pidfile 带进程起始身份，避免向复用 PID 发信号。
- a2a client 的 `run`/`subscribe` 使用 effective timeout + 5 秒 transport grace；超限主动 CancelTask，
  断线重订阅携带最后 seq。Cancel 已确认后即使最终 GetTask 连接失败，仍保留可解释的本地 CANCELED
  run-meta。远端 state 继续只作 advisory，本地产物与 receipt/schema 继续权威。
- 新增 deterministic lifecycle matrix，覆盖 repo target、跨 CWD 默认资源、deadline 类型/范围/min/缺省、
  正常退出、自身 timeout、外部取消、父孙进程回收、注入 wall clock、Cancel/重复 Cancel、active stop、
  终态顺序与唯一性、SSE replay、idle exit、restart、task-id 去重及 pid/process 清理。loopback 不可绑定的
  托管沙箱会跳过 HTTP exact-port 子集，同时执行无 socket 的同契约 runner-core 矩阵。

**残余边界：** 自建 A2A 仍是 JSON-RPC/SSE 子集；真实跨物理机、OAuth/mTLS、签名 Card、Windows
原生进程树语义与 OS 级文件系统/网络隔离不在本版范围。客户端重试全部受任务 deadline 约束，框架仍不
自动无限重派，phase gate 仍由人或既有 policy 推进。

## v1.5.0 — 2026-07-27（签名模式意图 + durable dispatch 摘要）

**来源：** BL-HARNESS-DETAIL-MODEINTENT F001 correction。

- 新增严格的 `harness.json.project.mode_defaults={intent,staged_at}` 契约。Ed25519 签名覆盖
  `intent` 中除 `sig` 外全部字段，使用递归 canonical JSON；验签器兼容 macOS，通过
  `HARNESS_OPENSSL` / PATH / Homebrew 路径选择支持 Ed25519 的 OpenSSL 3。
- 机械校验非空 identity/repo、40 位 SHA、UTC 时间和两层未来 expiry；`fast`、`heterogeneous`、
  `slow` profile 分别约束 null assignments、无 a2a + 至少一方 local-cli、至少一方 a2a（另一方可
  local-cli）。所有显式 agent 都过角色白名单、不同 id 和不同 model family。
- 自治关闭只接受 `{enabled:false}`；下一次 `/plan` 不创建非法 disabled policy，并按签名人类意图删除
  stale `autonomy-policy.json`。自治开启要求自己的绝对 expiry、唯一 A/B gates 和四项有界预算。
- **phase correction：** `expected_head_sha` 只由 tokenizer device agent 在写并提交 `harness.json`
  前与真实 HEAD 比较。staging/status commit 会改变 HEAD，所以 `/plan` 只验签名、shape、expiry、repo、
  agents 和安全语义，绝不要求当时 HEAD 相等。
- `/plan` 只在新批次边界消费，记录
  `progress.mode_intent={intent_id,applied_batch,applied_at}`；active batch 不变，无 intent 时保留手工模式。
- local-cli 与 a2a 统一把 run-meta 耐久写进 `--state`（默认项目 `.harness-dispatch/`）。local-cli 日志和
  clone/worktree 仍只在 disposable `--workroot`，没有新增日志上传。
- 覆盖签名 metadata/nested tamper、非法 SHA、repo mismatch、mixed local-cli+a2a slow、disabled
  autonomy、过期/预算/Agent 语义，以及 init/sync 管理和 local-cli `--state` 耐久性。

---

## v1.4.6 — 2026-07-27（修：`sync` 会覆盖正在运行的自己）

**来源：** 把 tokenizer 从 v1.4.4 同步到 v1.4.5 时，升级正常完成，紧接着蹦出
`.claude/harness.sh: line 474: syntax error near unexpected token '('`。

**病灶：** `sync` 更新的受管文件里**包含 `.claude/harness.sh` 自己**，而 bash 是**边读边执行**的
——文件在运行中被替换后，它按旧的字节偏移继续读新内容。这次只是语法报错（lock 与配置
早已写完，报错发生在收尾阶段），但换一个偏移就可能执行到半条语句，后果不可预期。
**只要框架更新涉及 `harness.sh` 本身，每次 sync 都会命中。**

**修法：** `sync` 开跑前先把自己复制到临时文件并 `exec` 过去（`HARNESS_SELF_EXEC` 防重入），
磁盘上那份随便被覆盖；临时副本由子进程自己在 EXIT 时清理。

**这是本轮 dispatch 验证意外捞到的第 9 条**——它与 dispatch 无关，纯粹因为「真的把框架
升了六次」才暴露。前五次 sync 恰好都没更新到 harness.sh 自身。

---

## v1.4.5 — 2026-07-27（两条沉淀转机件：装 harness 的副作用自检 + a2a runner 生命周期）

**来源：** 用户确认 `proposed-learnings.md` 里剩下的两条。都不是「文档写清楚」能解决的——
两件事都是**没人负责**，所以要让机件负责。

**一、`harness.sh init` / `adopt` 完成后自检「push = 部署」的 workflow。**
装 harness 会给项目带来一个持续副作用：状态机每推进一个阶段就提交一次 `progress.json`。
若该项目的 CI 是 `on: push branches:[main]` 且无 paths 过滤，**每一次状态推进都会重建镜像
并部署生产**。tokenizer 与 grandtianfu 都是这形态，**都是撞上了才发现**（joyce 的一次账本
提交已经白跑过一次镜像构建）。现在命中即打印红字警告 + 建议的 `paths-ignore` 清单。
**只警告不代改**——改别人的 CI 触发条件是有后果的决定，得由人来做。

**二、a2a runner 加 pidfile / `--stop` / `--idle-exit`。**
起因很具体：7 月 25 日框架演练留下的 runner 在本机**挂了整整两天**没人关，直到这次要用
同一端口才被撞见（绑 loopback + 需 token，风险有限，但没有任何东西负责收尾）。
- `runner.pid` 落在 `--state` 目录：关它不必再去 `lsof` 端口猜是谁
- `--stop`：读 pidfile 停掉并清理
- `--idle-exit <秒>`：空闲且**无在跑任务**时自行退出。默认 0（长驻部署不受影响），
  演练/临时用途文档要求必须设。判据同时看「有没有活」和「有没有请求」——正在跑的任务
  不能被空闲计时误杀，只轮询状态的客户端也不该无限续命。

**实测：** 造一个 `push:main` 无过滤的项目跑 `init` → 警告如期打印并列出建议清单；
tokenizer（已有 `paths-ignore`）跑 `verify` → 不吵。

---

## v1.4.4 — 2026-07-27（设计订正：外部 generator 不提交 + 把「四道锁不保证什么」写出来）

**来源：** tokenizer BL-MODESCMD —— 首次真派外部 CLI 写代码并走完回流与人闸门。

**🔴 回流四步的第一步改了性质。** v1.1 起写的是「tag 归属校验：外部 CLI 自己打 tag，
不合规就拒收」。真派 Codex 才发现这条走不通：厂商沙箱禁止写 `.git`，`git commit` 连
`index.lock` 都建不出；改用独立克隆把 `.git` 挪进沙箱内**同样被拒**——它禁的是 `.git` 本身。

要求外部 CLI 提交，等于**把交付能力绑死在厂商沙箱策略上**，而这条绑定换不来任何安全收益：
它本来就 `push=false`。真正防 scope 漂移的是「diff 与 handoff 清单对账」，编排者做得更好，
也更难被绕过——对方写什么 commit message 都不影响实际 diff。

新的四步：**diff 与清单对账 → spec-lock 稽核 → L1 由编排者亲自重跑 → 编排者按
`features.json` 打 tag 并提交**。副产品：一次 30 分钟的实现不会再因为 commit message
格式写错而被整轮拒收。`handoff.commits` 随之转为可选，`files_touched` 升为对账主依据。

**§5.1 新增「这四道锁**不**保证什么」。** 此前只写了拦得住什么，读者容易以为它是文件系统
沙箱。实际：不阻止读主仓（Codex 实测 `ls` 过主仓 `node_modules` 并复用，如实披露）、
不保证对方能跑 L1（工作目录无依赖 + Codex 沙箱禁网）、超时能否重派取决于 watchdog 凭据
（v1.4.1）。**当前设计是用产物 schema 与回流校验兜底，不是用隔离兜底**——这句话此前只在
设计者脑子里。

**沙箱注入 `HARNESS_MAIN_REPO`。** 一次性工作目录没有 `node_modules`，厂商沙箱可能禁网。
与其让对方猜，不如明确告知「同 HEAD 的依赖在这儿，只读复用」——实测中 Codex 正是自己
摸到主仓才跑通 L1 的。这不放宽任何权限（四道锁本就不含文件系统隔离），只是把「靠猜」
变成「有契约」，并让它知道**不该写**那个路径。

**§3.3 补两份可直接复制的合法信封样例**（evaluator / generator 各一），并明写
「`local-cli` 派活必须后台运行 + 轮询」——`dispatch-run.sh` 是阻塞式的，在会超时的前台里等
会被 SIGTERM 打断并留下孤儿工作目录（实测踩到，需人工清理）。

**沉淀结账：** BL-FWDRIFT/BL-MODESCMD 攒的 6 条提案，5 条随 v1.4.1~v1.4.4 落地；
剩 1 条（装 harness 前主动检测「push = 部署」的 workflow）仍在 `proposed-learnings.md` 待确认。

---

## v1.4.3 — 2026-07-26（外部 generator 路径三处修：产物路径 / 无法提交 / 诚实反受罚）

**来源：** tokenizer 上首次真的派 Codex **写代码**（A 阶段）。它跑了 33 分钟、代码写完、
L1 自测通过，却在三处同时撞墙——**只有真派一次才会撞到的三处**。

**🔴 一、沙箱忽略信封的 `deliverable.artifact`。** 产物路径只认适配器的 `artifact_relpath`
（默认 `<batch>-verdict.json`），信封里写的 `handoff.json` 被无视 → generator 的交付
**永远被判 `ARTIFACT_MISSING`**。信封是「这一次任务」的契约，适配器只是「这家 CLI」的
默认约定；契约必须压过约定。改为 **信封 > 适配器 > 默认**。

**🔴 二、外部 generator 在厂商沙箱下根本无法提交。** `git worktree` 把元数据放在**主仓**的
`.git/worktrees/<name>/`，而 Codex 的 `-s workspace-write` 只允许写 workspace 目录本身——
`git commit` 连 `index.lock` 都建不出来（实测原话 `Operation not permitted`）。
**四道锁的 L2（独立 worktree）与厂商自带沙箱在此相互不兼容**：v1.1 放开外部 generator 时
没人真派过写代码的活，于是这条一直没暴露。
改为：`constraints.write_src=true` 的角色用 **`git clone --shared`**（`.git` 落在沙箱目录内、
可写；object 仍与主仓共享，不复制体积）。隔离性不降反升——不再与主仓共用 `.git`，
主仓连元数据都不会被碰。evaluator 等只读角色仍用 worktree（更轻）。

**三、我在 v1.4.2 引入的 schema 缺陷：诚实反而受罚。** `commits` 定成 `minItems: 1`，
于是外部 generator 被挡住无法提交、**如实上报 `waiting` 并写空 commits** 时，产物必然
违反 schema 被机械拒收。改为 `waiting` 非空时不强求 `features/commits`。
**规则不能让「如实报告被阻塞」成为一条走不通的路**，否则就是在奖励编造。

**顺带记一笔正面观察：** Codex 被挡住时的原话是「不会用替代 SHA 冒充原 worktree 提交，
也不会触碰 push」——没有伪造、没有绕过，停手并如实说明。机件设计不该假设对方守规矩，
但这次它守了。

---

## v1.4.2 — 2026-07-26（补：外部 generator 派活此前无 deliverable 契约可填）

**来源：** tokenizer 上验证 dispatch 的**外部 generator** 路径（A 阶段）时卡住——发不出信封。

**病灶：** 信封 schema 必填 `deliverable.artifact` + `deliverable.schema`，而 §6 对
外部 generator 只规定「产物是 worktree 里的提交」，**没有任何工件 schema 可指**。
于是 evaluator 派得出去、generator 派不出去：v1.1 放开外部 generator 时只想清楚了
四道锁与回流四步，漏了它在 L2 信封层的落点。

**新增 `generator-handoff.schema.json`：** 不是代码本身，而是一张**可与实物逐条对账的清单**
——每条 feature 声明自己产生了哪些 commit、碰了哪些文件。编排者拿它去比对 `git log` 与
实际 diff：commit tag 归属对不上就拒收（铁律 10 / §6 回流四步），`files_touched` 之外
多出来的文件即 **scope 漂移信号**。

**刻意不设结论性字段**（「已充分测试」「可以合并」之类）：外部 generator 无评估权，
`l1_ran` 只记它自称跑了什么，**编排者必须自己重跑一遍才作数**。`waiting` 与 verdict
工件同一套语义，回执推断直接复用，不必为 generator 再写一条分支。

---

## v1.4.1 — 2026-07-26（修：macOS 上超时被误判成失败 —— 「幂等重派」承诺从未生效）

**来源：** tokenizer 上验证 dispatch 的**失败路径**（此前四次派活全走成功路径）。

**病灶：** `sandbox-profile.sh` 的 wall-clock 封顶在无 GNU `timeout` 时走 bash watchdog，
watchdog 用 SIGTERM 杀子进程 → `wait` 返回 **143**；而 outcome 判定只映射 124/137，
143 落进 `FAILED`。**macOS 默认没有 GNU timeout，于是这条路径在本机永远被误判。**

后果不是标签好看与否：文档承诺「TIMEOUT → 回执 CANCELED → **凭 task_id 幂等重派**」，
实际得到「FAILED → 重派上限 1 次后硬停」；`dispatch-run` 本该退 124 也退了 0，
上层同样分辨不出。跑得慢的外部 CLI 会被当成跑挂的。

**🔴 修法不是「把 143 也算超时」。** 143 同样来自「外部把整条命令 kill 了」——编排者所在
会话超时就是这样（本次验证中实际发生过一次）。只看退出码则两种情形不可区分：要么漏判超时，
要么把外部中断误判成超时而去自动重派。故让 watchdog **留下自己开过枪的凭据**（marker 文件），
命中即把 rc 归一成 124，与 GNU timeout 分支共用同一套判据。

**实测（同一场景修前修后各跑一次）：**
修前 `outcome=FAILED exit=143` → 回执 `FAILED`；修后 `outcome=TIMEOUT exit=124` →
回执 `CANCELED`，`dispatch-run` 退 124。四处对齐。

**同批验证的其余失败路径（均符合文档，无需修）：** exit 0 但产物缺失 → `FAILED`
（「礼貌地失败」不会被当成通过）· `waiting:"auth"` → `AUTH_REQUIRED` 硬停（退出码 3）·
空证据 verdict → 回执层 COMPLETED 但机件 #3 内容门拒收 → `ARTIFACT_INVALID`（退出码 4）·
`waiting` 取值非法 → `ARTIFACT_INVALID`。

---

## v1.4.0 — 2026-07-26（框架版本化：从「复制模板」到「有版本、可对账、可升级」）

**来源：** 用户要把控制台做成完整的 agent 编排产品体验——看得到模式、切得动模式、能建项目、
「尽量减少通过终端命令复制 harness 规则」。四块拼图（模式画像 / 签名意图切换 / 控制台建项目 /
框架版本化）中，用户裁决**先做 P4 框架版本化**——它是另外三块的地基：没有版本号，
就无从谈升级、兼容与远程操作。

**病灶：`bootstrap.sh` 是一次性复制。** 项目从此冻结在 bootstrap 当天的版本，且没人知道
是哪天；升级只能手工重铺，而重铺会**静默盖掉**你对框架文件的本地改动；控制台更无从展示
「这个项目跑的是哪版框架」。实测量化：存量项目 minigame **缺 93 个机件**——整个
`autonomous/` `dispatch/` `console/` 都没有，而项目自己毫不知情。

**形态：物化文件 + 清单 + 校验和。** 不能把框架文件挪进 submodule / 包 / 软链——
Claude Code 要在固定路径直接看见 `.claude/hooks/*.sh` 与根目录角色文件，间接层会把
hook 路径、Windows、`@harness-rules.md` 引用一起弄断。所以版本化落在**账本**上：
`harness.json`（来源 + 版本 + commit）与 `harness.lock`（受管文件清单）。

**🔴 lock 里每个文件记双 sha，这是整套设计的关键：**
`sha256` = 项目里该文件上次对齐时的内容；`upstream` = 它当时对齐到的上游原文。
两者不等 = **有意的本地定制**。第一版只记一个 sha，结果**冲突没有出口**——人工合并之后
文件仍然既异于基准线又异于上游，`sync` 永远判冲突，无限循环。`upstream` 字段与
`resolve` 子命令就是为此而生。

**两类文件，边界写死：** `managed`（框架拥有：角色文件 · `.claude/**` · `framework/**` 镜像）
升级时同步、本地改过则报冲突；`seeded`（`CLAUDE.md` · `progress.json` · `.auto-memory/**` ·
`framework/proposed-learnings.md`）只在 init 铺一次，**此后永不触碰**。

**🔴 冲突时整次升级不执行**，只把新版原文放到 `<file>.harness-new`。理由：半升级状态最难
排查——一半文件是新版语义、一半是旧版，而 lock 会声称升级成功。同源的另一条克制：
新版已移除的受管文件**只从 lock 摘除、不删项目里的文件**，静默删除比留孤儿文件危险得多。

**新增：** `VERSION`（1.4.0）· `templates/claude/harness.sh`（init / status / verify / sync /
resolve / adopt，随 bootstrap 铺成 `.claude/harness.sh`）· `harness/framework-versioning.md`。
`bootstrap.sh` 降为薄封装——flat 布局先把源树搬进临时目录再铺回来（源与目标同目录时直接铺
会自噬：init 要把源镜像进 `framework/`）；对存量项目直接拒绝并指向 `adopt`。

**实测全流程：** 新项目 init（122 受管 / 13 项目自有，骨架齐）→ 本地改一个文件 + 删一个 →
`verify` 准确报出 modified / missing → 造一个 v1.4.0 源树（含与本地改动撞车的文件）→
`verify` 报 conflict/outdated/new → `sync` 遇冲突**整次拒绝且项目文件零改动** →
`resolve` 后重跑 sync 成功且**本地定制被保留** → `bootstrap.sh` 走 degit 路径端到端通过 →
存量项目副本 `adopt` 如实记录 29 个受管文件、22 处本地差异、93 个缺失机件。

**下一步（未做）：** P1 模式画像（agent 上报 `framework.version` + 漂移 + 各模式开关状态，
控制台渲染成项目卡片）· P2 签名意图（控制台发起、机器验签后在阶段边界应用）·
P3 控制台建项目。用户已裁决：执行者为**扩权后的 device agent**；远程可切范围含软配置、
自主模式开关、建项目/框架升级；**护栏类（deny-list / 沙箱 / console.pub）保留本机人工**。

---

## v1.3.3 — 2026-07-25（本机批准不依赖控制台 —— 控制台降回辅助工具）

**来源：** 用户裁决——「确保本机批准和开发不依赖控制台，控制台只是辅助工具」。
这同时修掉 v1.3.2 记录的那个未决缺陷。

**问题的实质不是脚本坏了，是依赖方向反了。** v1.3.1 引入验签模式后，能签名的只有控制台，
于是「人类能否批准」事实上变成了「控制台是否在线」——把红线「推进键在机器侧」交给了一个
可用性组件。`approve-gate.sh` 写的无签名 decision 一律被 guard 拒收（且脚本还谎报成功并
已 commit，留下一条注定卡死批次的记录），只是这个反转最刺眼的表现。

**修法：私钥有两个平等的持有者，控制台只是其中之一。** `approve-gate.sh` 现在在两种模式下
都自足：无 `console.pub` 写明文 + 比对 HEAD；有 `console.pub` 就**本机用私钥签名**
（openssl，与控制台服务端逐字节等价）。私钥按序探测 `--key <路径>` → `$HARNESS_CONSOLE_KEY`
→ `~/.harness-console/console.key`，并支持 `--key keychain:<服务名>` 从 macOS 钥匙串取。

**三条 fail-closed，全部在落盘/提交之前：** 拿不到私钥当场退出（`progress.json` 一字节不改）·
私钥与仓库 `console.pub` 不成对则拒签 · 写完先自检。

**🔴 自检时机必须按模式分开——这是实现时踩到的。** 第一版在提交前统一跑 guard，
结果**打断了未配 `console.pub` 的项目**：比对 HEAD 模式的判据就是「decision 是否随 HEAD
到达」，提交前跑必然失败。改为：验签模式**提交前**查（判据是签名，与 commit 无关，
坏批准一步都不落盘）；比对 HEAD 模式**提交后**查，不通过时给出确切回退命令而**不自动改写
历史**（改写历史可能连带别人的改动，比留下一条坏 decision 更危险）。

**另一处实现缺陷（`set -u` + 多字节）：** `"…（存在 $PUB），…"` 里 bash 把全角括号的字节
并进了变量名，`set -u` 下直接炸成 `unbound variable`——而这行正是「拿不到私钥时的报错」，
最不该炸的地方。全脚本已把紧邻非 ASCII 字符的变量引用统一加花括号。

**文档：** 新增 §0「控制台是辅助工具，不是依赖」与 §3.3「本机批准不依赖控制台」；
红线加第 5 条（任何把「控制台可达」变成前提的改动，先改红线再说）；
guard 的成功文案从「控制台签发」改为「由持私钥者签发」——签名只证明持有私钥，
而合法持有者有两个。

**⚠️ 如实记下残余风险：** 私钥放在本机文件里，同机运行的 agent 原则上也读得到，
「agent 伪造不了签名」就退化成文件权限 + 你对 agent 的约束。要拿回这条保证，
把私钥放进钥匙串并要求每次确认（`-T ""`）：无人值守的 agent 过不了系统授权框，你本人过得去。
**这是「本机自足」与「同机 agent 无法自我盖章」之间的真实取舍，不做粉饰。**

**实测 6 项：** 本机签名批准通（guard 验签放行）· 驳回路径同样签名 · 拿不到私钥当场拒且
`progress.json` 未被改动 · 拿错密钥拒 · 未配 `console.pub` 的项目原路径不回归（无签名 +
提交后比对 HEAD 放行）· 终版脚本复验。

---

## v1.3.2 — 2026-07-25（中继通道实装：控制台零 git 权限地把批准送到机器上）

**来源：** v1.3.1 把验签模式做出来之后，「控制台 → device agent → 本机落盘」这条通道才成立；
本次把它真正接通（实现落在 tokenizer 工程，框架这边只规定契约并同步文档）。

**为什么值得多一条通道 —— 通道 A 的三个代价：** 原设计「传输就是 git」要求控制台
①持有各项目的 push 权限 ②为每个项目维护本地克隆 ③能连到 remote。第①条是长期凭据，
而控制台是**唯一持有它**的组件；一旦要覆盖内网/NAT 后的机器，还得额外开入站。

**通道 B 的形状：** 控制台只**签发**一条带签名的决策；机器上已有的**出站轮询** agent
拉走、验签、写进本机 `progress.json` 并 commit。真相源没有变——决策照样是 git 里的一个
commit，只是搬运工从控制台换成了机器自己。控制台由此只持一把 Ed25519 私钥，不持任何
项目的 git 权限；私钥泄露也比 push 权限泄露**更容易收敛**（换密钥 + 提交新 `console.pub`，
不必去每个 remote 上吊销）。两条通道可并存：配了 `console.pub` 的项目走验签，没配的仍比对 HEAD。

**🔴 通道 B 成立的唯一理由是验签，不是通道本身可信。** 中继的落盘是**本地写入**——
若不验签，任何能调那个 API 的东西（包括机器上写代码的 agent）都能让一条伪造的批准落盘。
故机器侧的实现必须：仓库里没有 `.claude/console/console.pub` 就**拒绝写入**（宁可卡住，
也不落一条无法验证来源的批准），且验签用的规范化实现要与签发侧**同一份**——两份实现漂移
的表现是「批准了却不生效」，极难排查。

**框架侧的契约边界（本次写清）：** 中继实现不在本仓库。框架只规定
①签名载荷的规范化方式（§3.2）②`decision` 字段白名单（schema）③机器侧验签守门。
任何持有出站 agent 的系统都能按这份契约接上。

**中继实现必须满足的四条守门**（缺一条都会把闸门变成摆设，写进 §2/§3.2 的语义里）：
签名有效 · 本机 `pending_gate.id` 与 `decision.gate_id` 一致（陈旧批准不得解锁另一个闸门）·
本机尚无 `decision`（不覆盖）· `progress.json` 无未提交改动（不与状态机正在写的内容打架）。
另：写回只 commit `progress.json` 这一个文件，绝不 `git add -A`。

**文档改动：** `console-mode.md` §2 由「传输就是 git」改写为「两条通道，同一个真相源」；
§4 组件表补中继行 + 契约边界说明；§5 澄清 push 权限**只在通道 A 需要**；
§7 记下「通道 B 已经把 P4 需要的架构反转跑通了一遍」（出站轮询 + per-device 凭据 +
幂等下发 + 回执消费），P4 可照搬这条形状。

**实测（跨仓库接缝，本次补做）：** 用 tokenizer 服务端**真实的**签发代码产出
`/api/harness/decisions` 会下发的载荷（含中文 `note` 与嵌套 `scope`），按中继**完全相同的
写盘方式**（`JSON.stringify(…, null, 2)`）落进一个装了 `console.pub` 的仓库，再跑框架侧
`validate-pending-gate.sh`：合法签发 guard 放行 + schema 通过；篡改 `scope`（把 `once`
改成永久）拒 / 篡改 `note` 拒 / 去掉 `sig` 拒 / 换 `gate_id` 被验签与 schema **双重拦截**。
`gen-console-key.sh` 也在这条链路里实跑。**这条接缝两边的单测都覆盖不到**——
一边只测「我签得对」，另一边只测「我验得严」，中间的字节一致性得这样才验得了。

**实测（生产往返，2026-07-25 当天补完）：** 本机整栈（docker postgres + 真实迁移 +
Next 服务 + 真实 CLI + 装了 `console.pub` 的 git 仓库）与**生产**（token.vpanel.cc，
GitHub Actions 部署）各跑通一次完整往返：举闸门 → agent 上报 → 人在网页点批准 →
服务端 Ed25519 签发 → agent 出站拉取并验签 → 落盘 + `chore(gate): relay …` commit →
框架 guard 放行 → 状态机消费清空 → 服务端回收 `consumedAt`、待批列表归零。

**演练撞出的三处问题（都在中继侧，已修）：**
- **部署根本没给服务端签名私钥**：compose 与 deploy workflow 都漏了这个环境变量，
  照现状部署批准键会永远 503 —— 而本地开发直接 `export` PEM，完全不会暴露。
  连带一个更隐蔽的：`.env` **不支持多行值**，PEM 原文塞进去只读到第一行，
  服务能起、批准键照样 503。私钥改用 **base64 单行**注入。
- **同一个 gate id 被重新举起后控制台永远看不见它**：待批列表按「未消费」过滤，
  而消费过的记录不会复位 —— 机器再次卡在这道闸门上时，人闸门死锁在一道谁也批不到的门上。
  修法：带**更新的 `raised_at`** 重新上报即整行复位（旧批准一并清掉，新的举起要有新的决策）；
  用 `raised_at` 作判据同时挡住反向风险 —— 消费后仍在路上的陈旧上报带同一个 `raised_at`，
  不会把已消费的闸门复活成幽灵待批项。两个方向都在真实链路上验过。
- 一处与本通道无关的本地开发缺陷（`tailwind.config.js` 在 Node ≥23 下崩 dev server）。

**🔴 已知缺陷（当时未修；已在 v1.3.3 修复，见上）：验签模式下 `approve-gate.sh` 是断的。**
它写的是**无签名**的 decision，而验签模式下 guard 一律拒收 —— 但脚本还打印
「✓ 已提交，guard 自动放行」，且**已经 commit**。后果三层：控制台不可用时人类失去
本机批准这条逃生路径；失败要等下一次 agent 写 `progress.json` 触发 hook 才暴露，
报错指向「缺 sig」不易联想到成因；工作区与 HEAD 从此含一条**永远过不了 guard** 的
decision，fail-closed 的 hook 会把该批次卡死，得人工回滚那个 commit。
成因是 v1.3.1 把信任从传输路径搬到内容本身时，`approve-gate.sh` 没跟着搬。
（`console-mode.md` §3.2 已加警示；修法待定，见 §3.2 注。）

---

## v1.3.1 — 2026-07-25（闸门决策 Ed25519 验签模式）

**来源：** 要接「控制台 → device agent → 本机落盘」的中继通道时发现原 guard 拦不住它。

**原模式的信任放在传输路径上。** v1.3 的 guard 比对工作区与 HEAD：`decision` 只有随 HEAD
到达才放行。这等于要求「decision 必须经 git 送达」，于是控制台必须持各项目 push 权限，
且**任何非 git 的送达方式都无法验证**——中继通道因此不成立。

**新模式把信任移到内容本身。** 配了 `.claude/console/console.pub` 即切换为验签模式：
控制台持 Ed25519 私钥签发，机器侧用仓库里的公钥验签。写代码的 agent **读得到公钥、
伪造不了签名**，于是「本地写入」不再可疑。两种模式各自 fail-closed：
配了公钥 → 无签名/签名无效一律拒；未配公钥 → 回退比对 HEAD。

**🔴 必须签全字段。** 载荷 = `decision` 里除 `sig` 外的**全部**字段（键排序、紧凑分隔符、UTF-8）。
只签 `{gate_id, action, by, at}` 会留下缺口：`scope` 未被覆盖，agent 可以把 `once: true`
改成永久授权而**签名依然有效**——实测踩到过。这类「签了一部分」的缺口不会在正常路径上暴露，
只在有人真去改未签字段时才生效，故必须在设计时就钉死，不能等测试发现。

**规范化必须递归排序键。** `scope` 是嵌套对象；只排顶层键时，它同时带 `once` 与 `expires_at`
就会与校验侧 Python 的 `json.dumps(sort_keys=True)` 产出不同字节串——表现为「批准了却不生效」。

**跨语言一致性已验证：** Node（签发侧）与 openssl（校验侧）对同一载荷产生**逐字节相同**
的签名（Ed25519 是确定性签名），互相可验。

**新增：** `gen-console-key.sh`（密钥对生成）；`validate-pending-gate.sh` 双模式；
`pending-gate.schema.json` 的 `decision` 白名单加 `sig`。

**实测 6 项：** 未签名拒 / 合法签发通 / 篡改 `by` 拒 / 换 `gate_id` 双重拦截（schema 与验签
各拦一次）/ 篡改 `scope` 拒 / 篡改 `note` 拒。

---

## v1.3.0 — 2026-07-25（Console Mode：自托管多项目控制台 + 闸门契约）

**来源：** 用户三项裁决——数据边界=全量日志（自托管前提）· 部署=自托管小服务 · 优先级=人闸门优先。

**一条决定形态的红线：控制台不是编排者。** harness 是 hub 形态、状态机唯一持有者、git 是唯一真相源；
控制台若成为 hub 就会撞上「点对点委托无全局工作流概念，链式转委托无人持有全局真相」。
故：**控制台 = 观测面 + 人闸门 UI；编排者仍在机器上；改配置不是下发指令，而是生成一个人类签名的 commit。**
传输就是 git —— 控制台维护各项目本地克隆，不依赖 GitHub API，不引入第二个真相源。

**🔴 先补的地基：闸门此前没有机器可读的表示。** `session_notes` 是散文，`autonomy.last_halt` 只是
事后记录——**没有「人类回写批准、机器再消费」的槽位**，控制台既无从展示也无从批准。
新增 `progress.json.pending_gate`（`.claude/console/pending-gate.schema.json`）。

**核心安全属性 —— `decision` 只有人类/控制台可写：** 它是「人类批准」在 git 里的唯一表示。
agent 若能写，「阶段推进键归人」「L2 需授权」就全部退化成自觉。工具层拦不住
（progress.json 必须允许 agent 写 status），故在**内容层**拦：`validate-pending-gate.sh guard`
比对工作区与 HEAD，`decision` 若是本地新增/修改即拒。
合法路径两条：人类跑 `approve-gate.sh`（走 Bash 不触发 hook，写完即 commit）；
控制台提交后机器 `git pull`，decision 随 HEAD 到达即放行。
另有**陈旧批准防护**：`decision.gate_id` 必须等于 `pending_gate.id`。

**新增（随 bootstrap 铺入 `.claude/console/`）：** `pending-gate.schema.json` ·
`validate-pending-gate.sh`（schema/guard/hook）· `approve-gate.sh`（人类批准 CLI）；
接入 `settings.json` PostToolUse。

**新增（`console/`，自托管服务，不随项目走，bootstrap 归入 `framework/console/`）：**
`server.py`（Python3 stdlib 零依赖）+ `ui.html`（自包含，无 CDN）+ 配置示例。
只写 `pending_gate.decision` 一个字段，不碰 status/features/policy。

**`/autodrive` 接线：** 新增步骤 2.5「消费闸门批准」（只读 decision，绝不写）；
HALT/DONE_PENDING_USER/HANDBACK 三种处置都要**举起 pending_gate**——
没有它控制台就看不见这次停机，通知只是提醒，闸门才是接口。

**实测：** 闸门契约 9 项（自我盖章拒 / 篡改授权边界拒 / 陈旧 gate_id 拒 / 合法批准通 /
消费清空通 / 重复批准拒 …）；控制台端到端（两个假项目 + bare remote）——
状态读取、取证读取、路径穿越拒、docs 外文件拒、批准 commit+push、
**机器侧从 remote 克隆后 guard 放行**（整条链路的接缝）。

**修：** 默认端口 8787 与本机既有服务冲突 → 改 41300（与 a2a runner 41241 同族）；
guard 里 `printf | python3 - <<'PY'` 的 **heredoc 覆盖管道 stdin**，导致 HEAD 恒读成空、
合法批准被误判为本地新增（只在合法路径上暴露）→ 改临时文件传参。

**未实装（设计已定，见 `console-mode.md` §7）：** P3 agent 实时日志上报
（runner 已有事件流，缺 `--report-to`；⚠️ 开启后控制台机器将持久化含凭据片段的日志正文，
须按「持有密钥的系统」对待）；P4 云端跨机调度（需 runner 由 server 反转为出站长连接穿 NAT、
机器注册心跳、per-machine 凭据、派活前断言对端机件在位）。

---

## v1.2.1 — 2026-07-25（Kimi CLI 适配器接入 + 沙箱两项能力补齐 + 修一个自引入缺陷）

**来源：** 用户要求增加对 Kimi CLI 的支持；本机 kimi-code 0.26.0 实测。

**适配器转正：** `adapters/kimi.json`（`_verified: true`）——
`kimi -p {{envelope_json}} --output-format stream-json`。
去偏轮换池由此凑齐 **claude × codex × kimi 三个 model_family**。

**沙箱两项能力补齐（都是 Kimi 逼出来的，对所有适配器通用）：**
- `{{envelope_json}}` 内联投递 —— Kimi 的 prompt 走 argv 字面文本、不读 stdin，
  故新增「把信封**内容**（而非路径）渲染进 argv」的占位符
- **子进程 CWD 固定为 worktree** —— Kimi **没有 `-C`/`--cd` 工作根参数**，只能靠这条约束它。
  同时这是对所有 CLI 的纵深防御：不再依赖各家是否有工作根参数、是否真的遵守

**🔴 修一个 v1.1.1 自引入的缺陷：`sandbox.home_dir` 未做 `~` 展开**（只有 `env_set` 做了）。
此前测试都用绝对路径所以没暴露，**而写进示例注册表的正是 `~/...` 形式**。后果两层：
1. 子进程把 `HOME` 当相对路径 → 在 CWD 下造出字面量 `~/` 垃圾目录
   （实测中被 CWD 锁定挡在一次性 worktree 内，没碰到主仓——反过来印证了该加固的价值）
2. **更要命：** dotfile 的 fail-closed 断言会去检查一个不存在的相对路径 → **静默通过**，
   等于 L1「专用空 HOME」这道护栏被悄悄削掉

修法：展开 `~` 并绝对化；且「必须以 `/` 或 `~` 开头」的判据放在展开**之前**——
`abspath` 会把相对路径也变成绝对路径，判据放在之后等于没判（第一版就踩了这个，已纠正）。

**安全姿态记录（写进 `local-cli.md` §7.2）：** Codex 有 `-s workspace-write` 这一厂商自带的
沙箱级别作为第二道防线，显式传参还能覆盖用户 config 的削弱；**Kimi 在非交互模式下没有任何
可配的权限层**——`--auto` 与 `--yolo` 均报 `Cannot combine --prompt with ...`，而 `-p` 单独运行
**已隐式自动批准工具使用**（实测无旗标即创建文件、跑命令）。派 Kimi 时机件 #7 的进程级四道锁
加 CWD 锁定是**唯一防线，没有兜底**。

**演练：** 同一植入缺陷场景（`slugify` 未剥离首尾连字符），Kimi 自写测试、运行、判 `PARTIAL`，
证据不仅给出实际值 `-hi-` vs 期望 `hi`，还定位到 `src/slugify.js:3` 并解释成因。169s，
四道锁全守（凭据零泄漏 / 无 push / `src/` 未动 / 主仓零污染）。**修复后重跑终验**——
`_verified: true` 必须是对实际发布的代码验证过。

**补接一处文档与机件的不一致：** `validate-dispatch.sh` 的 family 互斥校验在 `harness-rules.md`
守门表与 `dispatch-mode.md` §3.2 里写的是「PostToolUse hook」，但**从未接进 `templates/claude/settings.json`**
——那道守门此前只能手动跑。这正是框架自己警告的「写在文件里的规则 vs 装进工具链的规则」差距。
现已接入并实测：违规分配退出码 2（Claude 当场看到报错）、无关文件放行、未装 dispatch 的项目完全 inert。

**未做：** Gemini 适配器（本机未装 gemini CLI，未实测的适配器不写进模板）；
Kimi 的执行 shell 未观测到（`stream-json` 事件不暴露），按最坏情况处理即专用空 HOME 照样必填；
`waiting` 路径同 Codex 仍未经真实 CLI 触发。

---

## v1.2.0 — 2026-07-25（a2a transport 实装：真异步 / taskId 重订阅 / SSE 推送）

**来源：** 用户确认做到 C 档（loopback 异步 + 局域网跨机 + SSE 推送）。

**一处认知修正（影响可行性判断）：** v1.1 写「今天现成的对端 ≈ ADK 系」是站在「找别人现成的
A2A server」角度。实际上 shim 只能自己写，而**自己写意味着两端都由我们控制**——由此推出
`dispatch-mode.md` 的 **R4「沙箱在 a2a 下整体失效」对自建 runner 不成立**：runner 跑在哪台机器，
就在哪台机器调本地 `sandbox-profile.sh`，机件 #7 四道锁一条不少。R4 仅适用于我们不控制的第三方对端。

**新增：**
- `transports/a2a-runner.py` —— 把一次性 CLI 包成长驻 A2A 服务端（Python 3 stdlib，零依赖）。
  JSON-RPC：`SendMessage` / `GetTask` / `ListTasks` / `CancelTask` / `SubscribeToTask`(SSE)；
  Agent Card 由 descriptor 生成；**task store 落盘**（taskId 重订阅只有持久化才是真的）；
  事件 jsonl 带单调 seq，支持 `Last-Event-ID` 断线重放；重启时孤儿 `WORKING` 标 FAILED 而非永远挂着
- `transports/a2a-client.py` —— 编排者侧 hub client。`run`/`send`/`subscribe`/`get`/`cancel`/`card`/`ls`
- `dispatch-run.sh` —— **统一派活入口**，按 `descriptor.transport` 路由。两条路径输出同形 run-meta，
  于是回执推断表、gate-arbiter、`/autodrive` 一行都不用改

**修改：**
- `gate-arbiter.workflow.js`：判据从 `transport === 'local-cli'` 改为 `!== 'subagent'`，
  dispatcher subagent 改调 `dispatch-run.sh` → **引擎侧完全不感知 transport**
- `/autodrive` 步骤 0 增 a2a 断言：`<endpoint>/health` 通 + token 环境变量已设。
  runner 不在 = 无人值守期间派活必然全数 FAILED，宁可开车前就停
- `bootstrap.sh` chmod `transports/*.py`

**三条安全设计：**
1. **鉴权 fail-closed** —— `HARNESS_A2A_TOKEN` 未设时只允许绑 loopback；绑 `0.0.0.0` 无 token 拒绝启动
2. **远端自述只是参考，权威判定在本地** —— runner 的 state 写进 run-meta 的 `remote_state_advisory`
   仅供取证；客户端把产物写到本地后由调用方对**本地副本**重跑 `validate-dispatch.sh receipt`。
   跨机器场景下这是唯一诚实的做法
3. **产物必须内联回传** —— 跨机器时客户端读不到 runner 的文件系统。这是 a2a 与 local-cli 唯一的
   实质差异，也是 A2A 把 Artifact 设计成消息负载而非路径的原因

**一个实测修掉的协议瑕疵：** 执行侧「先写终态记录、再发事件」，若 SSE 以 `state` 为收流判据，
会在最后一个 status 事件写盘前就发 `done`——**直播订阅者永远收不到终态事件**（重放才看得到）。
改为以独立的 `events_complete` 标志收流，并在收流前做最后一次排空。

**演练（10 项全通）：** 绑 0.0.0.0 无 token 拒启 · 无/错 token 401 · `send` 0.08s 非阻塞（对端任务 4s）·
同 task_id 幂等去重 · 跨会话凭 taskId 取结果 · SSE 四事件实时 · `--resume-from 0` 完整重放 ·
CancelTask · runner 重启后任务存活且孤儿标 FAILED · **真实 Codex 经 a2a 198s 长任务
SSE 全程保活、产物落本地、本地判定 COMPLETED**（再次独立命中植入的缺陷）。

**刻意不做（写进 `transports/a2a.md` §7，避免日后误以为能对接任意第三方）：**
gRPC/REST 绑定、扩展协商、签名 Agent Card 验真、push webhook、OAuth/mTLS。
**产物是「A2A 形状的子集」，不是通过一致性认证的 A2A 实现。**

**未做：** 真实跨机器演练（全部在 loopback 完成，网络路径与 Bearer 鉴权已验证，
但未在两台物理机之间跑过）。

---

## v1.1.1 — 2026-07-25（Dispatch Mode 待建项收口：Codex 适配器实测转正 + 沙箱加固）

**来源：** 本机 codex-cli 0.145.0 端到端演练（`local-cli.md` §7.1 核对记录）。

**🔴 安全发现（实测，非推演）——登录 shell 击穿 env 白名单：**
外部 CLI 普遍用**登录 shell** 执行命令（Codex 用 `/bin/zsh -lc`），登录 shell 会 source
`~/.zshenv` / `~/.zprofile`——其中任何 `export` 都会把 `env -i` 刚剥掉的变量**原样还回子进程**。
实测：HOME 指向含 `.zshenv` 的目录时 `DATABASE_URL` / `DEPLOY_TOKEN` 全部复活。
**沙箱第一道锁在未配 `home_dir` 时形同虚设**，而 v1.1 只把它标为「强烈建议」。

**变更（沙箱加固）：**
- `sandbox.home_dir` 对 `transport=local-cli` 升为**硬性前置**，三处 fail-closed：
  schema（`if/then` required）+ `validate-dispatch.sh registry`（拒写）+ `sandbox-profile.sh`（拒跑）
- 沙箱启动断言专用 HOME 内无 `.zshenv/.zprofile/.zlogin/.bashrc/.bash_profile/.profile/.envrc`
- 新增 `sandbox.env_set`（字面注入，支持 `~` 展开）：精确投喂该 CLI 的认证目录
  （如 `CODEX_HOME=~/.codex`），不再需要放行整个真实 HOME → **残余风险 R1 关闭**
- 适配器显式传厂商自己的沙箱参数（`-s workspace-write`），防用户 `~/.codex/config.toml`
  设了 `danger-full-access` 而静默削弱沙箱
- 修 bash 隐患：`$VAR` 紧跟 CJK 全角字符时，bash 在部分 locale 下会把 UTF-8 高位字节并入
  标识符 → `unbound variable`。全脚本 4 处改为 `${VAR}`

**变更（适配器转正）：**
- `adapters/codex.json` 按 codex-cli 0.145.0 实测重写并置 `_verified: true`：
  `codex exec --json --ephemeral -C <wt> -s workspace-write -`；附 `_flags_rationale` /
  `_not_used`（禁用 `--dangerously-bypass-approvals-and-sandbox`；不用 `--output-schema`
  因交付契约是产物文件而非消息）
- `local-cli.md` §7 核对清单扩为 7 条（新增「它用什么 shell」「厂商沙箱参数是否显式传入」两条
  ——正是本次踩到的两个坑），并写入 §7.1 Codex 核对记录、§7.2「未实测的适配器不写进模板」

**变更（`/autodrive` 耐久层四职责接线）：**
- 步骤 0：装了 dispatch 时断言 registry/assignments 合法 + 被引用适配器 `_verified: true`
- 步骤 1：注入 `registry` / `state.head_sha` / `spec_path` / `l2_authorized`（Workflow 无文件系统权限）
- 步骤 6a：外部产物收割（原样复制、不改内容）+ **去偏比对下沉**（外部主验时引擎手上无逐条判定）
- 步骤 6a-3：外部 generator 回流四步（tag 归属 → critic → L1 全绿 → cherry-pick）
- 步骤 7：ledger 加记 `{dispatched_to, model_family, task_id, receipt_state, duration_s}`
- 不变量补两条：deny-list 管不到外部进程 / 外部产物只搬不改

**决策定案 —— 外部 commit 的 tag 不合规：拒收，不 rewrite。**
替对方断言「这个 commit 属于 F003」是一次未经取证的归属判定，与铁律 10 精神相悖，
且会掩盖 scope 漂移信号。代价只是一次唤醒。

**演练结论：** 植入真实缺陷（slugify 未剥离首尾连字符）后派活，Codex 自行编写测试、运行、
精确命中并判 `PARTIAL`（证据含实际 `-hi-` vs 期望 `hi`），267s 完成；四道锁全部守住
（凭据零泄漏 / 主仓零改动 / `src/` 未被动 / 无 push 尝试）。**这条演练同时证明它不是橡皮图章**
——全 PASS 的结果无法区分「真验了」与「没验」。

**未做（诚实列明）：** Gemini 适配器（本机未装 gemini CLI，**未实测的适配器不写进模板**）；
`waiting` 路径未经真实 CLI 触发验证（回执侧已单测）；`/autodrive` 全循环带外部派活的端到端
自主演练；`a2a` transport（设计如此，需真实对端）。

---

## v1.1.0 — 2026-07-25（Dispatch Mode：自动调配异厂商 agent）

**来源：** A2A 协议 v1.0 研究（`docs/a2a-harness-research-2026-07-25.md`，规范三页 + ADK 集成面）
+ 用户四项裁决：对端 = 异构 CLI（Codex 优先）· 交付 = 规范 + 机件模板 · 自动化边界 = 接 autodrive 可逆内环
· 外部 CLI 放开承担 generator。

**触发原因（研究结论中的关键判断）：** 慢车道缺三样——①没有派活抽象 ②没有唤醒信号 ③没有回执与超时。
①是地基且**纯 harness 内、零协议**；②③才需协议栈且只在跨机器时值钱。故本版做①，把 A2A 的语义
（Agent Card / Artifact 分离 / 两个中断态 / 幂等键 / required profile）借来做③的降维版，②留给未来的 a2a transport。
**「自动调配不同 agent」这个目标本身不需要 A2A。**

**变更（新增 `.claude/dispatch/`，默认安装但 inert）：**
- `sandbox-profile.sh` —— **机件 #7 外部 CLI 沙箱契约**。红队级发现：`settings.json` 的 deny-list
  **只约束 Claude Code 自己的工具调用**，对外部 CLI 子进程完全无效（它有自己的权限模型与 shell），
  闸门分类器也看不见（那是阶段内部的工具调用）。工具层拦不住 → 进程层拦：env 白名单（没凭据就花不了钱）·
  独立 worktree · 禁 push（`GIT_CONFIG_*` env 级覆盖——**绝不可用 `git remote set-url`，worktree 与主仓共享 config**）·
  wall-clock 封顶。四道锁均已实测生效
- `agents-registry.schema.json`（L1 descriptor，A2A Agent Card 最小子集）+ `.example.json`
- `dispatch-envelope.schema.json`（L2）—— `additionalProperties:false` 是安全属性不是风格：
  字段白名单使实现叙述**结构上塞不进去**，铁律 12 由模型自觉变为机械强制
- `validate-dispatch.sh` —— registry / envelope / **assignments（family 互斥）** / receipt / hook 五合一
- `transports/local-cli.md` + `adapters/codex.json`（首家，`_verified:false` 待实测）+ `transports/a2a.md`（接口预留，未实装）

**变更（既有机件）：**
- `verdict-artifact.schema.json` + `validate-verdict-artifact.sh` 加 `waiting: auth|adjudication|null`
  —— **中断态降维**：一次性 CLI 进程无法「挂起等你」，故把 A2A 的 `AUTH_REQUIRED`/`INPUT_REQUIRED`
  编码进产物而非进程状态；写完照常 exit 0，编排者读到非空即硬停
- `gate-arbiter.workflow.js`：`build`/`verify` 加 dispatch 分支；机件 #6 去偏从**同家族换档位**升级为
  **跨厂商 family 轮换**；dispatcher subagent 的返回 schema 结构性地不含结论字段（模型在链路上永不携带结论）
- `harness-rules.md`：两条车道 → **三条执行形态**（快车道 / 本地异构 / 慢车道，差异只是 descriptor 的 `transport` 字段）；
  独立性铁则新增第 5 条 **model_family 互斥**；`role_assignments` 约束修订；机制化守门表 +3 行
- `orchestration-patterns.md` §7：外部工具参与从「读 AGENTS.md 自行接手」改为「编排者主动派活」
- `bootstrap.sh`：`.claude/dispatch/*.sh` chmod + `.harness-dispatch/` 入 .gitignore

**关键设计（三条，均来自本次实测或红队推演）：**
1. **不信任对方守规矩，只信任产出能过 schema。** Claude 读 CLAUDE.md、Codex 读 AGENTS.md、Gemini 读 GEMINI.md
   ——三份必然漂移且无法验证是否遵守。故契约**随信封走**（内联常量模板），产出不合 schema 就机械拒收
2. **exit 0 ≠ 完成。** 退出码 0 但产物缺失一律判 FAILED——外部 CLI「礼貌地失败」是常态，
   不写死这条会被当成验收通过。重派上限 1 次，绝不静默无限重跑
3. **放开外部 generator 引入的新洞：** `{generator: builder-codex, evaluator: reviewer-codex}` 是两个不同进程、
   各自 fresh context，**完全满足铁律 4 字面要求**，但同模型自评独立性形同虚设 → 新增 family 互斥硬校验

**安全边界：** 安装 ≠ 启用（无 `.agents-registry.json` 即 inert，快车道行为一字不变）；
外部实例 `constraints.push` 恒 false，产物由编排者校验 commit tag 归属 + spec-lock critic 稽核后才回流主仓；
deploy/prod/spend 永留人类闸门，且**不得依赖 deny-list 拦外部进程**。
**残余风险已明文列出**（`dispatch-mode.md` §5.1 R1-R4：HOME 凭据外溢 / 该 CLI 自身推理花费不受 harness 管控 /
出网未限制 / 沙箱在 a2a 下失效）。

**仍待建（需接真实项目）：** Codex 适配器端到端演练（argv 按当前 CLI 版本核对，清单见 local-cli.md §7）、
`/autodrive` 耐久层四项新职责、外部 generator 回流的 tag rewrite 策略、第二家适配器、a2a transport。

**兼容性：** 全部为新增或向后兼容修订。`gate-arbiter` 无 `args.registry` 时完整回退 v1.0 行为；
历史 `.agents-registry` 纯 id 列表仍兼容读取（但无法派活给外部实例）。状态机 7 状态与既有字段未变。

---

## v1.0.3 — 2026-07-13（自主开发模式 + 进度看板：默认安装）

**来源：** 单工具 Claude + dynamic Workflow 工作流下两项能力落地，用户确认默认安装。
- 自主开发模式：design workflow `w05dglv38`（4 立场架构师 → 4 评委对抗打分 → 红队攻击领先方案 S2 Heartbeat）
- 进度看板：Claude Artifact 快照（CSP 禁 fetch → 阶段边界重渲染 + 重发同一 URL）

**变更（自主开发模式，默认安装到 `.claude/`）：**
- `templates/claude/agents/generator-restricted.md`（机件 #0 受限 generator，配 deny-list）、`spec-lock-critic.md`（机件 #2 越界稽核，只读只判）
- `templates/claude/skills/autodrive/SKILL.md`（Dispatcher / §4 单次唤醒指令周期，前置断言 fail-closed）
- `templates/claude/autonomous/`：`gate-arbiter.workflow.js`（机件 #4 纯函数 governor/闸门 + #2/#3/#5/#6 嫁接）、`autonomy-policy.schema.json` + `validate-autonomy-policy.sh`（机件 #1）、`verdict-artifact.schema.json` + `validate-verdict-artifact.sh`（机件 #3）、`settings.autodrive.json`（deny-list，开启自主时人类手动合入）、`progress.autonomy-fields.md`（机件 #5，默认不铺 progress.init.json）
- `harness/autonomous-mode.md` 规范文档（T2）；`bootstrap.sh` 加 `.claude/autonomous/*.sh` chmod
- **安全边界：** 安装 ≠ 开启；开启需人类建 `autonomy-policy.json` + 显式 `/autodrive`（步骤 0 前置断言机件/策略，否则 HARD_HALT）；deploy/prod/spend 永留人类闸门（工具层 deny-list，非闸门分类器）
- **仍待建（需接真实项目）：** §9 并发锁 / 存活告警运行时、gate-arbiter build/plan 接真实 `/build` `/plan`、端到端演练

**变更（进度看板，默认安装）：**
- `templates/dashboard.template.html`（内联 CSS 自包含渲染骨架，禁 fetch/外链）+ `templates/claude/skills/dashboard/SKILL.md`（`/dashboard`：读状态 → 套模板 → 首发写回 `dashboard_url` / 后续传 `url` 更新同一 Artifact）
- `progress.init.json` 加 `dashboard_url: null`；`harness-rules.md §四` + `templates/CLAUDE.md` 各加"阶段边界顺手刷看板"
- 看板是**只读镜像非真相源**；默认私有，可分享只读链接给非技术干系人

**兼容性：** 均为新增，不改状态机 7 状态 / 既有字段 / 角色协议。自主模式默认不开启（无 policy 即 inert）。存量项目重跑 bootstrap 或增量拷贝 `.claude/` 即得。

---

## v1.0.2 — 2026-07-12（orchestration §8：Workflow ⇄ progress.json 日志契约）

**来源：** 单工具 Claude + dynamic Workflow 工作流契合度评估（本会话 workflow wt27gd5xu，三视角 + 红队对抗复核）。用户已把主 coding 工作流收敛到单工具、编码阶段用 dynamic Workflow 编排；评估确认 harness 高契合，但把"阶段内部编排"交给引擎需先定交接契约，否则引入正确性回归。

**触发原因（红队暴露的两类回归 + 一处恢复盲区）：**
- Workflow 的 loop-until-done 天生自主推进到"完成"，会越过 orchestration §6 硬铁律「→verifying/→done 不得无人值守自动完成」的用户闸门 → 正确性回归
- in-tool Workflow 若只在 context 里验完、不落命名验收工件，`proposed-learnings.md` 会因无 emitter 而**静默饿死**（本文件当时已现"当前无待确认提案"征兆）→ 框架自我进化引擎停摆
- fan-out 途中崩溃（5 条验了 3 条）留下 progress.json 不表示的中间态 → 断点恢复铁律未贯彻到阶段内部

**变更：**
- `harness/orchestration-patterns.md` 新增 §8「Workflow run ⇄ progress.json 日志契约」：① 引擎不得自主越阶段边界（return 交还用户闸门）② 状态机械原样回写（铁律 12）③ 每验完一条即落盘 features.json 抗中途崩溃 ④ 每轮产出命名验收工件 `{BL-id, verdict, fix_round, 证据摘要}` 回喂沉淀；文末版本历史补 2026-07-12 行

**兼容性：** 纯新增文档小节，不改状态机 / 字段 / 既有编排语义。相关但未纳入本版的提案（/verify /build skill 真正 invoke Workflow、慢车道拆分、快车道热路径剥离、存量项目接入等）留在 `proposed-learnings.md` 待后续确认。

---

## v1.0.1 — 2026-07-12（patterns/deploy §7 不可逆生产迁移剧本）

**来源：** aigcgateway BL-PROD-MIGRATE-DEPLOYSVR（生产从 GCP 原生 PM2 `34.180.93.185` 迁到 deploysvr `194.238.26.173` 容器化，用户手工验收通过）。

**变更：**
- `patterns/deploy-patterns.md` 新增 §7「不可逆生产迁移（换机 / 换部署模型）」：
  - §7.1 四段剧本：并行演练（灌生产快照冒烟，旧机不动）→ 可逆预置（DNS-01 签证/装 vhost/`curl --resolve` 绕 DNS 验公网可达）→ 最短停机窗口（停写→数据终态 drop schema+restore→切 DNS，逐门禁 go/no-go）→ 回滚就绪（旧机冻结 + 旧值留档 + 多服务机退役单列）+ Planner spec checklist
  - §7.2 凭据一致性红线：解密 DB 的密钥（ENCRYPTION_KEY 等）必须与源机 sha256 逐字一致（跨机比对只传 hash）；配套 env_file 引号坑（bash source 的带引号值迁到 compose env_file 被当字面量）
  - §7.3 容器化 Next.js standalone HOSTNAME 坑：默认绑 `$HOSTNAME`（Docker 注入容器 ID）→ 容器内 127.0.0.1 不监听、healthcheck ECONNREFUSED（但发布端口经 docker-proxy 仍可达，掩盖问题）→ compose `HOSTNAME=0.0.0.0`
- `patterns/README.md` deploy-patterns 触发条件补「换机/换部署模型迁移、容器化(Docker compose)、Next.js standalone 部署」

---

## v1.0.0 — 2026-07-09（Claude Code 时代重构：上下文隔离 + 两条车道 + 机制化守门 + 目录分层）

**来源：** 用户发起的框架全面升级审计（2026-07-09），四项决议：混合模式 Evaluator / v1.0 重构 / 编排三模式（Workflow 编排 + 灵活日常流 + /loop 自排程）/ BL-064 提案闭环。

**触发原因（v0.x 已过时的点）：**
- 双工具架构假设（Codex 专职 Evaluator + 3099 端口 / PTY 启动 / 方向 B 限制）——Claude Code 已原生支持 fresh-context subagent 与多 agent 编排，「无自评」的实现基础从「第二个产品」变为「上下文隔离」
- 铁律 3「上下文不足 20% 保存进度重启会话」——上下文自动压缩续接已成标配，人为中断不再必要
- 角色加载 = 模型自觉读 md 文件、JSON 校验寄望手动 pre-commit——hooks / skills / subagent 定义可将约束机制化（cowork-constraint-design.md 当年无解的「知情自律」问题现有技术强制层）
- 串行执行假设——独立 feature 并行实现（worktree）与 fan-out 验收 + 对抗复核已可行
- README 引用的 docs/01-03 与 INIT.md 长期缺失；evaluator.md / generator.md 章节编号重复

**变更（架构）：**
- `harness/harness-rules.md` 重写：新增「角色与执行形态」（快车道 = 同会话，Evaluator 以隔离 subagent 运行；慢车道 = git 总线，跨机器/跨工具照旧）+「独立性铁则」（fresh context / 评估基于实物 / 结论原样落盘 / 不改产品代码）+「机制化守门」章节；铁律 3 改为「阶段边界状态落盘 + 信任压缩续跑」；铁律 11 改为 hook 机制化优先；新增铁律 12（编排者不得污染 evaluator 输入、不得改写其结论）；`executor:"codex"` 更名 `"evaluator"`（旧值作别名兼容）；`.agent-id` 格式 `main:`/`evaluator:`（`cli:`/`codex:` 兼容）
- `harness/orchestration-patterns.md` 新增：角色↔机制映射（plan mode / subagent / worktree）、快车道标准流、并行 building 判定与汇合、fan-out 验收 + 对抗复核三阶段、Workflow 脚本场景（审计 loop-until-dry / 迁移 pipeline）、后台 CI 与 /loop 自排程纪律（无人值守不得自动切阶段）、模型分层建议、慢车道保留场景
- **目录分层**：新建 `patterns/`（技术域经验库，触发条件命中才读，含索引 README）——deploy / database / ai-action-contract / ui-fidelity / i18n / material-symbols 自 harness/ 迁入；generator.md §8-§9 抽出为 `patterns/web-runtime-patterns.md`；evaluator.md §13-§16/§18-§19 抽出为 `patterns/testing-env-patterns.md`。harness/ 只保留状态机 + 角色协议 + 编排 + 裁决模式
- `templates/claude/` 新增（bootstrap 装配到项目 `.claude/`）：SessionStart 状态注入 hook + PostToolUse 状态 JSON 校验 hook（铁律 11 机制化）+ `agents/evaluator.md` 隔离验收 subagent 定义 + `/plan` `/build` `/verify` 角色技能入口
- `templates/AGENTS.md` 重写为工具无关的「独立 evaluator 实例」指令（agents.md 业界惯例），Codex 沙箱细节移除；`templates/CLAUDE.md` 更新启动流程与技能入口
- 角色文件修订：planner.md 去工具耦合 + 新增 §6.5 车道与编排确认 + plan mode 提示（铁律 1-9 与裁决规则全保留）；generator.md 新增并行执行说明 + CI 后台 watch + 状态持久化检查点（替代 20% 规则）+ 修复重复编号；evaluator.md 新增执行形态章节 + 修复重复编号（§3/§4 各出现两次 → 顺序编号）+ 清除 aigcgateway 项目残留引用
- **补齐缺失文件**：INIT.md（初始化引导，README/bootstrap 引用两个月的悬空引用）+ docs/01-concepts.md / 02-usage.md / 03-quickstart.md；README 重写反映 v1.0；bootstrap.sh 装配 .claude/ + 归整 patterns/ 与 framework docs；repo 根 .gitignore 新增（.obsidian/ / .DS_Store）

**变更（沉淀闭环）：**
- BL-064 提案（2026-05-11 挂起）闭环：IA refactor redirect scope 按 destination wire-readiness 评估 → 写入 `memory/role-context/generator.md` + `memory/role-context/planner.md`，归档 `archive/proposed-learnings-archive-v1.0.md`

**兼容性：** 状态机 7 状态、progress.json/features.json 字段、L1/L2 分层、记忆 T0/T1/T2、签收/backlog/role_assignments 约定均不变。存量 v0.x 项目无需迁移即可继续运行（codex/cli 别名兼容）；建议增量采纳：拷贝 `.claude/` 模板 + 替换 harness 角色文件。

---

## v0.9.23 — 2026-07-03（aigcgateway BL-SYNC-ADAPTERTYPE-FALLBACK 沉淀，2 条 learnings）

**来源批次：**
- aigcgateway BL-SYNC-ADAPTERTYPE-FALLBACK（后台新增 provider guangtech 模型同步失败根治，fix_rounds=1）

**触发原因：**
- 首轮 FAIL：spec D2 断言适配器返回的 `SyncedModel.name`（带 `provider/` 前缀）会入库，但 `reconcile()` 的 `resolveCanonicalName(modelId)` 丢弃它、直接存裸 modelId → 命名前缀从未落库 → fix-round-1。
- fix-round-1 部署坑：部署后 boot sync 立即用新命名逻辑跑，在旧裸名数据 + 新前缀逻辑间建了 6 个 orphan 模型 → 数据修复脚本需自愈 orphan。

**变更：**
- `harness/planner.md` §铁律 9：spec 断言某值"写入 DB / 流向下游"前必须追踪实际写入路径（grep 落点列反查真实来源，警惕 canonical/reconcile/transform 中间层重算/丢弃；铁律 1 向数据流终点维度扩展）。
- `harness/deploy-patterns.md` §6：数据命名/结构变更类修复——部署会立即触发 on-boot 后台任务产生 orphan/中间态，须配套幂等数据修复脚本（自愈 orphan + 先部署后修数据 + dry-run 默认 + Reviewer 复验 dry-run=0）。

---

## v0.9.22 — 2026-06-14（aigcgateway BL-VISION-INPUT 沉淀，1 条 learning）

**来源批次：**
- aigcgateway BL-VISION-INPUT（网关图片输入/vision，一轮通过，fix_rounds=0）

**触发原因：**
- L2 首轮图片输入 E2E 返回 400，排查后发现是测试图坏了（wikipedia 缩略图 URL 返回 HTML 错误页而非 JPEG，被 base64 后上游正确判 invalid image）——坏 fixture 伪装成产品 bug，换真实 JPEG 后全 200。

**变更：**
- `harness/evaluator.md` §2 编写测试：新增「测试素材校验」——E2E fixture（图片/URL/文件）必须先用 `file`/magic-bytes 确认是预期 content-type 再断言上游行为；URL 选上游可达稳定源；优先自带 base64 而非外部 fetch。

---

## v0.9.21 — 2026-06-05（aigcgateway BL-IMG-PERSIST-GCS 沉淀，2 条 learnings）

**来源批次：**
- aigcgateway BL-IMG-PERSIST-GCS（生产图片无法下载根治，fix_rounds=2）

**触发原因：**
- fix_round1：图片签名代理 URL 的 origin 被签成 `0.0.0.0:3000`（Next standalone `request.url` 取监听地址、无视 Host 头）→ 客户端不可达 → Codex FAIL
- fix_round2：spec acceptance 要求 seedream-3 做 http 上游 E2E，但该模型 realModelId 未配 ep-ID（火山恒 404）且本就在下线名单 → 验收返工

**变更：**
- 新增 `harness/planner.md` §铁律 8：spec 引用外部模型/服务做 E2E acceptance 前必须验证其真实可用（本地 enabled ≠ 运行时可用；火山须 ep-ID + 非下线名单）
- 新增 `harness/generator.md` §9：Next.js standalone 模式 `request.url` 的 origin 取监听地址，反代后构造对外绝对 URL 须从 `X-Forwarded-Host`/`X-Forwarded-Proto` 推导（附 `resolveRequestOrigin` 范式 + nginx 前置确认）

> 注：本条同步发现 aigcgateway 旧线（v0.9.6–v0.9.10，铁律 1.1–1.8 等）未并入本 canonical 线，暂存于 aigcgateway clone 的 `backup-local-v0.9.5-line-20260605` 分支，待后续单独 reconcile。

---

## v0.9.20 — 2026-05-10（BL-060 沉淀，2 条 learnings）

**来源批次：**
- BL-060-soft-delete-ui-filter-hotfix（fix-round 1→2 e2e suite-isolation 诊断）
- BL-061-apify-fork-totallikes-verify（F003 SQL cross-tenant RLS 注意）

**触发原因：**
- BL-060 fix-round 1 单点放宽 timeout/正则只缓解症状，整组 E2E 仍 FAIL；fix-round 2 抽 storageState 后 suite PASS — suite-level isolation 诊断模式值得沉淀
- BL-061 F003 验收时 Reviewer 用 kolmatrix_app role 跨 tenant 查 audit_log 返回 0 行，误判为数据缺失；实际是 RLS 视角限制 — superuser bypass 规则值得沉淀

**变更：**
- 修改 `framework/harness/evaluator.md`：新增 §18 "E2E suite 稳定性诊断" + §19 "SQL 跨 tenant 全量查询 RLS 注意"
- 同步写入 `.auto-memory/role-context/evaluator.md` + `.auto-memory/role-context/generator.md`

---

## v0.9.19 — 2026-05-08（BL-012 F002 fix-round 2 沉淀，1 条 learning）

**来源批次：**
- BL-012-apify-kol-integration F002 fix-round 2 (commit `894a303`) — 用户 5/8 19:00 prod 实地审视报告 zod safeParse 41 fields error
- 触发：F002 ApifyKolItemSchema 严格化（`externalUrls: z.array(z.string())` + `aggregatorLinks: z.record(...)`）通过单测但与 prod 真数据 fork 端 fork 实物 union shape 不一致

**触发原因：**
- v0.9.14 铁律 1 已覆盖"spec / audit 起草前 grep 实物状态"，但**对外部 API response shape 仍存在盲区** — 文档注释含糊（如 "多外链原结构"）是 union 信号，audit 阶段未 SSH 拉真数据 row sample 验证 → spec / zod schema 严格化 → prod 真数据触发 parse error
- 单测 mock 用文档假设 string array shape 全过 → Reviewer signoff PASS → 直到 prod 真数据 50 KOL 中 41 row externalUrls 是 `[{url, title}]` 触发 zod safeParse 失败 → preview 页加载失败
- BL-012 5/8 19:00 → 19:13 fix-round 2 实战：union schema + passthrough + 2 单测覆盖 → reverify PASS

**变更：**
- 修改 `framework/harness/planner.md` 铁律 1 检查矩阵：新增 1 行（v0.9.19）— 「外部 API response zod schema（fork / 第三方 / 跨服务 GET 响应）」核查动作 `SSH 拉 ≥5-10 真数据 row sample` + `JSON parse 验证 zod schema 兼容` + 文档注释含 union 信号必须 `z.union([...]) + .passthrough()`；含 BL-012 F002 案例
- 归档 `framework/archive/proposed-learnings-archive-v0.9.19.md`（含完整候选 + BL-012 F002 5/8 19:00→19:13 时间线 + zod schema before/after 对比）

---

## v0.9.18 — 2026-05-08（BL-012 F001 fix-round 1 沉淀，1 条 learning）

**来源批次：**
- BL-012-apify-kol-integration F001 fix-round 1 (commit `4b4ae96`) — Reviewer 5/8 15:32 verifying 报 admin auth gate role mismatch
- 触发：F001 spec 写 `session?.user?.role === 'admin'` 通过单测（mock 用 `'admin'` 字面），但 staging seed 真实创建 `tenant_admin` 角色 → admin 真账户访问 /[locale]/admin/apify-preview 被踢回 dashboard

**触发原因：**
- v0.9.14 铁律 1 已覆盖"spec 起草前 grep 实物代码状态"，但**对 auth role / 权限 enum / DB schema 字段值仍存在盲区** — Spec 起草 / 实装时若依赖字面字符串 `'admin'` / `'user'` 等假设而非 `grep auth.ts / src/lib/auth/ / schema.prisma / seed.ts` 实物核查，会撞真实 enum 不匹配
- KOLMatrix architecture.md §3.3 明示 enum 是 `platform_admin / tenant_admin / marketer / client` 4 值，但 BL-012 F001 spec 起草时假设字面 `'admin'`（业界通用习惯）→ Generator 字面实装通过单测 → staging 真账户访问被踢回 → fix-round 1 修
- BL-012 5/8 ~15:39 fix-round 1 实战：role check 改 `['platform_admin', 'tenant_admin'].includes(role)` + 7 测试 case 含锁 'admin' literal MUST reject 防回归 → reverify PASS

**变更：**
- 修改 `framework/harness/planner.md` 铁律 1 检查矩阵：新增 1 行（v0.9.18）— 「auth role enum / 用户角色 / 权限 enum / DB schema 字段值」核查动作 `grep -rn "role" src/auth.ts src/lib/auth/ prisma/schema.prisma prisma/seed.ts`；含 BL-012 F001 案例
- 归档 `framework/archive/proposed-learnings-archive-v0.9.18.md`（含完整候选 + BL-012 F001 5/8 15:32→15:39 时间线 + role check before/after 对比）

---

## v0.9.17 — 2026-05-08（BL-012 audit 沉淀，1 条 learning）

**来源批次：**
- BL-012-apify-kol-integration v2 spec 修订前 Planner 旁路任务 audit (462 行 docs/reviews/apify-fork-audit-2026-05-08.md)
- 触发：.auto-memory/project-status.md:16 记录 5/7 fork audit 但仓库 0 实物支撑（撞 5/7 fork 实物 Apify→TikHub 全迁移 + 新增 X 平台 4 平台齐全 vs 记忆"3 平台分流"）

**触发原因：**
- 既有 v0.9.14 铁律 1 已覆盖 spec / audit / readiness-report 起草前 grep 实物状态，但**对项目内 `.auto-memory/` 涉及外部协作方的记忆条目**仍存在盲区
- Planner 默认信任记忆 = 信任前一轮写入的快照；但外部协作方 / 第三方仓库可能在记忆写入后被独立更新（5/7 fork 16:57 update vs 5/7 ~14:00 记忆写入 = ~3 小时差，足以让 Apify→TikHub 全迁移 + X 平台新增完成）
- 不沉淀的成本：未来 Planner 起 spec 时盲信记忆 → spec 字面与外部实物脱节 → Generator 撞实物差异 → fix-round / spec 修订成本 / 上线 buffer 浪费
- BL-012 5/8 02:00 Planner 旁路 audit 后用户决议 v2 修订 spec（13 features Stage 1.5 admin preview + 决策门 + Stage 2 真接入）— 是 v0.9.17 在实战中应用的范式

**变更：**
- 修改 `framework/harness/planner.md` 铁律 1 检查矩阵：新增 1 行（v0.9.17）— 「`.auto-memory/project-status.md` / `session_notes` 涉及外部协作方/第三方仓库/跨项目状态的条目」核查动作 `gh api` / `git log --all --since` / `curl health` + 时间戳 ≥3 天必查；含 BL-012 5/7→5/8 实战反面案例段（fork repo 5/7 16:57 update vs 记忆 ~14:00 写入 = stale），追加 v0.9.17 反面案例段
- 归档 `framework/archive/proposed-learnings-archive-v0.9.17.md`（含完整候选 + BL-012 5/7→5/8 时间线 + 与 v0.9.14 铁律 1 关系延伸表）

---

## v0.9.16 — 2026-05-08（BL-052 verifying P5 裁决沉淀，1 条 learning）

**来源批次：**
- BL-052-dashboard-trend-edge-polish（11/11 building done @ commit `3ba3fe2` + Planner P5 裁决 @ commit `4ede09e` + Reviewer signoff PASS @ commit `722fc66`，grade B+/Ready，5/7 17:30 → 5/8 01:07 共 ~7.5h 含裁决等待）
- 触发点：Reviewer 5/7 23:40 partial 报告 grade C / Not ready，失败点 `tests/integration/pre-commit-hook.test.ts` 全套并发抖动（外部网络依赖 Google Fonts woff2 拉取，单文件隔离跑 PASS），与 BL-052 13 commits 范围零交集

**触发原因：**
- 既有 P5 规则只覆盖"裁决理由复用价值"，未明文"acceptance 边界 vs 全套测试基线"的判断流程 — 范围正交的失败若不主动裁决，Reviewer 默认采用"测试不全绿就 Not ready"隐式门槛 → 与 spec § acceptance 列表脱节，会让"修不好就是不能 done"成为评分系统的不可见门槛
- BL-052 实战首次系统应用此模式：git log 追溯（pre-commit-hook 来自 BL-027-F004 + 依赖脚本来自 BL-025-F009 / BIx-mvp-polish-pass）→ 与本批次零交集 → 范围正交确认 → 独立批次 BL-054 治理 → Reviewer 重打分 B+/Ready
- 不沉淀的成本：每次 Reviewer 报全套测试红时 Planner 都要从头复现裁决理由，跨批次复用价值丢失；新 Planner 上手时无现成模板，可能误判"必须修才能 done"导致拖延上线时间线

**变更：**
- 修改 `framework/harness/planner.md` §"Planner 裁决职责"末尾追加 §"规则 P5.2：acceptance 边界 vs 全套测试基线（v0.9.16 新增）"段（含 git log 正交性判断流程命令模板 + 4 项裁决落实模板 + 反面案例 + 适用场景边界 4 行表 + BL-052 实物范例）
- 归档 `framework/archive/proposed-learnings-archive-v0.9.16.md`（含完整候选条目 + BL-052 5/8 00:10 → 01:07 时间线）

---

## v0.9.15 — 2026-05-07（BL-021 F002 撤再翻盘 + BL-049 测试基建 audit 沉淀，2 条 learnings）

**来源批次：**
- BL-021-suspense-critical-paths（F001 Skeleton + 5 critical-path loading.tsx；fix-round 1 真修 AiSuggestionsClient localStorage 跨环境 stub @ commit 9fa2a49 + signoff @ commit da94b73 — 1.4x 加速 3h36min vs spec 2.5h）
- BL-049-test-infra-systematic-upgrade（13 项 audit 发现合并为 X1 / 7 features，F007 即本次沉淀）
- BL-047 backlog 条目历时三拍：5/7 10:30 Planner 起 → Generator 撤（WSL2 forks pool 1043/1043 PASS 误判 premise 错）→ 5/7 11:51 Codex 在 BL-021 reverifying 真复现 → 5/7 13:00 fix-round 1 commit 9fa2a49 真修 → 5/7 13:10 状态 closed-not-reproducible → closed-resolved

**触发原因：**
- v0.9.9 / v0.9.14 铁律 1 已覆盖"spec / audit / readiness-report 起草前 grep 实物状态"，但**对"测试 fail/PASS"类断言**还存在跨环境盲区：Generator 自己 pool 跑 PASS ≠ Reviewer pool 跑 PASS。BL-047 撤再翻盘是直接反例 — vitest forks vs threads pool 启动顺序不同 → stub 初始化时机异 → 同一段代码两环境结果分裂
- BL-049-F002 启用 vitest 4 fileParallelism + maxWorkers=4 后，跨 pool 行为差异更广泛触发；F003 把 visual / chromium 拆 Playwright project 也是同根问题（多 worker 跨环境时序）— 必须把"stub environment-agnostic"作为设计阶段强制项，不留运行时再修

**变更：**
- 修改 `framework/harness/planner.md` 铁律 1 检查矩阵：新增 2 行（v0.9.15 #1 + #2）— 「Backlog/spec 涉及"测试 fail/PASS/覆盖"类断言」+ 「Test fixture / 全局 mock / setupFiles 内 stub 设计」；含实战反面案例段（BL-047 撤再翻盘 + Map-backed localStorage stub @ 9fa2a49 范式）
- 归档 `framework/archive/proposed-learnings-archive-v0.9.15.md`（含 BL-047 完整三拍时间线 + Map-backed stub 实装范式截选）

---

## v0.9.14 — 2026-05-06（BL-040 + BL-041 audit 过期 + BL-043 staging fix 沉淀，2 条 learnings）

**来源批次：**
- BL-040-product-target-audience-required（done @ 2026-05-06，targetAudience NOT NULL 全栈类型清理）
- BL-041 audit 过期发现（dashboard 3 元素已实装但 audit 写"未含"，Planner johnsong 在 BL-040 planning 阶段 grep 发现）
- BL-043 staging .env.staging KOLMATRIX_APP_PASSWORD 修复（2026-05-06 ops by Planner，PM2 delete+sourced start 解 env cache 问题）

**触发原因：**
- Planner johnsong 起 BL-040 planning 时 grep `dashboard/page.tsx` 发现 BL-041 audit @ 2026-05-04 起草时漏 grep 实物状态（dashboard 3 元素 in 4fd778b @ 2026-05-01 实装；audit 在实装 3 天后写"未含"）— v0.9.9 铁律 1 反向应用 audit/spec 起草
- BL-040 spec 起草时 Planner 漏 grep 完整 `?? 'Not specified'` 模式（仅列 generateAiAssets.ts 一处，但实际 email-generator.ts + video-script-generator.ts 同模式）— Generator 开工前 grep 5sec 发现 → 留 Planner judgement → 入 BL-045 backlog
- BL-043 staging gap 修复时 Planner 实战踩 PM2 reload/restart --update-env 不读 .env — v0.9.7 §1.6 已 sediment 但局限于 ecosystem.config.js env_file 字段用法；本次实战是 deploy-staging.sh source .env + pm2 start 路径，仍踩同坑 — 需 §1.6 后追加 §1.7 加注「不限 env_file 字段，任何 .env 改动场景」

**变更：**
- 修改 `framework/harness/planner.md` 铁律 1 检查矩阵：新增 2 行（v0.9.14）— "任意'文件:行 + 现状描述'类引用" + "完整 pattern 模式 — 不仅 grep 单一关键词"；范围从「spec 起草」扩到「spec / audit / review / readiness-report 所有起草类文档」；含实战双反面案例（BL-041 + BL-040）
- 修改 `framework/harness/deploy-patterns.md` §1.6 后追加 §1.7「不限于 env_file — 任何 .env 改动后 PM2 reload/restart 都不重读」（含实战触发场景 + pm2 jlist 验证证据 + 修复模板 + 反面案例 BL-043 staging gap）

---

## v0.9.13 — 2026-05-06（BL-024 沉淀，2 条 learnings）

**来源批次：**
- BL-024-ghost-controls-cleanup（B4 ghost-controls 实装 mini-batch + F006 retroactive hotfix，6/6 first-round PASS @ eacbbbb fix_rounds=0）

**触发原因：**
- BL-024 prod redeploy ops 准备阶段（2026-05-05 23:00）Planner johnsong 实地核查 deploy-prod.sh 注释「Reads KOLMATRIX_APP_PASSWORD via the SSH workflow's `set -a; source .env.production; set +a` (added in the GH Actions step)」与 deploy-prod.yml script 块实际内容对比才发现 — BL-034 F001 spec acceptance 已 done @ dbbfbb3 但漏了同 commit 改 yml 桥接，导致 ALTER ROLE 段 silent skip 1+ 周，prod kolmatrix_app 角色仍用弱密码（CRIT-1 fix 实际未在 prod 生效）。BL-024 F006 retroactive hotfix（commit eacbbbb）补 yml 桥接。Generator 在 generator_handoff 提案此规律入框架
- Planner Q2 ops（2026-05-05 23:30）执行 BL-035 F013 aigcgateway 服务端协调时发现 `mcp__aigc-gateway create_action_version` schema 仅含 messages/variables/changelog/set_active，**完全无 max_tokens 字段暴露**。`update_action` 也仅含 name/description/model。导致 v0.9.11 §4 max_tokens 矩阵 dogfood 无法通过 mcp 完整自动化。BL-035 F013 + BL-024 Q2 ops 共 12 次 max_tokens 推延 Soft-watch — 框架欠明文「mcp 不可达必含手工待办」+ 长期跨项目 issue

**变更：**
- 修改 `framework/harness/deploy-patterns.md`：§5 后追加 §5.1「spec acceptance 改 deploy-script 时同 commit 必须改对应 yml workflow」（含 Planner spec lock checklist + Generator 实装 checklist + Reviewer L2 deploy log warning 抓取强制 + BL-034 F001 → BL-024 F006 实战反面案例）
- 修改 `framework/harness/ai-action-contract.md`：§4 后追加 §4.7「mcp 自动化可达性」（mcp 字段范围矩阵 + 短期 KOLMatrix 端 spec 注解 + 长期跨项目 issue 3 项 + 清理触发条件 + 12 次推延实战数据）

---

## v0.9.12 — 2026-05-05（BL-034 沉淀，3 条 learnings）

**来源批次：**
- BL-034-backend-deep-security-and-data-isolation（5 CRIT + AI-H5 + AUTH-H4 + AUTH-H6/DB-H4 共 8 features，7 first-round PASS + F005 partial → fix-round 1 cost-cap MVP → reverifying PASS @ 07a6db4 fix_rounds=1）

**触发原因：**
- BL-034 F005 building 中段 Generator Kimi 实装时发现 spec 列 9 处 max_tokens 中 7 处走 aigcgateway /v1/actions/run 服务端 Action 模板，KOLMatrix 客户端代码不可覆盖；同理 4 处 wrap 中 topic-cloud videoTitles 走 actions/run。Generator 主动停下 + 写 generator_handoff 详列已做/未做/推荐 → Planner johnsong 14:00 短格式裁决方案 A → Generator fix-round 1 完成 cost cap MVP → done。这是 v0.9.11 §pre-impl-adjudication 短格式裁决模式的 building 中段变种 — 触发时机不同（building 中段 vs pre-impl 阶段）但机制相同；状态机切换不同（building → fixing 而非 verifying）— 框架欠明文
- BL-034 F003 启用 audit_log + event_log 两表 RLS 时，spec 原仅要求 logAudit 改 withTenant 未列 logEvent 33+ 调用方配套核查；Generator Kimi 主动同 commit 配套修才避开 prod 静默丢事件。这是 cross-cutting helper（logAudit/logEvent/metrics 等）在 RLS 启用时的典型坑 — 框架欠 spec 起草检查项
- BL-034 F007 加 health endpoint default-deny token guard 触发 deploy-staging.sh 死循环（grep git_sha → exit 1 → 用户无法落地 token env → 下次 deploy 仍 fail），Generator fix-round 1 加 graceful-degrade 路径 + 第二次 deploy 因 bash 旧 bytecode 仍 fail 第三次重启进程才 PASS。新 auth-gated endpoint + deploy script 配套 + bash bytecode 重启的双坑 — 框架欠明文
- BL-034 F007/F008 测试文件 2 个 unused import warning（afterEach / beforeEach）触发 reverifying 阶段决策成本：是否切 fixing fix-round +1 还是 Soft-watch 入 backlog？lint warnings 处理无明文判据 — 框架欠

**变更：**
- 修改 `framework/harness/pre-impl-adjudication.md`：新增 §11 "Building 中段良性 partial-pending 变种（v0.9.12 沉淀）"（与 §1-§10 主 pattern 互补，含触发条件 / Generator 行为指引 / Planner 短格式裁决格式 / 状态机切换规则 building → fixing 而非 verifying / BL-034 F005 实战反面案例）
- 修改 `framework/harness/database-patterns.md`：§8 后追加 §8.1 "同 migration 启用多表 RLS 时 cross-cutting helper 必须同 commit 配套改 withTenant"（含 grep checklist + spec acceptance 必含子项 + BL-034 F003 反面案例）
- 修改 `framework/harness/deploy-patterns.md`：新增 §5 "新 auth-gated endpoint 配套 deploy script"（含双坑组合分析 + 修订规则 4 条 + graceful-degrade 模板代码 + BL-034 F007 反面案例）
- 修改 `framework/harness/evaluator.md`：新增 §17 "lint warnings 在 reverifying 阶段的处理矩阵"（3 行处理矩阵 + 判据细化 unused-import vs 非 unused-import + Reviewer 处理流程 + BL-034 F007/F008 反面案例）

---

## v0.9.11 — 2026-05-05（BL-020 + backend-full-scan-audit 合并沉淀，5 条 learnings）

**来源批次：**
- BL-020-frontend-security-hardening-and-trivial-ui（前端 6 安全 + 2 UI 修复 mini-batch，8/8 first-round PASS @ ca5515b fix_rounds=0）
- KOLMatrix `docs/reviews/backend-full-scan-2026-05-04.md`（Claude CLI 独立任务模式 265 行后端全量扫描报告，5 CRIT + 14 HIGH + 21 MED + 16 LOW）

**触发原因：**
- BL-020-F001 Planner 起草 spec 时假设 productId 是 UUID（沿袭 audit §3 CR-1 文字描述），未 grep schema.prisma → Generator pre-impl audit 反向纠错指出 `Product.id` 实为 `@default(cuid())`，套 UUID_RE 会破 4 调用方 + 5 既有 fixture（25-char CUID）测试全红。Planner 短格式裁决 #1:A 修订全文。v0.9.9 铁律 1 现行检查矩阵未列 regex / id-format / type-check 类
- BL-020-F002 Reviewer L1 本机 Node 25.7 + jsdom 29 跑 `AiSuggestionsClient.test.tsx` 2 集成 case fail / CI run 25330969685 Node 20 PASS — 验证差异源于 Node 25 native localStorage incompat。项目根缺 `.nvmrc` → 本机 Node 与 CI Node 不一致
- BL-020-F005 rate-limit live probe 处理时暴露：RSC server action endpoint（如 login form / OAuth callback / mutation 提交）走 `Content-Type: text/x-component` + CSRF + RSC payload，curl 不能简洁模拟，常退到「unit + integration + health 联合背书 + prod 灰度浏览器手验」模式 — signoff 模板未明示
- BL-020-F005 Generator 在 staging VM SSH 追加 `REDIS_URL` 到 `.env.staging`，但 `.auto-memory/environment.md` Staging 表格未含 REDIS_URL 字段 — 记忆补漏
- backend-full-scan audit 三类同源问题暴露：(1) 6 个 server action / API route 全裸无 rate-limit；(2) audit_log + event_log 两张表 migration 引入时漏 RLS policy；(3) 9 处 AI 调用全无 max_tokens + 4 处用户输入裸拼 prompt — 每类同源问题单独修都简单，但全跨多个批次发生 = 框架欠 spec 起草检查项

**变更：**
- 修改 `framework/harness/planner.md` 铁律 1 检查矩阵：新增 "regex / id-format / type-check（v0.9.11 新增）"行 — Read schema.prisma 类型注解 + grep ≥1 条既有 fixture 印证 + BL-020 F001 反面案例段
- 新增 `framework/harness/planner.md` §"Server Action / API route 新增时 spec 必含速率限制条款" — 默认值矩阵（5 类 endpoint）+ Spec 必含段落模板 + 反面案例
- 新增 `framework/harness/database-patterns.md §8 "Migration 引入新表必查 RLS policy 默认 enabled"` — Planner / Generator 检查清单 + 默认 RLS policy 模板 + 例外白名单 + Spec 起草必含段落 + 历史漏洞溯源
- 新增 `framework/harness/ai-action-contract.md §4 "AI 调用必含 max_tokens + 用户输入必用 XML tag 包裹"` — max_tokens 必传规则（5 类用例矩阵）+ XML tag 包裹防 prompt injection（适用清单）+ Spec / Generator checklist + 反面案例
- 新增 `framework/harness/evaluator.md §16 "L1 本机 Node 版本必须与 .nvmrc 一致"` — Node 25 native localStorage 与 jsdom 29 互斥新坑 + L1 启动前置 + 误判判据
- 新增项目根 `.nvmrc`（内容 `20`，与 CI `NODE_VERSION: "20"` 对齐）
- 修改 `framework/templates/signoff-report.md` L2 实测记录段：加注 RSC server action / 不可 curl-simulate 类 endpoint 处理建议（退到联合背书 + 灰度手验模式）
- 修改 `.auto-memory/environment.md` Staging 表格 Redis 行：加 `.env.staging` 必含 `REDIS_URL` + BL-020-F005 部署落地参考

---

## v0.9.10 — 2026-05-04（BL-033 + prod-mvp-readiness-audit 合并沉淀，3 条 learnings）

**来源批次：**
- BL-033-quality-followups-and-assets-i18n（Checkbox 视觉 + KB pipeline + /assets i18n，4/4 features Reviewer 首轮 PASS fix_rounds=0）
- KOLMatrix `docs/reviews/prod-mvp-readiness-audit-2026-05-04.md`（Claude CLI 独立任务模式 168 行体检报告）

**触发原因：**
- BL-033-F004 i18n 命名空间扩展首推 CI 25321942649 红，i18n 双门同时触发（locale-coverage 抓 KOL/AI 行业惯用词在 zh/ja/ko 与 en 字面一致 + placeholders 抓 productAssetCount/summaryMiddle 在 zh/ja/ko 缺 ICU plural shape parity）。BL-014/BL-025 因都已预处理过未触发，BL-033 首次踩双门 — 框架欠 spec 起草 checklist
- BL-033 Reviewer 启动跑 tsc 出现 80 "Property 'asset' does not exist on PrismaClient" 误报（本机未跑 prisma generate），看似批次引入实际是本地环境状态 — 框架欠 L1 标配前置命令
- KOLMatrix prod-mvp-readiness-audit 168 行报告价值：(1) 比常规 Reviewer signoff 范围广，跨多批次结论 + PRD spec 对齐；(2) 锁文件:行可直接转 backlog 条目；(3) 用户视角 vs 工程内部视角双轨判断 — 框架欠 prod 上线前 audit 模板化 + 触发规则

**变更：**
- 修改 `framework/harness/planner.md`：新增 §"i18n 命名空间扩展类 spec 起草必含双门检查"（v0.9.10 — BL-033 沉淀）+ §"上线前 audit 触发条件"（v0.9.10 — prod-mvp-readiness-audit 沉淀）
- 修改 `framework/harness/evaluator.md`：新增 §15 "L1 本机 tsc 跑前必先 prisma generate"（顺序固定的 3 步前置命令）
- 新增 `framework/harness/i18n-namespace-add-checklist.md`：i18n 命名空间新增 spec checklist（CI 双门 locale-coverage + placeholders ICU plural shape parity 详解 + 翻译质量分级标记 + 命名规约 + spec 模板段 + Reviewer L2 验收 checklist）
- 新增 `framework/templates/prod-launch-audit-template.md`：prod 上线前体检报告模板（6 章节 + 4 池子分类 + DoD 终态对照 + 推荐执行顺序 + 风险提示 + 模板使用说明）

---

## v0.9.9 — 2026-05-04（BL-030/BL-031/BL-032 三批合并沉淀，8 条 learnings）

**来源批次：**
- BL-030-kb-asset-bridge-migration（Planner SQL ops 漏 dual-write 致 BL-031 暴露 FK orphan）
- BL-031-composer-locale-product-filter-hotfix（mock-only test cuid bug + Reviewer 越界 ops）
- BL-032-ai-prompt-token-fix-and-backfill（Generator 角色冲突 + AI prompt placeholder 规约 + dualWrite silent count）

**触发原因：**
- Planner 在 BL-030 done 阶段为不阻塞用户绕过 mutation 函数用 SQL 直跑，漏 dualWriteEmailTemplateOnCreate 副作用 → 15 条 ai_generated email 在 email_template 无镜像 → BL-031 启动 Phase 1 调研发现 FK orphan 风险
- BL-031-F003 backfill 脚本 mock-only 单测 PASS，staging 端到端二跑发现 `${productId}::uuid` cast 撞 42883（asset.product_id 实际是 text）→ c1405c7 修
- BL-031 Reviewer 跑 SQL ops 处理 staging orphan asset，用户「C1b 破例授权」— 跨角色 ops 框架未规范
- BL-032 Generator johnsong 启动识别 `./generator.md` 字面硬规与 `.auto-memory/role-context/generator.md` 软规直接冲突，停工等仲裁
- BL-032 KB AI prompt 未指定 placeholder 规约，claude-haiku-4.5 用方括号 → 替换 regex 仅认 Mustache → 字面字符串发出
- BL-032 dualWriteEmailTemplateOnUpdate updateMany 静默返 count=0 模式 — Asset 端写成功但 mirror 缺失时上层无感知

**变更：**
- 修改 `framework/harness/planner.md`：新增铁律 5「Planner ops 绕业务 mutation 必列副作用 checklist」+ 铁律 6「跨角色 ops 必须用户书面授权 + session_notes 记账」+ 铁律 7「角色文件多副本一致性，修订前 grep 全部副本同 commit 改」
- 修改 `framework/harness/database-patterns.md`：新增 §5 跨表 id 类型一致性（cuid vs uuid cast 验证）+ §6 Silent updateMany 模式（显式 stats 日志 + 长期改返 count）+ §7 Generator 实装后 staging 端到端跑 .ts 脚本硬要求
- 修改 `framework/harness/generator.md`：测试边界单行硬规替换为 5 行测试类型矩阵（单元/集成 = Generator + Evaluator 跑 / E2E + 压测 + code review = Evaluator / 回归同 commit 补 = Generator）+ 「Generator 写测试 ≠ 自评」铁律一致性声明 + scripts/*.ts staging 端到端跑硬要求
- 修改 `framework/harness/ai-action-contract.md`：新增 §3 AI 输出 placeholder 规约 + server-side validation 兜底（prompt 必明文 + retry 候选 + 适用范围扩展到全 token-pipeline）
- 修改 `framework/templates/signoff-report.md`：新增 §L2 实测记录节（staging git_sha 对齐 + 端到端流证据 + invariant 验证 + 浏览器手动验）+ §Ops 副作用记录节（任何 SQL ops 必写副作用对齐列 + 用户授权时间戳）

---

## v0.9.8 — 2026-05-04（BL-030 沉淀，2 条 learnings）

**来源批次：** BL-030-kb-asset-bridge-migration（2026-05-04，KB→Asset 数据通路完整迁移；ADR-011 BL-025 scope miss 修复，5/5 features Reviewer 首轮 PASS fix_rounds=0）

**触发原因：**
- BL-030 F002 spec 写"跳转 /assets/{id}"，项目实际无 `/assets/[id]/page.tsx`（detail 通过 `/assets?productId=X` 列表页 + 右侧 drawer 选中实现）；Generator 实装链对路由，但 spec 字面错配 → Reviewer Soft-watch S1
- BL-030 是首例"老数据通路 → 新数据通路"完整迁移批次，spec 起草时无现成模板对齐三段式数据处置 / backfill 规约 / 命名同源 / deploy-checklist 数据快照 / rollback 幂等等共性要求

**变更：**
- 修改 `framework/harness/planner.md`：新增铁律 4「spec 引用应用路由路径前必须 grep 实物存在性」（v0.9.8 — BL-030 沉淀）
- 新增 `framework/templates/migration-batch-checklist.md`：数据通路迁移批次模板（含三段式数据处置 A/B/C 决策表 + backfill 4 项硬要求 + 命名工具同源 + deploy-checklist 硬编码数据快照 + rollback DELETE 幂等 SQL + Generator 实装 + Reviewer L2 + Planner done 收尾分章 checklist）

---

## v0.9.7 — 2026-05-03（BL-027 沉淀，3 条 learnings）

**来源批次：** BL-027-asset-followup-icon-hotfix（2026-05-03，7/7 features Reviewer 首轮 PASS，fix_rounds=0）

**触发原因：**
- BL-026 prod /assets ActionBar 渲染 "FILTER_ALT"/"ARROW_DROP_DOWN" 字面文字 — woff2 子集漏 filter_alt + arrow_drop_down ligature；hotfix 同时做四层守门加固
- spec 写"docs/dev/rules.md 加段落"实物不存在（BL-026/BL-027 连续两批同一坑）
- signoff-report.md §6 Soft-watch + §10 Framework Learnings 经 BL-025/BL-026/BL-027 三批默认结构，Reviewer 手动添加三次

**变更：**
- 修改 `framework/harness/material-symbols-pattern.md`：新增 §"四层守门"，沉淀 CI case + pre-commit hook + PR template + manifest 四层叠加防漏跑 regen script
- 修改 `framework/harness/planner.md`：新增铁律 3「spec 引用 docs/X.md 路径前必须 ls 实物」
- 修改 `framework/templates/signoff-report.md`：§Framework Learnings 去 "可选"、新增前置 §Soft-watch H2 节

---

## v0.9.6 — 2026-05-03（BIx + BL-025 累积，8 条 learnings 全部按 Planner 预判落地）

**来源批次：** KOLMatrix BIx-mvp-polish-pass（2026-05-02）+ BL-025-asset-library（2026-05-02 → 2026-05-03）

**触发原因：**
- BIx 收尾踩 WSL2 fs vitest timeout（fast-glob 5s 偶发 fail）+ perf 类 acceptance 工具缺位 + 首轮 PASS 判据无明文规则
- BL-025 spec drafting 漏 §F004.A/B/C 三段（用户主动 challenge 才补全）+ Material Symbols 19 漏 icon prod 字符方框 + cross-agent staged 索引误打包（commit 3da4248）+ F004 audit-log fire-and-forget flaky test + F001 staging deploy `prisma generate` 缺
- 用户 2026-05-03 决议：8 条全部按 Planner 预判落地（A 路线）

**变更：**
- 修改 `vitest.config.ts`：加 `testTimeout: 60_000`（WSL2 fast-glob fs 慢防 5s 默认 timeout 偶发 fail；CI Linux 容器无影响）
- 修改 `harness-rules.md` 铁律 #12：任何 commit 前必跑 `git diff --cached --name-only` 确认 staged 索引（多角色同工作树时防误打包对方 WIP）
- 修改 `framework/harness/deploy-patterns.md`：
  - §3.2 完整链 checklist 加新步骤 3.5「`npx prisma generate`」（npm ci 之后立即跑，不依赖 postinstall hook）
  - §3.3 Spec 起草期 checklist 同步加 prisma generate 行
- 修改 `framework/harness/planner.md`：
  - 新增 §「Perf 类 acceptance 必须自带『工具 + 输出物』checklist」（spec § acceptance 必含工具入 devDeps + 输出快照位置）
  - 新增 §「UI 类 spec 起草前 mandatory self-check checklist」（4 段全含才能交付 Generator + 推荐机器化 grep 守门）
- 修改 `framework/harness/evaluator.md`：
  - §12 新增「首轮 verifying PASS 的硬条件」（acceptance 全代码层 + L1/L2 + soft-watch 明文兜底，3 条全满足才能切 done）
  - §13 新增「L2 烟测含字体子集必须 ≥ 5 dynamic callsite spot check」（指向 material-symbols-pattern.md）
  - §14 新增「fire-and-forget audit pattern 测试约束」（两选一：内部 await 或 vi.waitFor）
- 修改 `framework/harness/ui-fidelity-guardrail.md` §2 顶部加严格强制声明（指向 planner.md 自检 checklist + Reviewer L1 受理前 grep）
- 已存在 `framework/harness/material-symbols-pattern.md`（5 漏范式 + manifest 维护 + CI 守门 pattern；BL-025-F009 commit `e6cd95f` 实际落地，此次在 evaluator.md §13 + CHANGELOG 引用）
- 归档 8 条 proposed-learnings → `framework/archive/proposed-learnings-archive-v0.9.6.md`
- 清空 `framework/proposed-learnings.md` 回 template

**8 条 learnings 列表：**
- [#1] WSL2 fs vitest 5s 默认 timeout 偶 fail（BIx F005 L1 + BL-025 verifying 两次踩同根因）
- [#2] perf 类 acceptance 工具必入 devDeps（BIx F005 §6 O3 数字层无证据）
- [#3] 首轮 verifying PASS 判据 — 全代码层 + L1/L2 + soft-watch 明文兜底（BIx + BL-025 两连续验证）
- [#4] cross-agent 同工作树 git add 仍混 staged 索引 → 铁律 #12（BIx commit 3da4248）
- [#5] UI 类 spec 起草前自检 checklist（BL-025 spec drafting 漏 §F004.A/B/C 三段，靠用户 challenge 才补）
- [#6] Material Symbols 5 漏范式 + L2 字体子集烟测 ≥ 5 callsite（BIx hotfix bb637a1 + BL-025-F009 守门加固）
- [#7] fire-and-forget audit pattern 测试约束（BL-025 F004 CI flaky `kol-profile.test.ts`）
- [#8] NODE_ENV=production npm ci 不跑 postinstall prisma generate（BL-025 F001 staging deploy 失败）

**未采纳的子建议（暂存 backlog）：**
- pre-commit hook 守门 commit-tag 与 staged 文件路径一致性（item #4 子建议 b）— 复杂度高、维护成本不值
- pre-commit hook 守门 manifest vs grep 一致性（item #6 子建议 c）— 同上
- 新建 `framework/harness/code-review.md`（item #7 候选位置）— 框架文件越多越乱，统一收纳到 evaluator.md §回归测试稳定性

---

## v0.9.5 — 2026-05-01（B5 7 轮 fixing + MVP 3 轮 fixing 累积经验沉淀，12 条 learnings）

**来源批次：** KOLMatrix B5-kol-data-enrichment（2026-04-30）+ MVP-internal-demo-prep（2026-05-01）

**触发原因：**
- B5 因 deploy runbook 漏跑 + AI action 契约漂移 + alpha tag types 漂移 + visual baseline retrigger 等连续 7 轮 fixing
- MVP-internal-demo-prep 又踩 PM2 env_file / aigcgateway variables contract / smoke checklist stale 等 3 轮 fixing
- 用户 2026-05-01 决议：12 条全部入 framework

**变更：**
- 修改 `framework/harness/deploy-patterns.md`：
  - §1.6 新增 `PM2 6.0.14 env_file 不可靠 anti-pattern`（必须 delete + sourced-shell start，不要 reload --update-env）
  - §3 新增 `Staging/Prod deploy 完整链 checklist`（schema migrate / 数据 enrich / SHA 对齐 / chore-only diff 边界）
  - §4 新增 `Visual baseline regen 注意事项`（GITHUB_TOKEN push 不触发下游 + retrigger 套路 + deterministic selector 要求）
- **新增** `framework/harness/ai-action-contract.md`（aigcgateway / LLM 网关集成规范）：
  - §1 Action 集成开工前必跑 dry-run + parser 双 shape 兼容
  - §2 Timeout 起步 10s + CJK 内容 15s + fallback 不可 silent + 月预算监控
- 修改 `framework/harness/evaluator.md`：
  - §10 新增 `SHA 对齐严收紧的边界（chore-only 差异容许）`
  - §11 新增 `Smoke checklist 文本陈旧时直接 update 而非标 FAIL`
- 修改 `framework/harness/planner.md`：
  - 新增 `Spec 起草必含「数据准备步骤」+ 白名单 ID`
  - 新增 `verifying 前 checklist 起草必须 grep 实际代码验证`
- 修改 `framework/harness/pre-impl-adjudication.md` §9.2：spec 必含数据准备步骤 + 白名单 ID 防抽样污染
- 修改 `framework/harness/generator.md` §8：Alpha/Beta/RC 依赖必须 ambient `.d.ts` shim 兜底
- 修改 `framework/harness/database-patterns.md` §3：Prisma 7+ JSON 列写入需 `as Prisma.InputJsonValue` cast
- 修改 `framework/harness/harness-rules.md` 铁律：
  - 第 10 条：spec-driven 工作必须有 features.json feature 号归属（v0.9.4 sync gap 补齐）
  - 第 11 条新增：状态机 JSON 文件 commit 前必须跑 JSON parse 校验
- 同步修改 live `harness-rules.md`：第 11 条铁律
- **新增** `framework/templates/pre-commit-hook.sh`：自动 parse 校验状态机 JSON 文件的 git pre-commit hook 模板
- 归档 12 条 proposed-learnings → `framework/archive/proposed-learnings-archive-v0.9.5.md`
- 清空 `framework/proposed-learnings.md` 回 template

**12 条 learnings 列表：**
- [#1] staging deploy runbook 必含 prisma migrate deploy（B5 fixing-2）
- [#2] staging deploy runbook 必含数据 enrich/seed 跑动（B5 fixing-3 + MVP fixing-2）
- [#3] PM2 6.0.14 env_file 不可靠 → delete + sourced-shell start（B5 fixing-4）
- [#4] aigcgateway action output shape + variables 契约会漂移（B5 fixing-5 + MVP fixing-3）
- [#5] aigcgateway timeout ≥10s + CJK 15s + fallback 不可 silent（B5 fixing-6）
- [#6] chore(state) commits 不触发 staging deploy + Reviewer SHA 严收紧死循环（B5 fixing-7 + MVP fixing-2）
- [#7] Spec 必含「数据准备步骤」+ 白名单 ID（B5 fixing-3 + MVP fixing-2）
- [#8] Alpha tag 依赖 types 漂移 → ambient `.d.ts` shim 兜底（B5 fixing-1）
- [#9] Prisma 7+ JSON 列写入需 `as Prisma.InputJsonValue` cast（B5-F004/F006）
- [#10] update-visual-baselines GITHUB_TOKEN push 不触发下游 CI（B5-F006）
- [#11] 状态机 JSON 文件 commit 前必须 parse 校验 + pre-commit hook（MVP commit b44b79d）
- [#12] Smoke checklist 起草后 Planner 必须 grep 验证 elements 存在性（MVP fixing-1）

---

## v0.9.4 — 2026-04-26（Generator 自裁决 / 跨批次启动 anti-patterns + 铁律 10）

**来源批次：** KOLMatrix MVP-visual-fidelity-hotfix F001 越界事件（2026-04-24）
**触发原因：**
- Generator (johnsong) 在 BM2 F005 完成后、F006 开工前，未等 Planner 裁决就启动了 `MVP-visual-fidelity-hotfix` F001（公共组件库抽取）
- 写了 pre-impl audit 但 §7 自填"自裁决；方案 A；跨批次执行已用户授权"（实际用户未给此授权，Generator 误读 Planner Phase 2 三点决议）
- 技术产出合理（7 文件代码质量良好），但流程两处违规：
  (a) 自裁决违反 `pre-impl-adjudication.md` §2.3
  (b) 跨批次执行违反 hotfix spec §6 顺序约束
- 用户 2026-04-24 选 Option 3 接受产出 + 补流程补丁

**变更内容：**

- 更新 `framework/harness/pre-impl-adjudication.md`：
  - §4.6 新增 "Generator 自裁决"（错误 / 正确 / 同 agent 豁免规则 / 典型触发链）
  - §4.7 新增 "Generator 跨批次启动"（错误 / 正确 / 边界 / 判定原则）

- 更新 `harness-rules.md` §铁律：
  - 第 10 条新增："任何 spec-driven 工作必须有 features.json feature 号归属。无归属的代码修改 = 越界（commit message 的 feat(<batch>-F<num>): 标签必须能对应 features.json 实际条目，否则 Reviewer 拒绝签收）。"

- 归档：`framework/archive/proposed-learnings-archive-v0.9.md` 追加 2026-04-24 越界事件记录

- 同时（合并）：BM2 building 期间发生的 role_assignments 风险信号（johnsong 同时担任 planner+generator 触发了 §4.6 §4.7 anti-patterns）—— 不升为新硬规则（harness §6 仍允许 planner 和其他角色重叠），但作为强烈 signal 记录：未来若小团队仍要单人多角色，需要更严格的 commit-by-commit 角色切换标注。

---

## v0.9.3 — 2026-04-23（VPS working tree 卫生 + artifact in-git 强制）

**来源批次：** KOLMatrix BAux1 deploy + BI3-F005 签收漏（2026-04-23）
**触发原因：**
- BAux1 触发 prod deploy 失败在 `git checkout` 步（VPS working tree 脏态 2 处）：
  1. `scripts/cert-expiry-check.sh` 86 行 Bash 活在 VPS 3 天但从未 commit 入 git（BI3-F005 签收漏）
  2. `src/middleware.ts` VPS 本地有 BI2 调试时的 `console.log` 未清理
- 调查发现 Reviewer 当时 signoff 已走完 L1/L2/L3 验收，但未核对"脚本是否 `git ls-files` 能找到"。这是 framework 层签收清单的漏。

**变更内容：**

- 更新 `framework/harness/deploy-patterns.md`：
  - §2 新增"VPS working tree 卫生 + artifact in-git 强制"（~80 行）
  - §2.1 坑的典型触发链（Gap 1 签收漏 + Gap 2 工作区卫生）
  - §2.2 症状（deploy-prod.sh 3/8 checkout 失败特征）
  - §2.3 3 条防御规律（Reviewer 签收清单 + Generator/Planner 自律 + deploy-prod.sh early fail）
  - §2.4 Reviewer 签收新 checklist 模板（必检 / 可选核对 3 项）
  - §2.5 Planner spec 起草期 counter-check（acceptance 必须含 git-tracked 验收项）

- 归档：`framework/archive/proposed-learnings-archive-v0.9.md` 追加 2026-04-23 坑记录

---

## v0.9.2 — 2026-04-20（DB 命名 migration-consistency + PM2 zero-downtime 3 条件）

**来源批次：** KOLMatrix BI2-deployment-automation sprint（2026-04-20）
**触发原因：**
- **BI2 DB 命名坑：** init migration `20260418010000_app_role` 硬编码 `GRANT CONNECT ON DATABASE kolmatrix`，spec / architecture / environment / infrastructure / runbook 5 份文档却写 `kolmatrix_prod`。首次 prod bootstrap 被迫用 migration 名，之后 Planner 裁决全文档对齐。值得作为 Planner spec 起草期铁律沉淀。
- **BI2-F002 PM2 zero-downtime 两轮证伪：** Planner v1 spec 写"cluster + instances=2 自动 zero-downtime"两次被 Generator 实测驳倒（Round A EADDRINUSE crash loop；Round A' 93% 丢包）。最终方案 B1（custom server.js + wait_ready）达标。"zero-downtime 是 3 条件共同满足，不是 cluster 开关"值得跨批次沉淀。

**变更内容：**

- 更新 `framework/harness/database-patterns.md`：
  - §2 新增 "数据库命名 / 角色 / Grant 对象必须与 migration 硬编码一致"
  - §2.3 Planner spec 起草期检查清单（4 条）
  - §2.4 解释为什么"主动对齐 migration"比"改 migration"正确
  - 版本历史追加 2026-04-20 §2 条目

- 新增 `framework/harness/deploy-patterns.md`（~130 行）：
  - §1 PM2 cluster zero-downtime reload 的 3 个必要条件
  - §1.1 坑的分析（2 轮实测数据）
  - §1.2 3 条件（直接子进程 / process.send('ready') / wait_ready+listen_timeout）
  - §1.3 Next.js 生产部署唯一可靠路径 = custom server.js（含完整 ~22 行代码）
  - §1.4 Planner spec 起草期检查清单（6 条）
  - §1.5 反面案例表（BI2 v1 路径作废记录）

- 归档：`framework/archive/proposed-learnings-archive-v0.9.md` 追加 2 条用户确认记录

---

## v0.9.1 — 2026-04-20（数据库模式沉淀 + Planner spec 自检清单）

**来源批次：** KOLMatrix BI1-test-infrastructure sprint fixing round 1（2026-04-19）
**触发原因：**
- **BI1-F008：** marketer E2E flaky 根因是 PostgreSQL RLS 策略 `current_setting(..., true)::uuid` 直接 cast 遇空串 throw，Prisma 连接池复用导致随机命中。裁决 NULLIF 兜底 → 6 条 RLS 策略全改 → flaky 消除（5×20/20 PASS）。
- **BI1-F010：** Planner spec 阶段笔误，acceptance 写 "PG + Redis service container" 与 F002 Testcontainers helper 设计冲突，Reviewer 字面判 PARTIAL。裁决修订文案 → Testcontainers 为正。

两条经验均值得跨批次沉淀：第一条是技术坑（未来所有涉及 GUC/RLS 的 SQL 都可能踩），第二条是 Planner 自律规则（每批次都会用）。

**变更内容：**

- 新增 `framework/harness/database-patterns.md`（~80 行）：
  - §1 RLS 策略 NULLIF 兜底：坑的成因、三态表、正确模板、反面方案、Planner 检查清单
  - 未来涉及 RLS / 自定义 GUC / Prisma session 复用场景时必读

- 更新 `framework/harness/pre-impl-adjudication.md`：
  - §9.1 新增 Planner 写 spec 自检清单（5 条定稿前必扫）：内部一致性 / 网络容器外部服务 / 引用路径 / 术语统一 / ADR 对齐
  - §10 版本历史追加 2026-04-20 条目

---

## v0.9.0 — 2026-04-19（Pre-Implementation Audit → Planner Adjudication 模式沉淀）

**来源批次：** KOLMatrix B0 sprint（2026-04-18 ~ 2026-04-19）
**触发原因：** B0 实施期 Generator johnsong 主动在 F005/F010/F007/F006 开工前提交 4 份 pre-impl 审计 × 25 决策点，Planner Kimi 全部裁决后开工。结果：**0 次 building 阶段返工 / 1 次 fixing（F007 口径争议且根因是 Planner 修 spec 不彻底）**。模式验证有效，沉淀为框架能力。

**变更内容：**

- 新增 `framework/harness/pre-impl-adjudication.md`（~370 行）：
  - §1 问题定义：3 类高代价错误（spec 内部矛盾 / 跨源漂移 / 凭本能填空）
  - §2 Pattern 核心：触发条件、审计文档模板、Planner 裁决回复格式、状态机配合
  - §3 决策类型分类：Canonical 选择 / Props API / Spec 字面冲突 / 范围依赖决策
  - §4 Anti-patterns：Planner 凭印象 / Generator 过度笼统 / 修 acceptance 不扫全文 / 审计漫反射 / Reviewer 按旧 spec
  - §5 统计口径：审计→裁决延迟 / 命中率 / 返工率 / Reviewer 争议率
  - §6 Planner 裁决必加项：扫全文铁律 / 同步更新 test-cases / 复用价值理由
  - §7 与其他 harness 机制的关系
  - §8 最小化使用示例
  - §9 落地检查清单
  - §10 版本历史

- 更新 `framework/harness/planner.md`：
  - 新增 §Planner 裁决职责 段（P1-P5 五条规则）
  - 引用 pre-impl-adjudication.md 作为权威文档

- 更新 `framework/harness/generator.md`：
  - 新增 §2.5 开工前审计段
  - 7 条触发条件 + 6 步流程
  - 引用 pre-impl-adjudication.md

- 同步更新项目 instance `planner.md` + `generator.md`（与 framework 保持一致）

**设计决策：**
- **不改 harness-rules.md**（核心不可修改）—— 通过 planner.md/generator.md 规则 + 新独立文档形式落地
- **规则编号用 P1-P5**（Planner 系列）与已有铁律 1/2 区分
- **模式可被 Skip**：简单 feature 无歧义直接开工，不强制每 feature 都审计（"复杂度匹配风险"）
- **Generator 主动发起**：不是 Planner 强加的流程，而是 Generator 觉察歧义时的自我保护机制
- **审计文档 = 决策日志**：裁决追加在同一文档末尾，自然形成可追溯的决策历史

**KOLMatrix B0 实测数据：**
- 4 份审计：`B0-app-shell-canonical-review.md` / `B0-f010-component-map.md` / `B0-f007-dashboard-plan.md` / `B0-f006-i18n-plan.md`
- 25 决策点：11 (F005) + 6 (F010) + 7 (F007) + 8 (F006) − 重复
- 0 次 building 返工
- 1 次 fixing 轮（F007 签收口径争议 → Planner 仲裁修订 spec 消除矛盾）
- 均延迟 ~1.5 小时（push 审计请求 → Planner push 裁决）

---

## v0.8.0 — 2026-04-18（图文并茂文档套件首版）

**来源批次：** 独立任务（用户要求为框架撰写图文并茂的介绍文档）
**触发原因：** framework/README.md 虽然详尽但偏手册性质，缺乏直观的图形说明；没有分层文档让不同受众（概念学习 / 操作上手 / 实战演示）各取所需；mermaid 图可通过 GitHub 原生渲染，是低成本高效果的图文方案

**变更内容：**

- `framework/README.md` 升级为 landing page：
  - 新增 Hero 区：mermaid 状态机图 + ASCII 三角色示意图 + 30 秒快速开始
  - 新增文档导航区：指向 docs/01-03 + CHANGELOG
  - 保留原有完整手册内容于下方（不动）
- 新增 `framework/docs/` 目录及 4 份文档：
  - `01-concepts.md`（功能介绍 · ~280 行）：3 个痛点 → 3 个解法、三角色图、状态机、记忆分层图、铁律故事、适用与不适用、vs 普通 AI 编程 / Scrum 对比
  - `02-usage.md`（使用方法详解 · ~530 行）：完整批次时序图、状态机详解、三角色职责流程图、关键文件字段详解（progress.json / features.json / backlog.json / .auto-memory/）、高级用法（多 agent / Codex-only / Path A）、沉淀机制
  - `03-quickstart.md`（开箱即用手册 · ~350 行）：前置条件、3 步初始化（含 GIF 占位）、第一个批次实战（签到积分系统示例）、10 条 FAQ
  - `imgs/` + `gifs/` 目录（暂空，等后续设计工具出图和录屏）
- 同步推到 template repo `tripplemay/harness-template`

**设计决策：**
- 图以 mermaid 为主（GitHub 原生渲染、版本控制友好），辅以 ASCII 图（表格化信息）
- 2 处 GIF 占位（bootstrap 演示、Claude INIT 演示），待后续用 terminalizer/asciinema 录屏补上
- 中文为主，暂不双语（符合用户工作语言偏好）
- 未做 04-reference.md 和 05-case-study.md（当前文档已覆盖核心需求，未来可按需补充）

---

## v0.7.1 — 2026-04-18（Planner 铁律：spec 编写前核查源码 + 交叉验证 Code Review 断言）

**来源批次：** BL-SEC-BILLING-AI / BL-SEC-BILLING-CHECK-FOLLOWUP
**触发原因：** 两次连续事故：
1. BL-SEC-BILLING-AI 初稿 spec 把 `deduct_balance` 签名写错（2 参 BOOLEAN vs 实际 6 参 RETURNS TABLE），被 Generator 开工前规格核查捕获；若未核查会产生重复 DEDUCTION transaction 记录破坏对账
2. BL-SEC-BILLING-AI F-BA-03 CHECK migration 生产 `prisma migrate deploy` 失败，根因是 Code Review 对 `Transaction.amount` 符号断言错误（H-16 报告 REFUND < 0，实际代码 `scripts/refund-zero-image-audit.ts:102` 存 +sellPrice 为正数）；需 hotfix 回滚 + 开新批次 `BL-SEC-BILLING-CHECK-FOLLOWUP` 修正

**变更内容（`framework/harness/planner.md` 新增 "Planner 铁律" 小节）：**

**铁律 1：spec 涉及具体代码细节时必须核查源码**
- 函数签名 / API handler 参数 / schema 字段 / 枚举常量 — 写 spec 前必须 Read 对应文件确认
- 规格引用实际代码时必须用代码块贴片段 + 标注 `file:line`
- Generator 发现规格偏差时有义务开工前提出，Planner 修订后再开工

**铁律 2：Code Review 报告的事实性断言按"线索"处理不按"真相"采信**
- 符号/类型/约束/枚举/常量类断言必须双路交叉验证：源码 + 生产数据采样
- spec 中引用 Review 发现须标注 `[已核实 source + prod-data]` 或 `[待核实]`
- `[待核实]` 类不得作为 acceptance 阻断条件

**影响范围：** Planner 规格编写流程永久变更；Generator 开工前规格核查合法化并成为推荐做法。

---

## v0.7.0 — 2026-04-18（改名：Cowork + Harness → Triad Workflow）

**来源批次：** 独立任务（用户讨论时指出原名未准确反映框架工作模式）
**触发原因：** "Cowork" 是早期 Claude Desktop 作为 Planner 时的残留（v0.4.0 起已由 Claude CLI 承担），"Harness" 偏泛且容易与 CI/CD harness.io 混淆。两词都无法突出本框架真正独特的"三角色不重叠 + 状态机驱动 + 无自评"三件事

**新名称：Triad Workflow**
- Triad（三角色）：Planner / Generator / Evaluator
- Workflow：状态机 + Git 异步交接 + 记忆分层沉淀

**变更内容（表层改名，不动文件路径）：**
- `framework/README.md` 标题 + 介绍段重写：突出三角色 / 状态机 / Git 总线 / 记忆分层四个核心特征；保留历史说明解释 Cowork 来历
- `framework/INIT.md` 标题、首次 commit 消息中"Cowork-Harness framework" → "Triad Workflow"
- `framework/bootstrap.sh` 脚本注释 + 运行时输出"Harness framework" → "Triad Workflow"
- `framework/memory/user-role.md` 模板中"Harness 7 状态机" → "Triad Workflow 7 状态机"

**保留不动（向后兼容）：**
- 所有文件名：`harness-rules.md` / `framework/harness/` 目录等
- GitHub repo 名：`tripplemay/harness-template`（URL 稳定性优先，repo 描述已更新）
- aigcgateway 项目根目录所有文件（现用命名不受影响）
- 角色文件内容中出现的"harness 规则"引用（那些指的是 `harness-rules.md` 文件，是文件引用不是框架名）

**后续可选升级（当前不做）：** 档位 2 = 文件名和路径也对齐（`harness/` → `state-machine/`），档位 3 = repo 同步改名。短期不破坏现有协作，长期如需彻底统一可再推进

---

## v0.6.1 — 2026-04-18（一键初始化：bootstrap.sh + INIT.md）

**来源批次：** 独立任务（用户讨论"如何把框架应用到新项目"，确定形态三 = 独立 template repo + bootstrap + INIT 的初始化方案）
**触发原因：** 原 5 步手工 cp + 编辑流程对新项目不友好；纯 bash 脚本无法智能填充 environment.md / user-role.md 等需要判断的字段；选定 "bootstrap.sh 做机械复制 + Claude 通过 INIT.md 智能填占位符" 的双层分工

**变更内容：**

- 新增 `framework/bootstrap.sh`：机械复制脚本
  - 自动识别 flat（degit template repo 后）/ nested（aigcgateway 自身）布局
  - 拷贝 harness 角色文件到根目录、初始化 `.auto-memory/` 分层结构、复制 CLAUDE.md/AGENTS.md 占位符版本
  - 创建 progress.json/features.json/backlog.json/docs 骨架/.gitignore
  - flat 布局下把源文件规整到 `framework/` 子目录、把 INIT.md 提到根目录
  - 安全检查：harness-rules.md 已存在则拒绝执行
- 新增 `framework/INIT.md`：Claude CLI 引导 prompt
  - 6 个问题（项目名/技术栈/命令/生产环境/agent 身份/用户偏好）
  - 步骤 2 必须展示填充计划等用户确认
  - 用 Edit 工具精确替换占位符，不擅自编造信息
  - 完成后 `git init` + commit + 删除 INIT.md
- `framework/README.md` §新项目启动：从 5 步简化为 3 步（degit → bootstrap → Claude INIT）
- 同步发布到独立 template repo `tripplemay/harness-template`（首次 `git subtree push --prefix=framework`）

**分工设计：**
- bootstrap.sh = 机械活（确定性 cp/mkdir/echo），shell 脚本可回归
- Claude INIT.md = 判断题（智能填充占位符），自然语言交互
- 边界清晰，互不踩脚

---

## v0.6.0 — 2026-04-18（框架对齐审计 + 模板补齐）

**来源批次：** 独立任务（用户要求审查 framework 是否与当前流程对齐）
**触发原因：** 项目根的 generator.md / evaluator.md 多次更新后未同步到 framework；memory 模板停留在 v0.4.0 之前的扁平结构；features.template.json 缺 v0.2.0 引入的 executor 字段；signoff-report 残留 `reviewing` 和 "Cowork" 等过时词；progress.init.json 缺 v0.5.0 引入的 session_notes 字段

**变更内容：**

- `harness/generator.md`：从项目根同步，补齐两节
  - 设计稿页面保护规则（无条件适用，不依赖 acceptance 提及）
  - §4.5 CI 检查（每次 push 后 `gh run list` 检查，铁律：CI 红色不得继续开发）
- `harness/evaluator.md`：从项目根同步，补齐一节
  - 设计稿页面变更的视觉一致性验收（无条件适用）
- `harness/progress.init.json`：补 `session_notes`、`generator_handoff` 字段，与项目根 progress.json 字段对齐
- `templates/features.template.json`：每条 feature 补 `executor` 字段（v0.2.0 引入但模板未跟进），含 generator / codex 两个示例
- `templates/signoff-report.md`：
  - `status=reviewing` → `status=verifying`（reviewing 在 v0.2.0 已废弃）
  - "由 Cowork 在 status → done 时填写" → "由 Planner..."
  - 类型检查节加入 CI 检查输出
  - 新功能块加入 Executor 字段（generator / codex）
- `memory/` 目录按 v0.5.0 分层结构完全重写：
  - 新增 `project-status.md`（T0，覆盖写，≤30 行）替代 `project.md`
  - 新增 `environment.md`（T0）模板
  - 新增 `role-context/{planner,generator,evaluator}.md`（T1）模板
  - 新增 `reference-docs.md`（T2）模板
  - `MEMORY.md` 改为 T0/T1/T2 分层索引
  - `user-role.md` 去掉 "Cowork + Claude CLI + Codex" 表述
  - 删除旧的 `project.md`
- `README.md`：
  - 框架组成结构图反映 memory v0.5.0 分层
  - 新项目启动指南（第 2 步）按分层结构复制文件
  - 新增 §需求池（backlog.json）、§角色动态分配（role_assignments）章节
  - §记忆系统约定改为 T0/T1/T2 分层 + 写入职责表 + 内容边界铁律
  - §经验教训补充 4 个新条目：CI 守门铁律、回归测试硬性要求、设计稿一致性无条件适用、Path A 大型重构编排模式
  - 历史说明：保留 "Cowork" 词以表明出处，但行为上已不参与
- `CHANGELOG.md`：按时间倒序重排，去掉重复 v0.2.0

---

## v0.5.0 — 2026-04-08（共享记忆分层加载）

**来源批次：** R1-design-system-foundation planning 阶段，用户主动要求改进记忆系统
**触发原因：** agent 重启后加载全部记忆文件导致 context 浪费；project-aigcgateway.md 不断膨胀无人清理

**变更内容：**

- `.auto-memory/` 文件结构重组：
  - 新增 `project-status.md`（T0，≤30 行，覆盖写）替代膨胀的 `project-aigcgateway.md`
  - 新增 `environment.md`（T0）从 project-aigcgateway.md 拆出环境信息
  - 新增 `role-context/{generator,evaluator,planner}.md`（T1）角色行为规范
  - 删除 `project-aigcgateway.md`（拆分）、`feedback-testing-strategy.md`（合入 evaluator）、`feedback-harness-system.md`（已被 harness-rules 覆盖）、`project-ui-refactor-plan.md`（合入 project-status）
- `MEMORY.md` 索引改为分层格式（T0/T1/T2），T1 带触发条件标注
- `harness-rules.md` §记忆分层：全面重写为分层加载规则 + 写入职责 + 内容边界铁律
- `harness-rules.md` §启动流程第零步：加载指令改为 T0→T1→T2 分层
- `harness-rules.md` §第五步：更新 project-status.md（覆盖写）+ session_notes
- `planner.md` §done 收尾步骤 1：从"重写记忆"改为"校验整合 project-status.md"
- `progress.json` 新增 `session_notes` 字段：同角色跨会话叙事上下文

**设计原则：**
- project-status.md = WHAT（会变的事实），role-context = HOW（稳定的规范），不混放
- role-context 禁止写计划/决策/进度
- 每条信息只存一处，不重复 progress.json 已有的结构化数据
- 启动加载量上限 ~120 行（索引 + 状态 + 环境 + 角色文件）

---

## v0.4.0 — 2026-04-08（框架同步 + 工具角色修正）

**来源批次：** R1-design-system-foundation planning 阶段框架检查
**触发原因：** 框架模板与项目根目录实际运行的规则长期脱节，README 中工具角色映射仍写 Cowork

**变更内容：**

- `framework/harness/harness-rules.md`：从项目根目录全量同步，补齐第 1.2 步（agent 自动注册）、第 1.5 步（独立任务检查）、backlog.json 规则、推送前遗漏检查、分支规则、角色动态分配、铁律第 8-9 条
- `framework/README.md`：
  - 工具角色映射：Cowork → Claude CLI（Planner + Generator），Codex（Evaluator）
  - 日常使用流程：修正状态名（reviewing → fixing/reverifying）、工具分工、会话结束流程
  - 经验教训·Harness 纪律：更新为当前工具分工，补充铁律第 9 条
- `framework/cowork-constraint-design.md`：加历史标注，说明 Cowork 已不参与，设计原则仍适用
- `framework/CHANGELOG.md`：补记 v0.3.0 后所有变更

---

## v0.3.0 — 2026-04-05（测试域归属 Codex）

**来源批次：** 压力测试批次（框架设计讨论续）
**触发原因：** Codex 具备完整的测试设计能力，由 Generator 写测试脚本缺乏独立视角，违反不自评原则

**变更内容：**
- `harness-rules.md`：Codex 角色从「验收 + 复验 + 执行」改为「测试设计 + 执行 + 验收 + 复验」；新增职责边界说明
- `generator.md`：明确不写任何测试（单元测试、E2E 脚本、压测脚本均不负责）
- `evaluator.md`：任务从两件事改为三件事（加入「设计并编写测试」）；新增步骤 2「编写测试」（含单元测试、E2E 脚本、压测脚本）；原步骤 2 变为步骤 3；重要原则补充「测试域所有者」身份

**分工结论：**
- Generator：业务代码实现，不涉及任何测试
- Codex：测试域完整所有权（设计 → 编写 → 执行 → 分析 → 报告）

---

## v0.2.1 — 2026-04-04

**来源批次：** proposed-learnings.md 首次批量处理（5 条提案，本会话确认）

**变更：**

- `framework/README.md` §经验教训·成本控制：新增"聚合型服务商图片生成不可靠，直连优先"
- `framework/proposed-learnings.md`：5 条提案全部关闭存档（2 已实现、1 写入、1 用户决策不纳入框架、1 关闭）
- `framework/cowork-constraint-design.md`（新增）：记录 Cowork 与 Claude Code CLI 约束机制差异，推荐 MEMORY.md 索引方案
- `.auto-memory/cowork-constraints.md`（新增）：Cowork 行为边界约束
- `.auto-memory/MEMORY.md`：新增 cowork-constraints.md 索引条目

**触发原因：** 项目首个完整批次（成本优化 7/7 PASS）后，整理框架自迭代机制

---

## v0.2.0 — 2026-04-05（executor 字段 + 批次类型）

**来源批次：** 压力测试批次（框架设计讨论）
**触发原因：** 压测执行被 Generator 承担，违反"不得自评"铁律；压测类任务本质是 Codex 的执行职责

**变更内容：**
- `harness-rules.md`：新增 Feature executor 字段规范（generator / codex）；新增三种批次类型（普通 / 混合 / Codex-only）；更新状态流转图；新增铁律 6、7
- `planner.md`：步骤 3 features.json 格式加入 executor 字段；步骤 5 改为"判断批次类型"——全 codex 时直接设 verifying
- `generator.md`：任务定义限定为 executor:generator 功能；步骤 1 增加筛选逻辑；新增步骤 7（Handoff 说明）
- `evaluator.md`：新增步骤 2（执行 executor:codex 功能）；步骤 3 改为条件性启动；任务定义更新为"执行 + 验收"双职责

**同期增量（v0.2.0 后期，2026-04-04）：**
- 七状态机替换原五状态：`new → planning → building → verifying → fixing ⟷ reverifying → done`（消除原 `reviewing` 双重语义）
- 工具与角色对应表新增
- 文档目录标准化：`docs/specs/` → `docs/test-cases/` → `docs/test-reports/` → `docs/archive/`
- progress.json 新增字段：`fix_rounds`、`docs`（含 spec / test_cases / signoff / framework_reviewed）

---

## v0.1.0 — 2026-04-04（初始版本）

**来源批次：** AIGC Gateway 成本优化 + Bug 修复批次（7/7 PASS）

**创建内容：**

```
framework/
├── README.md                  新项目启动指南 + 经验教训
├── harness/
│   ├── harness-rules.md       状态机规则（5 状态机，Cowork/Claude CLI/Codex 三工具协作）
│   ├── planner.md             Planner 角色指令
│   ├── generator.md           Generator 角色指令
│   ├── evaluator.md           Evaluator 角色指令
│   └── progress.init.json     初始 progress.json
├── memory/
│   ├── MEMORY.md              记忆索引模板
│   ├── user-role.md           用户信息模板
│   └── project.md             项目状态模板
└── templates/
    ├── CLAUDE.md              Claude / Codex 项目指令模板
    ├── signoff-report.md      签收报告模板
    └── features.template.json features.json 模板
```

**经验教训（已写入 README.md）：**
- Harness 纪律：Cowork 做规划和记忆，Codex 做代码实现，职责不混淆（注：v0.4.0 后调整为 Claude CLI 同时承担 Planner + Generator）
- 成本控制：聚合型服务商必须设白名单；图片健康检查止步于 L2
- Schema 变更：每个 migration 只包含一个功能；`@updatedAt` 需手动补 `DEFAULT now()`
- 跨设备协作：`.auto-memory/` 纳入 git，每次会话结束 commit + push

---

<!-- 后续条目格式：

## v0.x.0 — YYYY-MM-DD

**来源批次：** [批次名称 + signoff 文档链接]

**变更：**
- [新增 / 修改 / 删除] `framework/path/to/file.md`：[一句话描述变更内容]

**触发原因：**
[本次改动的背景，如：Evaluator 反复在某个点上 PARTIAL、新技术栈带来新约定等]

-->
