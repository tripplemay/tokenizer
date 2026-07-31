# Orchestration Patterns — 同会话编排与并行执行（v1.0 新增）

> 状态机（harness-rules.md）定义**阶段和角色边界**；本文件定义**每个阶段内部怎么跑**：什么时候用主上下文、什么时候 fan-out subagent、什么时候上 Workflow 脚本编排、什么时候用 /loop 动态自排程。
>
> 原则：**状态机管阶段边界，编排管阶段内部。** 任何编排方式都不得跨越阶段边界（如 building 期间顺手验收）、不得破坏独立性铁则。

---

## 1. 角色 ↔ 执行机制映射

| 阶段 | 默认机制 | 升级机制（命中条件时） |
|---|---|---|
| planning | 主上下文 + **plan mode**（规格与拆分作为 plan 提交用户确认） | 方案空间宽时：judge panel（N 个独立方案 subagent + 评分合成） |
| building | 主上下文逐条实现 | 独立 feature ≥2 条且互不重叠：**并行 generator subagent + worktree 隔离**（§3） |
| pre-impl 审计 | 主上下文暂停 + 用户/Planner 裁决 | 多参考源冲突大：并行 subagent 各查一个参考源再汇总比对表 |
| verifying / reverifying | **单个隔离 evaluator subagent** | feature ≥4 条或含多验收维度：**fan-out 验收 + 对抗复核**（§4，建议用 Workflow 脚本） |
| fixing | 主上下文（读 evaluator_feedback 逐条修） | FAIL 项相互独立且 ≥3 条：并行修复 subagent + worktree |
| done | 主上下文（收尾清单） | — |
| 旁路 audit（不入状态机） | 独立任务模式 | 全仓扫描类：多维 finder fan-out + loop-until-dry（§5） |

**plan mode 与 planning 阶段的关系：** planning 阶段的产物（spec + features.json + 车道选择）天然适合作为 plan 提交确认——用户批准 = spec lock。这替代不了 spec 文档本身（spec 是 Generator 的持久输入，plan 只是确认流程）。

---

## 2. 快车道单批次标准流（日常默认）

一个会话跑完一个中小批次的推荐节奏：

```
用户提需求
  → [planning] 主上下文：读 user_report + backlog → plan mode 出 spec + features.json → 用户确认
  → commit（状态 building）
  → [building] 主上下文实现 F001...Fn（独立项可并行，§3）
      每个 feature：实现 → 自测 → commit → push → 后台 gh run watch（§6）
  → commit（状态 verifying）
  → [verifying] 启动隔离 evaluator subagent（§4）
      subagent 自行读 spec / features / 代码 / 跑测试 → 产出 evaluator_feedback + 报告落盘
  → 全 PASS → signoff → done；有 FAIL/PARTIAL → fixing → 修复 + 回归测试 → reverifying
  → [done] 主上下文：整合 project-status.md → 处理 proposed-learnings → 问下一批次
```

**上下文管理：** 长批次信任自动压缩续跑（铁律 3），不需要预留上下文人为中断。但每个阶段边界的状态落盘不可省——它保证压缩摘要出错、会话意外中断、或用户换机器时都能从 progress.json 无损恢复。

**主上下文的双重身份警告：** 快车道下主上下文既当 Planner/Generator 又当编排者。切给 evaluator subagent 时只传"哪个批次、状态文件在哪"，**不传实现叙述**；收回结论时原样落盘（铁律 12）。

---

## 3. 并行 building（worktree 隔离）

**适用判定（三条全满足才并行）：**

1. features 之间无实现依赖（F002 不 import F001 产出的模块）
2. 预计触碰的文件集不重叠（按 spec 的"影响文件"段预判；拿不准就串行）
3. 每条 feature 有独立可验证的 acceptance

**做法：**

- 每个并行 generator subagent 在**独立 worktree** 中实现自己的 feature，产出独立 commit
- subagent prompt 必须含：feature id + spec 路径 + acceptance 全文 + 必读 pattern 文件清单（按 `patterns/README.md` 触发条件）+ 「只做本 feature，越界即停」
- 汇合：主上下文合并各 worktree commit 到 main → 统一 push → 跑一次全量 L1（lint/tsc/test）确认无交叉破坏 → 更新 features.json 各条 status
- 任一 subagent 报告规格歧义 → 该 feature 转 pre-impl 审计流程，其余不受阻

**不并行的情况照旧串行**——铁律 1 的本意（分功能、可审查、可回滚）在两种模式下都成立。并行是吞吐优化，不是默认姿态；协调成本高于收益的小批次直接串行。

