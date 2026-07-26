# Autonomous Mode — 多 agent 自主开发模式

> **状态：已纳入框架（默认安装）。** 机件在 `.claude/agents/{generator-restricted,spec-lock-critic}.md`、
> `.claude/skills/autodrive/`、`.claude/autonomous/`（gate-arbiter + 校验 hook + schema + deny-list）。
> **安装 ≠ 自动开启**：开启自主仍需人类建 `autonomy-policy.json` + 显式 `/autodrive`；`/autodrive` 步骤 0
> 前置断言机件在位/策略合法，否则 HARD_HALT。deploy/prod/spend 永远留人类闸门。
>
> **加载层级：T2（按需）。** 仅在设计/运行自主开发时加载，不进"每批次必读"集。
>
> **来源：** 自主 driver 架构设计 workflow `w05dglv38`（4 立场架构师 → 4 评委对抗打分 → 红队攻击领先方案）；
> 契合度前置分析 `wt27gd5xu`。架构 = S2 Heartbeat 底盘（31/40）+ S3/S4 安全机件嫁接 + 红队补的工具层 deny-list。

---

## 1. 定位：什么是本框架里的"自主开发"

**自主 ≠ 拆掉所有人类闸门让 agent 群一路跑到底。** 框架故意在几个位置放了承重的人类闸门。
正确的自主是——

> **策略化的自动推进**：把原本"停下问用户"的闸门，替换成一份**事先写好的书面授权策略**
> （`autonomy-policy.json`，铁律 6 / orchestration §6 的 auth+accounting 正道）；agent 群按策略
> 自动跨越**可跨**的闸门、在**不可跨**的地方硬停，全程把每次跨越落盘记账。

**原则边界（不可移动）：** 自主只放开**可逆内环**（`plan→build→verify→fix`）；
**不可逆 / 花钱 / 有外部副作用**的动作（deploy、prod 写入、L2、AIGC 花钱调用）始终留硬闸门或硬预算封顶。

**自主化时永不妥协的不变量：** 铁律 4（无自评，上下文隔离）+ 铁律 12（编排者不得污染 evaluator 输入 / 改写结论）；
铁律 10（spec-lock + feature 号归属）；铁律 9（hotfix 走流程）。无人盯着时，这些是唯一防"agent 群自我盖章"的护栏。

---

## 2. 一句话架构：Heartbeat Driver（状态机即程序计数器）

一个耐久的 `/loop /autodrive` 心跳（ScheduleWakeup）当**外层脊椎**，把 `progress.json.status` 当**程序计数器**；
每次唤醒 = 一个**指令周期**：读状态 → 派发当前阶段角色为隔离 agent → 按 §8 契约机械回写 → 闸门检查 → 推进或硬停 → 自排下一次。
阶段内部的 fan-out（§4 验收 / §3 并行）委派给 wake 内**临时 Workflow**，按 §8 在边界 return、**绝不自己 flip status**。
跨唤醒的唯一通道是**已提交的 progress.json / features.json**——杀掉 / 压缩 / 换机之间零丢失。

---

## 3. 组件

