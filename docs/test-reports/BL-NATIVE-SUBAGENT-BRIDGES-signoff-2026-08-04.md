# BL-NATIVE-SUBAGENT-BRIDGES Signoff 2026-08-04

> 状态：**Evaluator 已签收（全 PASS）** — 建议 progress.json 由 `reverifying` 推进至 `done`（先经人工闸门）
> 触发：第 3 轮 fixing 完成（`ce249dc`），F003 终轮聚焦复验 PASS，批次五个 feature 至此全部 PASS
> 签署人：**Andy/evaluator-subagent**（fresh-context 隔离实例）
> 签署 SHA：`ce249dc3c431e95a42603e6209158de1a1620f3f`（签署时核对 HEAD 一致；工作树除 Evaluator 测试产物外干净）

---

## 变更背景

用户要求为 Codex 与 Kimi 评估并建立 Harness 自有的**同会话子代理桥接**，并让未来具备同等能力的
新 CLI 能**自动**进入工具目录与角色调度规则，而不是靠按工具名写死的白名单。本批次以声明式
bridge manifest + verified adapter + strict `vm-v1` provider attestation 取代了旧的
`subagent: true` 布尔值：Kimi 成为可发布的 external same-session bridge，Codex 保持已验证的
`local-cli`（其 App Server `thread/fork` 明确**不**被当作 child-agent 证据）。

批次经历 `planning → building → verifying → fixing ⟷ reverifying`，共 **3 轮 fixing**：

| 轮次 | 触发问题（原始结论摘要） | 修复 commit |
|---|---|---|
| 1 | 首轮 fan-out：F001/F003/F004 FAIL、F005 PARTIAL —— strict-provider fail-closed 把 Kimi bridge 永久隐藏 | （FIX1 裁决后）`172ed42` 前序 |
| 2 | F003 PARTIAL —— `vm-v1` launch 重解析用 `python3 -I` 调带同级导入的 catalog，生产路径必炸，F003 runner 从未真正执行过 | `abf7a6e` |
| 3 | F003 PARTIAL —— planner/`plan` persona 4/4 确定性失败（厂商只读 profile × 协议强制落盘的**结构性冲突**），经 FIX2 裁决 `#1:A #2:A #3 #4` | `6b8900b` + `4cf44df` |

---

## 一、五个 Feature 的最终判定（机械汇总，未改写任何结论）

> 下表每条结论均**逐字取自磁盘上对应轮次的验收报告**。本签收不重判、不软化、不合并任何原始判定。

| Feature | 标题 | executor | **最终判定** | 判定来源（轮次 / 锁定 SHA） | 原始证据文件 |
|---|---|---|---|---|---|
| **F001** | 声明式同会话 bridge 注册与能力目录 | generator | **PASS** | reverify round 1（fix_rounds=1）@ `172ed42b` | `BL-NATIVE-SUBAGENT-BRIDGES-reverify-F001-2026-08-04.md` §5 + `docs/test-reports/evidence/BL-NATIVE-SUBAGENT-BRIDGES-F001-2026-08-04/` |
| **F002** | Codex local-cli 保持与 external bridge 禁止 | generator | **PASS** | reverify round 1（fix_rounds=1）@ `172ed42b` | `BL-NATIVE-SUBAGENT-BRIDGES-reverify-F002-2026-08-04.md` §6 |
| **F003** | Kimi ACP 原生 Agent 子代理 bridge | generator | **PASS** | **reverify round 3（fix_rounds=3）@ `ce249dc3`** | `BL-NATIVE-SUBAGENT-BRIDGES-reverify3-F003-2026-08-04.md` §10 + `BL-NATIVE-SUBAGENT-BRIDGES-F003-r3-planner-launch-audit.json` |
| **F004** | 模式签发、设备目录与动态界面桥接语义 | generator | **PASS** | reverify round 1（fix_rounds=1）@ `172ed42b` | `BL-NATIVE-SUBAGENT-BRIDGES-reverify-F004-2026-08-04.md` §5 |
| **F005** | 真实探针、回归矩阵与独立验收 | **evaluator** | **PASS** | reverify round 2（fix_rounds=2）@ `7a84b0df` | `BL-NATIVE-SUBAGENT-BRIDGES-reverify2-F005-2026-08-04.md` §8 + `…-F005-r2-probe-audit-2026-08-04.json` |

**合计：PASS 5 / PARTIAL 0 / FAIL 0。**

