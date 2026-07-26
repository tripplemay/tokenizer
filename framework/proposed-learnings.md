# Framework 提案暂存区

> Generator 和 Evaluator 在工作中发现值得沉淀的经验时，追加到本文件。
> Planner 在 done 阶段读取本文件，逐条提交给用户确认。
> 确认后由 Planner 正式写入 `framework/` 对应文件，并在 `CHANGELOG.md` 追加记录，最后从本文件移除已确认条目。
> 已闭环条目归档到 `framework/archive/proposed-learnings-archive-vX.Y.md`。

---

<!-- 2026-05-04: v0.9.9 沉淀完成（8 条 learnings 来源 BL-030/BL-031/BL-032），全部已写入 framework/ 对应文件 + CHANGELOG。 -->

<!-- 2026-05-04: v0.9.10 沉淀完成（3 条 learnings 来源 BL-033 + prod-mvp-readiness-audit），全部已写入 framework/ 对应文件 + CHANGELOG。 -->

<!-- 2026-05-05: v0.9.11 沉淀完成（5 条 learnings 来源 BL-020 + backend-full-scan-2026-05-04 audit），全部已写入 framework/ 对应文件 + 项目根 .nvmrc + .auto-memory/environment.md + CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.11.md。 -->

<!-- 2026-05-05: v0.9.12 沉淀完成（3 条 learnings 来源 BL-034），全部已写入 pre-impl-adjudication.md §11 + database-patterns.md §8.1 + deploy-patterns.md §5 + evaluator.md §17 + CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.12.md。 -->

<!-- 2026-05-06: v0.9.13 沉淀完成（2 条 learnings 来源 BL-024），全部已写入 deploy-patterns.md §5.1 + ai-action-contract.md §4.7 + CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.13.md。 -->

<!-- 2026-05-06: v0.9.14 沉淀完成（2 条 learnings 来源 BL-040 + BL-041 audit 过期 + BL-043 staging fix），全部已写入 planner.md 铁律 1 矩阵 +2 行延伸 + deploy-patterns.md §1.7（v0.9.7 §1.6 范围扩展）+ CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.14.md。 -->

<!-- 2026-05-07: v0.9.15 沉淀完成（2 条 learnings 来源 BL-021 F002 撤再翻盘 + BL-049 测试基建 audit），全部已写入 planner.md 铁律 1 矩阵 +2 行（v0.9.15 #1 跨 pool 复现 + #2 stub environment-agnostic）+ CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.15.md。 -->

<!-- 2026-05-08: v0.9.16 沉淀完成（1 条 learning 来源 BL-052 verifying P5 裁决），全部已写入 planner.md §"Planner 裁决职责" §P5.2 段 + CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.16.md。 -->

<!-- 2026-05-08: v0.9.17 沉淀完成（1 条 learning 来源 BL-012 apify-kol fork audit），全部已写入 planner.md 铁律 1 矩阵 +1 行（v0.9.17 记忆条目陈旧风险）+ 反面案例段（BL-012 5/7→5/8 实战）+ CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.17.md。 -->

<!-- 2026-05-08: v0.9.18 沉淀完成（1 条 learning 来源 BL-012 F001 fix-round 1 admin role enum mismatch），全部已写入 planner.md 铁律 1 矩阵 +1 行（v0.9.18 auth role enum 实物核查）+ CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.18.md。 -->

<!-- 2026-05-08: v0.9.19 沉淀完成（1 条 learning 来源 BL-012 F002 fix-round 2 prod zod schema mismatch），全部已写入 planner.md 铁律 1 矩阵 +1 行（v0.9.19 external API response zod schema 实物 sample 验证）+ CHANGELOG。归档：framework/archive/proposed-learnings-archive-v0.9.19.md。 -->