| 组件 | 职责 | 机制 | 状态 |
|---|---|---|---|
| **Heartbeat（`/loop /autodrive`）** | 耐久外层脊椎；状态机 PC 上的时钟。抗压缩、抗 kill、抗换机 | ScheduleWakeup 按阶段间隔重唤醒；每次唤醒以 commit 结束；停止时 loop-cancel | 已装 |
| **Dispatcher（`/autodrive` skill）** | 每次唤醒：取状态 → 解码 status→动作 → 路由到既有角色入口 → 闸门检查 → 续或停。**只派发，无评估权** | skill 文件；读 progress/features/policy，映射 status 到 `/plan\|/build\|/verify` 单步 | 已装 |
| **Autonomy Policy（`autonomy-policy.json`）** | 书面预授权（§6）+ 保持诚实的机器 | git-tracked JSON，锁定单批次、`expires_at` 时间盒；**只读**（见 §7）| 已装 |
| **临时 Workflow** | 在单次唤醒内执行 §4 验收 / §3 并行，不跨唤醒泄漏编排状态 | Workflow（agent/parallel/pipeline + budget + worktree）；§8：逐 feature 落盘、边界 return、不 flip status | 复用 §8 契约 |
| **隔离 evaluator subagent** | 无自评保证（铁律 4/12） | **复用** `.claude/agents/evaluator.md`（受限工具集，禁写 src/prisma/sdk/config）；prompt 只含 {批次 id, 路径, L2-flag} | ✅ 已存在 |
| **受限 generator/fix subagent** | 让 build/fix 也跑在默认拒绝的工具集下 | **新增** agent 定义，镜像 evaluator.md 的受限做法；配合 §7 deny-list | 已装 🔴 |
| **Verdict emitter** | 喂沉淀引擎（§8.4），防自主整夜静默饿死 | verify 步未产出 `docs/test-reports/{BL-id}-verdict.json`（含**每 feature 非空证据**）不许 commit | 已装 |
| **Accountant** | 每次无人值守跨越可审计（铁律 6） | 每跨一个边界追加 `session_notes['autodriver']` + `autonomy_ledger` 条目，随迁移一起 commit | 已装 |
| **Gate Arbiter + Governor** | 闸门分类 + 预算 + 停机判定；**确定性纯函数，非模型判断** | JS：`f(status, verdicts, artifacts, policy, ledger) → 动作/halt`；每次唤醒头部跑 | 已装 |

---

## 4. 控制流（一次唤醒 = 一个指令周期）

```
1. FETCH     git pull --ff-only；读 progress.json / features.json / autonomy-policy.json
2. GOVERN    !policy.enabled | now>expires_at | fix_rounds>=max | wake_n>=max
             | policy.batch_scope≠当前批次 | budget_breach | no-progress → HALT+notify+cancel（不回写）
3. LOCK      检查 wake_in_progress 锁（防并发唤醒双跑，见 §9）；取锁
4. IDEMPOTENCY  若 status 隐含的步已反映在状态里（上次唤醒 execute 后、writeback 前崩溃）→ 前跳，不重做
5. DECODE    status → 恰好一个动作：
               new/planning → /plan 单步；planning→building 是 spec-lock 闸门（见 §6）
               building     → /build 实现一个 pending feature（≥2 独立不重叠 → 派 §3 并行 Workflow）
               verifying    → 派隔离 evaluator（≥4/多维 → §4 fan-out Workflow）；对抗复核证伪 + 抽样查 PASS 证据
               fixing       → /build fix 模式，读 evaluator_feedback，一轮，fix_rounds+1
               done         → /plan 收尾：drain proposed-learnings → 覆写 project-status → HALT+notify
6. EXECUTE   执行该单步（主上下文，或临时 Workflow 在边界 return 不 flip status）
7. WRITEBACK 机械回写：progress.json；每 feature 立即落 features.json（§8.3）；evaluator_feedback 逐字（铁律 12）；
             断言 verdict 工件存在且证据非空
8. ACCOUNT   追加 session_notes + autonomy_ledger 跨越条目
9. COMMIT    commit + push
10. GATE     Gate Arbiter 分类本次迁移 → Class C 硬停 / Class B →done 停+notify / Class A 续排下一次唤醒
```

每次唤醒都以 commit 结束，唤醒之间的 kill/压缩零丢失，下次唤醒纯从磁盘状态恢复。

---

## 5. 闸门三分类（Gate Arbiter 的核心）

| 类 | 迁移 | 处置 |
|---|---|---|
| **Class A — 可逆内环** | building→verifying（派 evaluator 不发布任何东西）、verifying→fixing、fixing→reverifying | **策略允许即自动跨** + 记账 |
| **Class B — →done** | reverifying/verifying→done | **预授权 + 记账才自动**（全 acceptance PASS + L1 绿 + signoff 已写 + 无未授权 L2）；否则停 |
| **Class C — 不可逆/花钱/外部** | deploy、prod 写入、L2、AIGC 花钱、spec-lock（planning→building 无锁 spec 时） | **硬停**，交人类；策略**不可**把它们列入 auto_cross（校验 hook 拒绝） |

---

## 6. 🔴 关键原则：硬闸门在工具层强制，不在迁移层（红队核心发现）