### 1.1 各 feature 结论原文摘录（不改写）

- **F001（round 1）：** "F001 的五项验收…在锁定 SHA 上**均以实际命令输出得到证实**，框架与 Tokenizer
  catalog mirror 判定一致，上轮 FAIL 的'bridge 永久隐藏'根因已消除（限于 provider attest 有效期内）。**判定：PASS**"
- **F002（round 1）：** "**F002 = PASS。** 三条 acceptance 全部满足，且本轮以差分实验把'Codex 未发布 bridge'
  从弱证据…提升为**强证据**（闸门打开时 Kimi 发 3 个、Codex 仍发 0 个）…App Server fork 在
  catalog / 运行期协议 / receipt / sandbox 四层均保持 fail-closed，未生成任何 Codex bridge receipt。"
- **F003（round 3）：** "**F003 = PASS。** acceptance **A–H 八条全部达成**，新增裁决 **D8 / D9 的语义亦逐条实测达成**。
  上一轮唯一阻断（acceptance F：planner persona 生产路径结构性不可用，4/4 确定性失败）**已消除**…
  本人 3 次真实 launch 中 2 次成功，且 1 次失败经**逐字重放对照**证明为非确定性、fail-closed 的偶发。"
- **F004（round 1）：** "**F004 = PASS。** heterogeneous 的签发语义（bridge + local-cli 可组合、a2a 仍拒、
  family 互斥仍在、slow 仍需 a2a）、TypeScript catalog mirror 与服务端 intent 校验的一致性…均按 acceptance
  逐条实测通过；准入门槛是 strict VM provider 的 live attestation 与 bridge protocol，而非工具名。"
- **F005（round 2）：** "**结论：PASS**…**但 PASS 仅限 F005。** OBS-1（planner persona 3/3 不可用）落在
  F003/F001 的验收面上，且 F005 acceptance 里'全 PASS 后举闸门'的前置条件因此**尚未自动满足**——
  闸门是否可举，取决于本轮 F003 复验结论与编排者的汇总，不由本报告决定。"
  > **本签收对该悬置条件的处置：** F005 当时悬置的前置条件（OBS-1 / planner persona 可用性）
  > 已由第 3 轮 F003 复验以真实 launch 证据消解（见 reverify3 §5–§6 条款 F）。故 F005 的 PASS
  > 不再附带未决前置条件。

### 1.2 判定 SHA 差异的诚实声明（**签收人必须点明**）

F001 / F002 / F004 的 PASS 是在 `172ed42b` 上做出的，**不是**在签署 SHA `ce249dc3` 上。
其后落地的产品代码提交为 `abf7a6e`（F003 launch 路径修复）、`6b8900b`（D8/D9 通道）、
`4cf44df`（TS 镜像）。我在第 3 轮**没有**重跑这三个 feature 的完整原始验收套件，
但在 `ce249dc3` 上**重新实测覆盖了它们的可观测面**，结果如下（细节见 reverify3 §2、§4、§7）：

| 面 | 归属 | 在 `ce249dc3` 上的实测结果 |
|---|---|---|
| 三角色 kimi subagent 候选发布 + 目录不含工具名特判 | F001 | 通过（planner/generator/evaluator 各 1 个 subagent 候选） |
| target 携带 bridge provenance 与 `execution_provenance_sha256` | F001 | 通过；且新增 `deliverable_channel` 已进入 provenance（受控单变量突变证明） |
| 未知 / 未验证 / 越角色 / 漂移 bridge fail-closed | F001 | 通过（catalog 4 类突变 + provider/worker 两层 + 启动层 N1–N4） |
| **Codex 零 subagent 候选、无 bridge provenance** | F002 | 通过（catalog 实测 Codex 仅 a2a/local-cli）；`test-session-bridge-codex.py` 9 tests OK |
| TS catalog mirror 与框架同形状校验（含新增通道字段） | F004 | 通过（`harness-tool-catalog.test.ts` 77 passed；全量 vitest 909 passed） |
| profile 语义（heterogeneous 组合、a2a 拒绝、family 互斥） | F004 | 未观察到变更或退化（相关代码在 `172ed42..HEAD` 区间无改动，vitest 全绿） |

**结论：未发现任何跨 feature 回归。** 若签收标准要求"全部 feature 均在最终 SHA 上完整重验"，
则本条为已知偏差，需由人类在闸门处知情接受；我的判断是：变更面已被上表逐项覆盖，
重跑完整套件的边际信息量低，不构成放行风险。