<!-- 2026-05-10: v0.9.20 沉淀完成（1 条 learning 来源 BL-060 fix-round 1→2 e2e suite-level isolation vs 单 case 信号区分），写入 .auto-memory/role-context/evaluator.md §"E2E suite 稳定性诊断" + .auto-memory/role-context/generator.md §"扩范围 vs 单点修的判断"。后续 batch 候选（抽 tests/e2e/helpers/auth.ts + global-setup.ts + storageState 复用）入 backlog 跟踪。归档暂未写 framework/archive/proposed-learnings-archive-v0.9.20.md（git history 已有 commits cae1f8f / 821c094 完整记录）。-->

<!-- 2026-07-09: v1.0.0 沉淀完成（1 条 learning 来源 BL-064 IA refactor redirect scope），写入 memory/role-context/generator.md §"IA refactor redirect scope 评估" + memory/role-context/planner.md §"IA refactor 类批次 redirect 清单评估" + CHANGELOG。归档：framework/archive/proposed-learnings-archive-v1.0.md。 -->

---

## [2026-07-12] Claude（harness-fit 分析 · 独立任务）— 来源：单工具 Claude + dynamic Workflow 工作流契合度评估（本会话 workflow wt27gd5xu，三视角 + 红队对抗复核）

**背景：** 用户已把主 coding 工作流收敛到单工具（仅 Claude Code），编码阶段用 Claude dynamic Workflow 编排。评估结论：harness 高契合且真提质，但价值不对称——**契约纪律 + 持久骨架**是纯增量（引擎给不了），**阶段内部编排**与引擎重叠、**多工具/多机底座**大部分是死重。以下提案已经过红队校准（推翻了"状态机=冗余仪式""慢车道=死重""Workflow 1:1 替代无自评"三个过度自信结论）。

---

### P0 —— 正确性前置（naive 上 Workflow 会踩的坑）

**P0-1 · 类型：新坑 / 铁律补充**
- **内容：** Claude Workflow 的 loop-until-done 天生会自主推进到"完成"并自排下一步，直接违反 `orchestration-patterns.md` §6 硬铁律「→verifying / →done 不得在无人值守循环中自动完成」。把阶段内部交给 Workflow 时，若不定契约就是**正确性回归**，不只是重复仪式。
- **建议写入：** `harness/orchestration-patterns.md` 新增「§8 Workflow run ⇄ progress.json 日志契约」小节（引擎只跑阶段内部、绝不 flip status 跨阶段；每步结果落盘持久文件；中途崩溃逐条对账）+ `harness-rules.md` 铁律区补一条呼应。
- **状态：** 部分落地 —— §8 已写入 `orchestration-patterns.md`（CHANGELOG v1.0.2）；剩余待确认：`harness-rules.md` 铁律区呼应条。

**P0-2 · 类型：新坑（最高风险）**
- **内容：** 沉淀闭环是事故驱动的，靠每批次一份 Evaluator 验收记录喂养。in-tool Workflow 若只在 context 里验完、不落"命名验收工件（BL-id + verdict + fix_round）"，`proposed-learnings.md` 会因**无 emitter 而静默饿死**（本文件现已显示"当前无待确认提案"即征兆）。这是模块级、产品级的静默失败——维护闭环本身就是本框架的产品。
- **建议写入：** `harness/orchestration-patterns.md` §4 + §8 + `templates/claude/skills/verify/SKILL.md`（verify 每轮必须持久化命名验收工件回喂沉淀，不可省）。
- **状态：** 部分落地 —— §8 契约 4 已写入 `orchestration-patterns.md`（CHANGELOG v1.0.2）；剩余待确认：verify SKILL.md 改写（Patch B，未落）。