> deploy / `prisma migrate deploy` / prod 写入 / AIGC 花钱**是阶段内部的工具调用**，在 building/fixing/verifying
> 期间触发，**从不在阶段迁移点**——第 5 节的闸门分类器**永远看不到它们**。更要命：本框架目前只发布了
> `evaluator.md` 受限工具集，**没有 generator/fix subagent 定义**，自主的 build/fix subagent 会继承 Bash +
> 全部 MCP 工具（含 aigc-gateway `generate_image`/`run_action` 等花钱工具）。

**所以真正的安全机制是工具层 deny-list，不是闸门分类器。** 落在框架自己的信条上——「装进工具链的规则才是强制」。
自主必须跑在**默认拒绝**的工具集下（就像 `evaluator.md` 已禁写 `src/`）：

- `/autodrive` 的 `settings.json` deny-list：整个自主运行期间（主上下文 + 所有 subagent）拒绝
  deploy/migrate 命令模式、prod 主机名、prod 分支 push、**全部 aigc-gateway 花钱 MCP 工具**。
- 新增**受限 generator/fix subagent 定义**，镜像 evaluator.md。
- 第 5 节的唤醒头闸门分类器降级为**兜底**，不是主控制。

---

## 7. 硬化机件清单（S2 底盘之上必须嫁接）

| # | 机件 | 堵住的漏洞 | 来源 | 状态 |
|---|---|---|---|---|
| **0** 🔴 | 工具层 deny-list + 受限 generator/fix subagent（见 §6） | 阶段内不可逆/花钱工具调用绕过全部闸门 | 红队 | 已装 |
| 1 | `autonomy-policy.json` **只读**（driver 及 subagent 禁写，含禁 Bash `printf > file` 旁路）；缺失/过期/非法 ⇒ 所有闸门 **fail-closed 硬停** | loop 改自己的授权令牌 | S3 | 已装 |
| 2 | **独立 spec-lock critic**：每次 writeback 前跑 `git diff`，越 scope 文件 / commit tag 不映射 features.json 即拦；tag→feature 校验进 pre-commit | scope 漂移拖到 signoff 才发现 | S3 | 已装 |
| 3 | 对抗复核**扩展到抽样 PASS 项**查证据；verdict 工件 schema 强制每 feature 非空 `steps_to_reproduce + evidence`，机械拒收无证据 PASS | 首轮全 PASS 零审查橡皮图章 + 沉淀灌空壳 | S3+S4 | 已装 |
| 4 | **确定性 JS Gate Arbiter + Budget Governor**（纯函数，非模型判断） | 模型误判进安全关键路径 | S3 | 已装 |
| 5 | `progress.json` 加 **autonomy_ledger**（累计 token/cost/fix_round/verdict_ref）+ 显式 `halt_conditions` + 重启时 worktree 与 features.json 对账 | 推理成本跑飞 / 工件缺失无限重跑 / 崩溃恢复 | S4 | 已装 |
| 6 | evaluator **档位确定性轮换**（wake_n）+ 每批抽一 feature 跑第二独立 evaluator（不同档位/fresh context，分歧 → `debias_conflict` 硬停）；`proposed-learnings.md` 收割**永远人类确认** | 相关性偏差（自主比人更快传播陈旧误报目录） | S4 | 已接线 gate-arbiter |

---

## 8. `autonomy-policy.json` schema

```jsonc
{
  "enabled": true,
  "batch_scope": "BL-XXX",              // 锁定单批次；critic 用它判越界
  "authorized_by": "user",             // 只有人类可写本文件（§7 #1）
  "expires_at": "2026-07-13T08:00:00Z",// 时间盒；过期 fail-closed
  "auto_cross": ["A"],                 // 允许自动跨的闸门类；校验 hook 拒绝含 C 的策略
  "budget": { "max_tokens": 2000000, "max_cost_usd": 20, "max_wakes": 60, "max_fix_rounds": 3 },
  "wake_interval_s": { "building": 120, "verifying": 300 },
  "notify_on": ["halt", "done", "budget_80pct"]
}
```

`halt_conditions`（Governor 命中即停）：`ci_red` / `spec_ambiguity_flagged` / `evaluator_cannot_verify` /
`worktree_conflict` / `budget_breach` / `scope_drift` / `no_progress`（同 feature 连续 2 轮 FAIL）。

---

## 9. 未决问题（建造前需定）