---

## 4. Fan-out 验收 + 对抗复核

单个 evaluator subagent 是最小合规形态。批次 ≥4 features 或验收维度多（功能 + 视觉 + 安全 + 性能）时，升级为 fan-out——**建议用 Workflow 脚本编排**（确定性控制流，不靠模型自觉循环）：

```
阶段 1（Verify，按 feature fan-out）：
  每条 completed feature → 1 个隔离 evaluator subagent
  输入：feature 条目 + spec 对应段 + docs/test-cases/ 对应用例
  输出（结构化）：{ feature_id, result: PASS|PARTIAL|FAIL, description, steps_to_reproduce }

阶段 2（对抗复核，只对 FAIL/PARTIAL）：
  每条 FAIL/PARTIAL → 1 个复核 subagent，prompt 要求「尝试证伪该发现」
  （复现失败步骤；核对是否命中 patterns/testing-env-patterns.md 的已知环境误报：
   prisma generate 未跑 / Node 版本漂移 / RLS 视角 / E2E suite isolation）
  被证伪 → 降级或移除，注明理由

阶段 3（汇总，主上下文机械执行）：
  合并为 evaluator_feedback JSON 原样写入 progress.json
  FAIL/PARTIAL 的 feature status 改回 pending
  完整报告落 docs/test-reports/
```

**对抗复核的价值：** 防止单个 evaluator 的误报直接触发 fixing 轮（历史上 prisma generate / Node 版本 / checklist 陈旧类误报浪费过多个 fix round——见 testing-env-patterns.md 各条来源）。复核只许**证伪**发现，不许**放宽**验收口径。

**汇总环节是机械合并，不是二次评估。** 主上下文不得在汇总时调整任何 result 判定。

---

## 5. Workflow 脚本 / 独立任务的编排场景

以下场景用确定性脚本编排优于模型自觉循环：

| 场景 | 模式 |
|---|---|
| ≥4 features 的批次验收 | §4 三阶段 fan-out（pipeline：每个 feature 验完即复核，不等全量） |
| 上线前 audit（prod-launch-audit-template.md） | 多维 finder fan-out（安全 / ghost-control / PRD 偏差 / 部署对位各一个 finder）→ 对抗复核 → 汇总四池子报告 |
| 全仓扫描类独立任务（rate-limit 全裸点、RLS 缺失表） | loop-until-dry：连续 2 轮无新发现才停，避免 top-N 截断漏尾部 |
| 大型迁移批次（migration-batch-checklist.md） | discover 站点 → pipeline 逐项转换（worktree 隔离）→ 逐项验证 |

**模型分层建议（成本杠杆）：** 机械执行类 subagent（格式转换、grep 汇总、checklist 逐项核对）可用低档位模型；实现与验收判定用主模型；裁决、对抗复核、安全审计用主模型或更高档位。拿不准就继承会话默认，不要为省成本牺牲验收质量。

---

## 6. 后台任务与 /loop 动态自排程

**CI 检查（generator.md §4.5 的现代化执行）：** push 后不必阻塞等待——后台跑 `gh run watch`，继续下一个 feature 的实现，CI 完成收到通知再处理。**铁律不变：** 收到红色通知，立即停止新 feature，先修 CI；且在 CI 结果出来前不得切 verifying。

**长测试 / 长构建：** E2E 全量、压测、大构建放后台执行，主上下文继续可并行的工作（写测试用例文档、更新状态文件）。

**/loop 动态自排程适用场景：**

| 场景 | 节奏建议 |
|---|---|
| 盯一次 CI / staging 部署完成后继续下一步 | 短间隔轮询（分钟级），完成即续 |
| 批量迁移 / 批量修复的隔夜推进 | 每轮完成 1-N 个条目 → 落盘状态 → 自排下一轮；轮与轮之间状态全在 progress.json / features.json，符合断点恢复铁律 |
| 等待外部协作方（另一仓库 / 另一团队）产物 | 长间隔（≥20 分钟）检查 `gh api` / health endpoint，命中条件才续批次 |

**/loop 下的状态机纪律：** 每轮迭代必须以「状态文件落盘 + commit」结束——下一轮唤醒可能发生在压缩之后，progress.json 是唯一可信的进度来源。**阶段切换（尤其 → verifying / → done）不得在无人值守循环中自动完成**，切换前必须停下等用户确认，或按用户事先给出的书面授权执行并在 session_notes 记账（沿用铁律 6 跨角色 ops 的授权 + 记账模式，见 planner.md）。