**P0-3 · 类型：模板修订**
- **内容：** `/verify` step 3、`/build` step 5 把 fan-out/并行以**散文指针**（"按 §4 / §3"）交付，未真正 invoke Workflow——按框架自己"装进工具链才是强制"的标准，这层仍停在"写在文件里"。注意：fan-out 是**尾部场景**（触发门 ≥4 features），日常默认=单个隔离 evaluator subagent 本就 native，**不要把机制化 fan-out 当最高优先级**（红队降级）。
- **建议写入：** `templates/claude/skills/verify/SKILL.md` step 3 / `templates/claude/skills/build/SKILL.md` step 5 改为触发门命中时真正调 Workflow，并显式"停在阶段边界交还用户"。
- **状态：** 待确认

### P1 —— 结构精简 + 定位重申

**P1-1 · 类型：新规律（红队纠正，勿一刀切）**
- **内容：** 慢车道拆分：git **同步总线**语义单机确为死重，但两样单机也真实的能力搭在同一标签上不可一起砍——① **独立会话 evaluator** 是比 subagent **更强**的独立性（无编排者写的 prompt，免疫铁律 12 的作者污染风险）；② **跨会话/抗压缩交接**（多日批次 + 压缩会在同一会话内重现"新读者"问题）。
- **建议写入：** `docs/01-concepts.md` 慢车道段 + `harness/orchestration-patterns.md` §7（区分"同步总线"与"独立会话隔离 / 跨会话持久"两类，前者可选、后者保留）。
- **状态：** 待确认

**P1-2 · 类型：模板修订**
- **内容：** 快车道热路径剥离慢车道底座：`/plan /build /verify` step 1 的 `git pull --ff-only` + `.agent-id`/`.agents-registry` 读、`session-start.sh` 的 `role_assignments` 注入、`bootstrap.sh:71` 无条件铺 `AGENTS.md`——单机全是空转仪式，改为多机模式 opt-in。
- **建议写入：** 三个 skill SKILL.md step 1 + `templates/claude/hooks/session-start.sh` + `bootstrap.sh`。
- **状态：** 待确认

**P1-3 · 类型：新规律（定位重申）**
- **内容：** 把 harness 明确定位为坐在 Workflow 引擎之上的**薄契约纪律 + 持久骨架层**：引擎给编排**形状**，harness 给**常设默认强制 + 约束载荷（受限工具集 / 只认实物 / 误报预检 / 测试设计权）+ 用户闸门 + 抗压缩骨架**——这四样引擎都没有。
- **建议写入：** 新增 `harness/workflow-bridge.md`（角色 ⇄ Workflow stage 映射；标注哪些规则由引擎结构性强制、哪些仍是散文护栏）。
- **状态：** 待确认

### P2 —— 清理与补缺（须外科式，勿误伤承重项）

**P2-1 · 类型：铁律澄清（红队纠正）**
- **内容：** 机制化其实比宣传的薄：唯一硬阻断是 `validate-state-json.sh`（还只查 JSON **语法**，不查"status=done 但 signoff 为空"这种语义）；无自评 / done-门 / 裁决不洗白 / spec 源码核查**都活在散文里**。推论："砍散文仪式"必须外科式，勿把承重约定当仪式误删。
- **建议写入：** `harness-rules.md` §机制化守门（标注"当前硬阻断仅覆盖 JSON 语法，语义门仍靠约定"）。
- **状态：** 待确认

**P2-2 · 类型：新坑**
- **内容：** `executor:generator|evaluator` 是**活的路由位**（把报告类任务路进 verifying、选 Evaluator-only 批次流），与已死的 `executor:"codex"` 别名同段落；清 Codex 血缘时须**外科分离**，勿连带误删路由。
- **建议写入：** `harness-rules.md` lines 47/108 + `evaluator.md` + `planner.md` 相关行的清理注意事项。
- **状态：** 待确认

**P2-3 · 类型：新坑**
- **内容：** 对抗复核的误报目录（`patterns/testing-env-patterns.md`）是 **stack-coupled**（Prisma/Next/Postgres-RLS），换技术栈大半不可移植，且框架无"给新栈重播种目录"的机制。
- **建议写入：** `patterns/testing-env-patterns.md` 顶部标注适用栈 + 提供"新栈重播种"指引。
- **状态：** 待确认