- **并发唤醒锁：** ScheduleWakeup 不保证串行；长 verify Workflow 跑超间隔时 wake N+1 会与 N 抢跑抢 push。
  需 `wake_in_progress` 锁（progress.json 字段或 lockfile）+ 陈旧锁超时 + 非 ff push 时 abort→re-pull→幂等重导。
  唤醒间隔应设得比 p95 唤醒时长充分长。
- **心跳停摆存活告警：** 机器休眠 / 调度注册丢失会让时钟静默停摆（状态不坏但批次假装在推进）。
  加 `max_wall_clock_since_last_wake` 告警 PushNotification，让停摆浮现而非隐藏。
- **验收工件"存在≠真实"：** 只断言文件在盘会被空壳 verdict 满足；须内容校验（每 feature 证据非空）。
  工件缺失时重跑**上限 1 次**，然后 `evaluator_cannot_verify` 硬停 + 通知，**绝不静默无限重跑**。
- **S1 未参评：** deterministic-first（临时 Workflow 当整个骨架）架构师本次 API stall 失败未产出；
  其"整个骨架都在临时 Workflow"路线在抗压缩上最弱，若重跑仅作对照。

---

## 10. 建造顺序（机制化先于自主 —— 机件没建好不许开车）

1. **机件 #0 + #1**（deny-list + 受限 generator subagent + policy 只读 fail-closed）——地基，没它护栏是纸面
2. **#4 确定性 Gate Arbiter + #3 验收工件 schema 校验 hook**——把闸门与证据门装进工具链
3. **`/autodrive` skill**：启动断言以上 hook/deny-list 已安装，**缺则 HARD_HALT**（机件在位 = 开车前置条件）
4. **#2 spec-lock critic + #5 ledger/halt_conditions + #6 去偏**——补完，再放开 overnight 跑批
5. 先在可逆内环放开自主；deploy/prod/spend 始终留硬闸门

---

## 11. 与现有机制的关系

**复用（不重造）：** §8 Workflow⇄progress.json 日志契约、progress.json/features.json 状态机脊椎、
`/plan /build /verify` 角色入口、`evaluator.md` 隔离验收 subagent、`validate-state-json.sh` JSON 校验 hook、
`/loop` 自排程、Workflow budget/worktree 原语。

**新增件：** `/autodrive` skill、受限 generator/fix subagent 定义、`autonomy-policy.json` + 其内容校验 hook、
工具 deny-list（settings.json）、确定性 Gate Arbiter Workflow、spec-lock critic subagent、
verdict 工件 schema 校验、progress.json 的 `autonomy_ledger`/`halt_conditions`/`wake_in_progress` 字段。

> **机件安装位置（bootstrap 默认铺入 `.claude/`）：**
> - `.claude/agents/generator-restricted.md` — 机件 #0 受限 generator/fix subagent
> - `.claude/agents/spec-lock-critic.md` — 机件 #2 独立 spec-lock 稽核 subagent（只读只判，越界 HALT）
> - `.claude/skills/autodrive/SKILL.md` — Dispatcher / §4 控制流：单次唤醒指令周期
> - `.claude/autonomous/gate-arbiter.workflow.js` — 机件 #4 Gate Arbiter（纯函数 governor/闸门 + build/plan 接线 + #2/#3/#5/#6 嫁接）
> - `.claude/autonomous/settings.autodrive.json` — 机件 #0/#1 工具 deny-list（**开启自主时人类手动合入 settings.json**，正常开发不叠加）
> - `.claude/autonomous/autonomy-policy.schema.json` + `validate-autonomy-policy.sh` — 机件 #1 策略 schema + fail-closed 校验
> - `.claude/autonomous/verdict-artifact.schema.json` + `validate-verdict-artifact.sh` — 机件 #3 验收工件 schema + fail-closed 校验
> - `.claude/autonomous/progress.autonomy-fields.md` — 机件 #5 progress.json `autonomy` 命名空间块（自主开启时合入，默认不铺）
>
> **仍待建（需接真实项目验证）：** §9 并发锁获取 / 心跳存活告警的运行时实现（字段/逻辑已在骨架）、
> gate-arbiter 的 build/plan 分支接真实 `/build` `/plan` 逻辑、以及一次端到端演练。