---

## 二、L1 / L2 执行情况

### 2.1 L1（本机，签署 SHA `ce249dc3`，全部由签收人亲自运行）

| 套件 | 规模 | 结果 |
|---|---|---|
| `.claude/dispatch/test-tool-catalog.py` | 38 | OK |
| `.claude/dispatch/test-lifecycle.py` | 51 | OK（**skipped=0**，FIX2 #3 已落地） |
| `.claude/dispatch/test-session-bridge-kimi.py` | 20 | OK |
| `.claude/dispatch/test-vm-bridge-provider.py` | 13 | OK |
| `.claude/dispatch/test-generator-handoff.py` | 12 | OK |
| `.claude/dispatch/test-accept-generator-handoff.py` | 11 | OK |
| `.claude/dispatch/test-session-bridge.py` | 9 | OK |
| `.claude/dispatch/test-session-bridge-codex.py` | 9 | OK |
| `.claude/dispatch/test-external-bridge-receipt.py` | 8 | OK |
| `.claude/dispatch/test-planner-proposal.py` | 7 | OK |
| **framework 小计** | **178** | **10/10 套件全绿** |
| `scripts/test/f003r3_terminal_message_channel_probe.py`（签收人新写独立探针） | 11 | OK |
| `npx vitest run tests/cli/harness-tool-catalog.test.ts` | 77 | passed |
| `npm run test`（全量） | 60 files / 913 | **909 passed / 4 skipped，exit 0** |
| `npm run verify`（prisma generate + tsc --noEmit） | — | **exit 0** |
| `npm run lint` | — | **exit 0，No ESLint warnings or errors** |

> L1 前置检查已按 `framework/patterns/testing-env-patterns.md` 执行（`npm run verify` 内含
> `prisma generate`，未出现 PrismaClient 类型误报）。本批次无 schema 迁移、无字体子集、
> 无 fire-and-forget audit 模式，其余已知误报模式不适用。

### 2.2 L2（用户已授权；跨轮次汇总）

| 轮次 | L2 动作 | 结果 |
|---|---|---|
| round 1（F001/F002/F004） | 最小 `kimi -p` 刷新 OAuth 使 provider 可 attest；**Codex local-cli health check** | provider attested；Codex health exit 0 |
| round 2（F005） | **2 次真实 parent-child bridge probe**（无源码写入）+ 结构化脱敏审计 | 2/2 合格；证据脱敏 0 泄漏 |
| round 2（F003） | 3 次真实 launch（evaluator 51s ✓ / planner 207s ✗ / generator 52s ✓） | 暴露 planner 结构性冲突 → FIX2 |
| **round 3（F003，本签收）** | **3 次真实 planner/`plan` launch**（terminal-message 通道） | **2 次成功（73s / 104s）、1 次非确定性 fail-closed 失败** |

**L2 边界遵守情况（签收人自证）：** 凭据仅经 provider broker 进入 worker；未读取、未复制用户
Kimi `wire.jsonl` / session / 凭据文件（对 CLI bundle 的检视限于 provider 自己 staged 的只读副本）；
所有落盘证据中 session id / nonce / call id 一律为 sha256 摘要，敏感标记扫描 **0 命中**；
copy-in 归档 930 条目对 `kimi-code|credentials|.kimi/|wire.jsonl|oauth|.ssh|.aws` 检索 **0 命中**；
三次 planner run 的 `source_changes` 均为 `[]`。

**未执行的 L2：** 无生产部署、无本机 Agent 升级、无数据库 ops。

---

## 三、证据文件索引（磁盘实物，逐份可复核）