**P2-4 · 类型：模板修订（与上一轮接入缺口同源）**
- **内容：** 补存量项目接入路径：`bootstrap.sh` 遇 `harness-rules.md` 存在即 abort（仅 greenfield）；加 `--adopt` 模式只装 `.claude/` 机制层（hooks + evaluator subagent + skills + progress.json），跳过 memory/spec 脚手架。
- **建议写入：** `bootstrap.sh` + `docs/03-quickstart.md` 补一节「已有项目接入」。
- **状态：** 待确认

**P2-5 · 类型：铁律澄清**
- **内容：** commit 粒度：per-feature commit 的**跨设备恢复**理由单机已失效，仅**抗压缩**承重（写状态文件即可恢复，逐 feature 打 git commit 是额外审计/回滚开销）；可放宽为 per-phase-boundary commit（保留状态文件写入 + JSON hook）。
- **建议写入：** `harness-rules.md` 铁律 2/3 理由重述（"跨设备恢复 + 抗压缩" → "抗压缩持久 + 审计轨迹"）。
- **状态：** 待确认

<!-- 2026-07-13: 自主开发模式 + 进度看板 沉淀完成（用户确认，默认安装）。
     自主：机件转正入 templates/claude/{agents/{generator-restricted,spec-lock-critic}.md, skills/autodrive/, autonomous/*}；harness/autonomous-mode.md 转正为 T2 规范。
     看板：templates/dashboard.template.html + templates/claude/skills/dashboard/SKILL.md + progress.init.json(dashboard_url) + bootstrap chmod + harness-rules §四 + templates/CLAUDE.md。
     CHANGELOG v1.0.3。归档：archive/proposed-learnings-archive-v1.0.3.md。
     注：harness-fit 分析（P0-P2）不在本次确认范围，仍保留待确认。 -->

<!-- 2026-07-25: Dispatch Mode 沉淀完成（用户确认四项裁决，默认安装但 inert）。
     机件入 templates/claude/dispatch/{sandbox-profile.sh, agents-registry.schema.json, agents-registry.example.json,
     dispatch-envelope.schema.json, validate-dispatch.sh, transports/{local-cli.md, a2a.md, adapters/codex.json}}；
     harness/dispatch-mode.md 为 T2 规范。既有机件修订：verdict-artifact schema+validator 加 waiting 中断态、
     gate-arbiter 加 dispatch 分支与 family 轮换、harness-rules 三形态+独立性铁则第5条+守门表、
     orchestration-patterns §7、bootstrap chmod/.gitignore、templates/CLAUDE.md。CHANGELOG v1.1。
     来源：docs/a2a-harness-research-2026-07-25.md。
     仍待建见 dispatch-mode.md §9（Codex 适配器端到端演练 / /autodrive 耐久层四职责 / tag rewrite 策略 /
     第二家适配器 / a2a transport）——沿用「机件没建好不许开车」，适配器核对未过不许接 autodrive。 -->

<!-- 2026-07-25: Dispatch Mode 待建项收口（v1.1.1）。Codex 适配器经 codex-cli 0.145.0 端到端演练转正
     （_verified:true）；/autodrive 耐久层四职责接线；tag 策略定为「拒收不重写」。
     🔴 实测安全发现：外部 CLI 用登录 shell（/bin/zsh -lc）执行命令，会 source ~/.zshenv|~/.zprofile
     把 env -i 剥掉的变量原样还回 → sandbox.home_dir 升为硬性前置（schema+校验器+沙箱三处 fail-closed）
     + 新增 sandbox.env_set 精确投喂认证目录，残余风险 R1 关闭。
     附带修：适配器显式传厂商沙箱参数防 config 削弱；$VAR 紧跟 CJK 全角字符导致 bash unbound（4 处 → ${VAR}）。
     CHANGELOG v1.1.1。未做：Gemini 适配器（本机未装，未实测不入模板）、waiting 路径真实触发、
     /autodrive 全循环自主演练、a2a transport。 -->

<!-- 2026-07-25: a2a transport 实装（v1.2，用户确认 C 档）。新增 transports/a2a-runner.py（长驻 A2A
     服务端：JSON-RPC + SSE + 落盘 task store + 幂等 + Last-Event-ID 重放 + 重启孤儿清理）、
     transports/a2a-client.py（hub client）、dispatch-run.sh（统一入口，按 transport 路由）；
     gate-arbiter 判据改 !== 'subagent' → 引擎 transport 无关；/autodrive 步骤 0 增 runner 存活断言。
     认知修正：R4「沙箱在 a2a 下失效」对自建 runner 不成立——runner 在本机调 sandbox-profile.sh，
     四道锁完整；R4 仅适用于不受控的第三方对端。
     实测修掉的协议瑕疵：SSE 以 state 为收流判据会漏发终态事件（直播缺、重放有）→ 改用独立
     events_complete 标志 + 收流前最后排空。
     演练 10 项全通，含真实 Codex 经 a2a 198s 长任务 SSE 全程保活。CHANGELOG v1.2。
     刻意不做：gRPC/REST 绑定、扩展协商、签名 Card、push webhook、OAuth/mTLS（子集实现，非一致性认证）。
     未做：真实跨机器演练（loopback 已验证网络路径与鉴权）。 -->

<!-- 2026-07-25: Kimi CLI 适配器接入（v1.2.1）。kimi-code 0.26.0 端到端演练通过并转正
     （_verified:true），轮换池凑齐 claude × codex × kimi 三个 family。
     两处沙箱能力补齐（Kimi 逼出来的）：{{envelope_json}} 内联投递（Kimi prompt 走 argv 不读 stdin）、
     子进程 CWD 固定为 worktree（Kimi 无 -C/--cd 工作根参数）。
     🔴 修掉一个自引入缺陷：sandbox.home_dir 未做 ~ 展开（只有 env_set 做了），后果两层——
     子进程把 HOME 当相对路径在 CWD 下造字面量 `~/` 垃圾目录；更要命的是 dotfile fail-closed 断言
     会去检查一个不存在的相对路径而静默通过，等于 L1 护栏被悄悄削掉。修：展开+绝对化，
     且「必须以 / 或 ~ 开头」的判据放在展开**之前**（abspath 会把相对路径也变绝对，放之后等于没判）。
     安全姿态记录：Kimi prompt 模式隐式全批准且拒绝一切权限旗标（--auto/--yolo 均 Cannot combine），
     厂商侧零约束——不像 Codex 还有 -s workspace-write 兜底，机件 #7 是唯一防线。
     CHANGELOG v1.2.1。 -->

<!-- 2026-07-25: Console Mode（v1.3）。控制台 = 观测面 + 人闸门，不是编排者（hub 形态与 git 单一真相源
     不可动）；传输用 git，不依赖 GitHub API。地基是新增 progress.json.pending_gate ——
     此前闸门只有散文（session_notes）与事后记录（autonomy.last_halt），没有可回写的决策槽位。
     🔴 decision 只有人类/控制台可写，agent 侧由 validate-pending-gate.sh guard 在内容层机械拦截
     （工具层拦不住，因为 progress.json 必须允许 agent 写 status）。陈旧批准由 gate_id 匹配防护。
     修两个缺陷：默认端口 8787 与本机 node 服务冲突改 41300；guard 里 heredoc 覆盖管道 stdin
     导致 HEAD 恒空、合法批准被误判为本地新增（只在合法路径暴露）→ 改临时文件传参。
     未实装：P3 日志上报（含凭据片段落盘的责任）、P4 云端调度（需 runner 反转为出站连接穿 NAT）。 -->