---

## 7. 慢车道（git 总线）保留场景

以下场景仍走 v0.x 式跨会话异步交接，规则见 harness-rules.md：

- **跨机器协作：** 多台设备轮换工作，`.agent-id` 各配身份，启动必 `git pull --ff-only`
- **独立实例验收：** 正式发布批次 / 用户要求最强隔离时，evaluator 跑在独立会话甚至独立机器，读 status=verifying 自行接手
- **多日大批次：** Path A 串行多批次重构，天然跨会话

**外部工具参与已改走第三形态（v1.6）：** CLI 工具不再靠「读 AGENTS.md 自行接手」，而是由编排者按
`tool-integrations/1` registry 与 verified adapter 派活（`dispatch-mode.md`）——契约随信封走、产物过 schema、
跑在进程级沙箱里。每个 local-cli integration 可按固定契约承担 Planner、Generator、Evaluator；已配置的
A2A target 可承担 Planner/Evaluator。Generator 与 Evaluator 的 `model_family` 必须不同，A2A Generator
在 source-handoff 契约落地前拒绝。

三条形态可以在同一批次内切换：如快车道 building 完成后，用户要求异厂商实例做 verifying——只要阶段边界状态已落盘，任何实例都能无损接手。这正是「状态文件在所有形态下都必须落盘」的回报。

---

## 8. Workflow run ⇄ progress.json 日志契约

> 当阶段内部编排交给 Claude dynamic Workflow（fan-out 验收、并行 building、loop-until-dry）时，
> 引擎的**临时**编排状态与状态机的**持久**骨架必须对账。本节定义交接契约——
> 不定清楚，现代化会引入两类正确性回归（自动越阶段闸门 / 中途崩溃丢中间态）。

**altitude 边界（不可违反）：**

1. **引擎不得自主越过阶段边界。** Workflow 的 loop-until-done 天生会推进到"完成"并自排下一步，
   但 §6 硬铁律要求 `→ verifying` / `→ done` 必须停下等用户确认。
   **Workflow 脚本必须在阶段边界 return 交还主上下文/用户，绝不自行 flip status 跨阶段**——
   引擎只跑"阶段内部"。fixing⟷reverifying 的循环语义可由引擎承载，但每轮的 status 流转仍走状态机 + 用户闸门。

2. **状态回写是机械的、原样的。** Workflow 返回结构化结果后，由主上下文机械写回 progress.json / features.json：
   evaluator subagent 的 evaluator_feedback **原样**写入（铁律 12，不洗白、不筛选、不软化）；
   FAIL/PARTIAL 的 feature status 改回 pending。汇总环节不得二次评估。

3. **中途崩溃的双状态对账。** progress.json 把阶段状态建模为原子（evaluator_feedback 在 verify 末尾一次写入），
   但 fan-out 途中崩溃（5 条验了 3 条）会留下状态机不表示的中间态。
   **Workflow 脚本每验完一条 feature 即把该条结果落盘 features.json**（pipeline 逐条落，不等全量），
   使任意时刻崩溃都能从 features.json 无损续跑——把断点恢复铁律贯彻到阶段内部。

4. **验收工件必须持久化回喂沉淀。** 每个 verify Workflow run 结束，必须产出一份命名验收工件
   `{ BL-id, verdict: PASS|PARTIAL|FAIL, fix_round, 证据摘要 }` 落 `docs/test-reports/`。
   **这是框架自我进化引擎的燃料**：沉淀闭环靠每批次一份 Evaluator 验收记录喂养，
   in-tool Workflow 若只在 context 里验完不落工件，`proposed-learnings.md` 会因无 emitter 而静默饿死。

**一句话契约：** 引擎拥有"阶段内部怎么跑"，progress.json 拥有"跨阶段的真相与流转闸门"；
引擎每步结果都要落进持久文件，引擎永不自己按下阶段推进键。

---

## 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-07-09 | 初版（v1.0）：快车道标准流 / 并行 building / fan-out 验收 + 对抗复核 / Workflow 与 /loop 场景 / 模型分层 / 慢车道保留场景 | 框架 v1.0 重构（适配 Claude Code subagent + Workflow + plan mode + hooks 时代） |
| 2026-07-12 | §8 Workflow ⇄ progress.json 日志契约（阶段边界不自动越 / 机械原样回写 / 逐条落盘抗崩溃 / 验收工件回喂沉淀） | harness-fit 分析 wt27gd5xu（红队：naive 上 Workflow 是正确性回归 + 沉淀饿死风险） |