| 文件 | 内容 | 产出轮次 |
|---|---|---|
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-fanout-2026-08-01.json` | 首轮 fan-out 派发记录 | verifying |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-verdict.json` | 首轮机械 verdict（F001 FAIL 等原始结论，保留不改） | verifying（fix_round 0） |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-adversarial-review-2026-08-04.md` | 证伪式交叉复核 | verifying |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F001-2026-08-04.md` | **F001 PASS** 原始报告 | reverify r1 |
| `docs/test-reports/evidence/BL-NATIVE-SUBAGENT-BRIDGES-F001-2026-08-04/` | F001 原始命令输出（catalog / targets / mirror / provider attest） | reverify r1 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F002-2026-08-04.md` | **F002 PASS** 原始报告（含差分排除实验） | reverify r1 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F003-2026-08-04.md` | F003 第 1 轮 PARTIAL 原始报告 | reverify r1 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F004-2026-08-04.md` | **F004 PASS** 原始报告（含 S1–S3 观察） | reverify r1 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F005-2026-08-04.md` | F005 第 1 轮 FAIL 原始报告 | reverify r1 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F005-probe-audit-2026-08-04.json` | F005 r1 探针脱敏审计 | reverify r1 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify2-F003-2026-08-04.md` | F003 第 2 轮 PARTIAL（planner 4/4 失败根因定位） | reverify r2 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify2-F005-2026-08-04.md` | **F005 PASS** 原始报告（含 OBS-1/2/3） | reverify r2 |
| `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F005-r2-probe-audit-2026-08-04.json` | F005 r2 真实 probe 脱敏审计 | reverify r2 |
| **`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify3-F003-2026-08-04.md`** | **F003 PASS** 终轮报告（A–H + D8/D9 逐条） | **reverify r3** |
| **`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-F003-r3-planner-launch-audit.json`** | 3 次真实 planner launch 的脱敏结构化审计 | **reverify r3** |
| **`scripts/test/f003r3_terminal_message_channel_probe.py`** | 签收人新写的 terminal-message / D9 独立探针（11 例） | **reverify r3** |
| 规格与裁决 | `docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-spec.md`（含 D8/D9）、`…-FIX1-strict-provider-adjudication.md`、`…-FIX2-planner-persona-adjudication.md` | planning / fixing |

---

## 四、遗留非阻断观察清单（Soft-watch）

> 全部为 low–medium 风险，**不阻塞 done**，但需记账。ID 前缀标注来源报告。

| ID | 描述 | 风险 | 建议处置 |
|---|---|---|---|
| **R3-9.1** | **planner 真实 run 偶发失败且不可自助诊断。** 签收人 3 次真实 planner launch 中 1 次失败（314s 后 `exit=2`），host 侧只得到通用 `VM restricted provider unit failed`；guest stdout/stderr 按设计不外泄、job 目录已按设计收割，故失败语义无法还原。同契约逐字重放即成功 → 非确定性、fail-closed（无产物/无源码写入） | **medium** | 让 provider 以**受限枚举/白名单**回传 guest 侧失败类别（只回错误类别，不回任何模型文本）。否则每次偶发失败要烧掉一次 wall-clock（最坏 2400s）且无法定位 |
| **R3-9.2** | **`terminal-message` 的 `O_EXCL` 与 D9 覆盖语义未对齐。** driver 以独占创建物化 artifact，故受托路径若已存在于 copy-in baseline，terminal-message 角色会在物化阶段 fail-closed —— D9"受托路径是合法覆盖点"目前只对 `file` 通道可达 | low | 后续批次对齐：要么 driver 允许受托路径覆盖，要么在 D8 写明该例外。planner 规范路径含唯一 task_id，实际碰撞概率低 |
| **R3-9.3** | `_agent_message_text` 汇总的是根会话**整个 session** 的全部 `agent_message_chunk` 并拼接，而非严格意义的"最终消息"；根会话若先有旁白会被前置进 artifact（本轮两次成功 run 产物干净） | low | 收敛物化范围到 child 完成事件之后的文本，使实现与 D8 措辞严格一致 |
| **R3-9.4** | 凭据 TTL ≈ 15 分钟仍造成目录可见性抖动（fail-closed 设计，行为正确）。本轮开工时 doctor 即报 `credential expires too soon`，三角色候选被隐藏 | low | 建议 doctor 输出剩余有效期；`/plan` 边界前提示刷新 |
| **R3-9.6** | `kimi` integration 的 `sandbox.env_set.KIMI_CODE_HOME` 对 bridge 路径无效（provider 全文不引用 `env_set`/`sandbox`），易误读 | low | 已按 FIX2 #4 登记 backlog `BL-REGISTRY-LAZY-FIELD-CLEANUP`，本批次未动 registry（符合裁决） |
| **R1-F004-S1** | 通用 ACP 驱动模块名为 `session_bridge_kimi.py` 并被完整性清单固定；功能中立但**命名**易被误读为工具特判 | low | F001/F003 后续整洁性改进 |
| **R1-F004-S2** | `ModeEditor` 的 `SelectedRoleContext`「可用工具」面板直接用传入的 `tools` 不自行过滤 proof；当前生产路径上游已过滤，若未来有调用方绕过 detail 解析直传目录则会显示不可选 bridge | low | 组件健壮性 soft-watch |
| **R1-F004-S3** | 并行 evaluator 的 untracked 探针脚本会让共享工作树 `npm run verify` 变红 | low | 编排者在合并/提交前处理（本次签署时 `npm run verify` exit 0） |
| **R3-9.5** | 签收人最小 planner 探针产物未过 `validate-planner-proposal.sh` 完整性检查（`spec:null` + 空 `features`）—— 系**探针契约形态**所致，非 bridge 缺陷 | 信息性 | 记录以免后续误读证据 |

> 已被本批次**关闭**的历史观察，不再列入遗留：
> R2-F005-OBS-1（planner persona 不可用 → 由 D8 + 终轮真实 launch 消解）、
> R2-F005-OBS-2（evaluator 交付路径与 baseline 冲突 → 由 D9 消解，探针第 8–10 例证实）、
> R2-F005-OBS-3（test-lifecycle 两条过时 skip → FIX2 #3 删除并留属性映射注释，现 skipped=0）、
> R2-F003-§9.1（应用包 `dispatch-run.sh` 未同步 → 三方 13 文件现已 IDENTICAL）。

---

## 五、未变更范围

| 事项 | 说明 |
|---|---|
| Codex external bridge | 按 spec §2.2 非目标，本批次不注册、不发布 candidate、不把 session fork 命名为原生 spawn（F002 已实测四层 fail-closed） |
| 用户已打开的 Codex/Kimi TUI 会话 | 不附着、不读取、不复用；bridge 只用 Harness 自有 parent session |
| Generator source-handoff / A2A Generator 禁止 / model-family 互斥 / 人工 done 闸门 / 外部进程安全边界 | 均未放松（`test-generator-handoff` 12 + `test-accept-generator-handoff` 11 全绿） |
| 项目 registry `.agents-registry.json` | 本批次未改（FIX2 #4 惰性字段清理已入 backlog） |
| 生产部署 / 本机 Agent 升级 / 数据库 | 本签收期间零操作 |

---

## 六、Ops 副作用记录

**本批次无数据库 ops。** 签收期间未在 prod / staging 执行任何 SQL。

---

## 七、L2 实测记录（Staging）

**无 staging 影响 — N/A。** 本批次改动集中在 Harness dispatch 框架（`.claude/dispatch/**`、
`framework/templates/**`）与本机 Agent 的 TypeScript catalog mirror（`src/cli/harness-tool-catalog.ts`）；
无 Web 页面、无 API 契约、无 schema 迁移。L2 实测以**真实 Kimi bridge launch** 与
**Codex local-cli health check** 的形式执行，记录见 §2.2 与各轮报告。

> 附注（非阻断，供人类知情）：`4cf44df` 触碰 `src/cli/**`，已由用户批准推送并触发过一次
> **无迁移部署**；生产当前运行状态由编排者/用户掌握，不在本签收的验收面内。

---

## 八、Harness 说明

本批改动经 Harness 状态机完整流程交付：`planning → building → verifying → fixing ⟷ reverifying`
（3 轮 fixing）。三轮验收全部在**隔离上下文的 fresh-context Evaluator** 中进行，结论原样落盘，
未由主上下文改写或软化——包括第 2 轮 F003 由 Evaluator 依 F005 交叉证据**自行把初版 PASS 改判为 PARTIAL** 的记录。

**待编排者执行（不由本签收人代劳）：**

1. `progress.json.docs.signoff` = `docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-signoff-2026-08-04.md`
2. `progress.json.evaluator_feedback` 更新为终轮机械汇总（pass_count=5 / partial=0 / fail=0）
3. `features.json` 五条均为 `completed`（当前已是）
4. 提交并推送本签收产物（签收人按指令**未** `git add` / `commit`）

---

## 九、签署意见：是否同意举 verifying-to-done 闸门

### ✅ **同意** 举一次性人工闸门 `BL-NATIVE-SUBAGENT-BRIDGES-verifying-done-w1`。

**依据：**

1. **五个 feature 全 PASS，0 PARTIAL / 0 FAIL**，且每条判定都有磁盘上的原始报告与可复现步骤支撑（§一、§三）。
2. **F005 acceptance 明文的闸门前置条件已满足**："fresh-context Evaluator 锁定 SHA 独立复验 F001–F004，
   全 PASS 后举 verifying-to-done 人工闸门" —— 三轮复验均由 fresh-context Evaluator 在锁定 SHA 上完成；
   F005 当时悬置的 OBS-1 已由终轮 F003 的真实 launch 证据消解。
3. **上一轮唯一阻断已用实物证据消除**，且不是靠放宽验收口径：D8 保留了厂商 `plan` persona 的只读语义，
   交付物证据链（nonce 绑定 → child 完成 → driver 物化 → `artifact_sha256` 入 receipt）完整闭合。
4. **fail-closed 边界完整**：通道漂移在 catalog / provider / worker 三层独立拒绝并进入
   `execution_provenance_sha256`；启动层四类越权/漂移/错registry/重放全部具名拒绝。
5. **L1 全绿**（framework 178 + 独立探针 11 + vitest 909 + verify + lint），**无跨 feature 回归**。

**签署附带的知情条件（请人类在闸门处一并确认）：**

- **(a)** F001/F002/F004 的 PASS 作出于 `172ed42b` 而非签署 SHA `ce249dc3`；其可观测面已在 `ce249dc3`
  重新实测覆盖，但**未重跑完整原始套件**（§1.2）。
- **(b)** 遗留 **R3-9.1**（planner 偶发失败不可诊断，medium）建议在下一批次优先处理；它不影响正确性
  （失败即 fail-closed，不产生错误结果），但影响可运维性。
- **(c)** 本签收**不**授权部署、不授权本机 Agent 升级、不授权推送——这些仍需人类在闸门后另行决定。

**签署人：** Andy/evaluator-subagent（fresh-context 隔离实例）
**签署时间：** 2026-08-04（UTC）
**签署 SHA：** `ce249dc3c431e95a42603e6209158de1a1620f3f`
**利益冲突声明：** 本人未参与本批次任何产品代码的实现；本签收期间未修改任何产品代码，
未执行 `git add` / `commit` / `push`。

---

## 十、Framework Learnings（提案，待 Planner 在 done 阶段与用户确认）

### 新规律

- **"角色/persona 维度"的可用性结论不得由单一角色成功外推。** 每个**已发布**的角色都应有至少一次
  真实路径实证。本批次第 2 轮 F003 初版正是因为"launch 链路修复与角色无关"的外推而误判 PASS，
  随后被同一 Evaluator 的对照实验证伪。
  - 来源：F003 round 2 §9.2 → round 3 §5
  - 建议写入：`framework/harness/evaluator.md` 或 `framework/patterns/testing-env-patterns.md`

- **区分"确定性失败"与"偶发失败"必须用逐字重放对照。** 终轮把同一份失败契约逐字重放并成功，
  才把结论从"planner 不可用"稳稳地翻成"非确定性偶发"。没有这一步，单次失败极易被误判为结构性阻断
  （反之亦然）。
  - 来源：F003 round 3 §5（P1 vs P3）
  - 建议写入：`framework/patterns/testing-env-patterns.md`

### 新坑

- **供应商 persona 的能力边界会与自研协议契约结构性冲突。** Kimi `plan` 子代理是只读 profile
  （无 Write/Edit/Bash，提示词规定"交付物即最终消息"），而 bridge 协议强制每个角色落盘交付物 ——
  这类冲突**不可能靠纯代码修复消解**，必须走规格裁决。识别信号：某角色 N/N 确定性失败，
  而同窗口其他角色成功。
  - 来源：F003 round 2 §8 → FIX2 裁决 `#1:A`
  - 建议写入：`framework/README.md` §经验教训

- **provider 出于安全不外泄 guest stdout/stderr + 完整收割 job 目录 = 失败不可诊断。** 安全设计与
  可运维性在此直接冲突，应在设计期就规划"受限枚举形式的失败类别回传"，而不是等到验收轮才发现
  每次偶发失败都要烧一次 wall-clock。
  - 来源：F003 round 3 §9.1
  - 建议写入：`framework/harness/dispatch-mode.md`

### 模板修订

- **签收报告模板建议新增"判定 SHA 差异声明"小节。** 多轮 fixing 的批次里，各 feature 的 PASS
  往往作出于不同 SHA；签收若不显式声明这一点，"全 PASS"会被误读为"全部在最终 SHA 上验过"。
  - 来源：本签收 §1.2
  - 建议写入：`framework/templates/signoff-report.md`
