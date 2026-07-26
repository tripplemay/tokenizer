---
name: autodrive
description: 自主开发心跳的单次唤醒入口——把 progress.json.status 当程序计数器，跑一个指令周期（取状态→派发单阶段步→机械回写→闸门检查→推进或硬停→自排下一次）。仅在已装机件 + 合法 autonomy-policy.json 存在时使用；配合 /loop 动态自排程。
---

<!-- autonomous-mode.md 的 Dispatcher 组件 + §4 控制流。
     本 skill 是耐久层：调 .claude/autonomous/gate-arbiter.workflow.js 拿决策，自己按下 commit/推进/重排键（§8：引擎不 flip status）。 -->

# /autodrive — 自主心跳单次唤醒（一个指令周期）

**你是耐久层，不是评估者。** 每次唤醒严格按序执行；任一步 fail-closed 就**硬停并停止排程**，不留半开状态。
完整设计见 `framework/harness/autonomous-mode.md`。**可逆内环先行；deploy/prod/spend 永远留人类闸门。**

## 步骤 0 —— 前置机件断言（机件在位 = 开车前置条件；缺一即 HARD_HALT）

开跑前逐项断言，**任一不满足 → 打印原因、`ScheduleWakeup(stop:true)`、STOP，不回写、不排下一次**：

1. `.claude/settings.json` 已合入 `.claude/autonomous/settings.autodrive.json` 的 deny-list（deploy/migrate/prod/花钱 MCP + policy 只读）
2. `bash .claude/autonomous/validate-autonomy-policy.sh autonomy-policy.json` 退出 0（策略合法、未过期、`auto_cross` 不含 C、`authorized_by=user`）
3. 受限 subagent 定义就位：`generator-restricted`（build/fix 用）+ `spec-lock critic`（写盘前用）
4. verdict 工件 schema 校验 hook 就位（机件 #3）
5. **若 `.agents-registry.json` 存在**（即启用 dispatch mode，见 `framework/harness/dispatch-mode.md`）：
   - `bash .claude/dispatch/validate-dispatch.sh registry` 退出 0
   - `bash .claude/dispatch/validate-dispatch.sh assignments` 退出 0（**generator/evaluator 的 model_family 必须不同**）
   - 每个被 `role_assignments` 引用的 `local-cli` descriptor，其 `adapter` 的 `_verified` 为 `true`
     （未实测核对的适配器不许接自主——沿用「机件没建好不许开车」）
   - 每个被引用的 `a2a` descriptor：`curl -sf <endpoint>/health` 通，且 `auth.env` 指定的
     环境变量已设置。**runner 不在 = 无人值守期间派活必然全数 FAILED**，宁可开车前就停

> 机制没装齐，护栏就是纸面——宁可不开车。

## 步骤 1 —— FETCH（取最新状态）
- `git pull --ff-only origin main`
- 从磁盘读 `progress.json` / `features.json` / `autonomy-policy.json`；组装 `state`（status、current_sprint、fix_rounds、features）、`ledger`（累计 tokens/cost/wake_n/same_feature_fail_streak）
- 取当前 UTC 时间字符串 `now`（供 gate-arbiter；Workflow 内 Date 不可用，须由本层注入）
- **dispatch 注入（职责 ①②）：** Workflow 无文件系统权限，以下四项必须由本层读盘后注入，缺一则外部派活会用错快照或错误授权：
  | 注入项 | 取法 |
  |---|---|
  | `registry` | 读 `.agents-registry.json` 全文（不存在则不传 → gate-arbiter 全程回退 v1.0 行为） |
  | `state.head_sha` | `git rev-parse HEAD` —— 信封 `repo.ref` 用它锁定快照，**不得用分支名** |
  | `state.spec_path` | `progress.json.docs.spec` |
  | `state.l2_authorized` | 仅当用户书面授权本批次 L2 时为 `true`；默认 `false`（外部 agent 撞 L2 会写 `waiting:"auth"` 并停） |

## 步骤 2 —— LOCK（并发唤醒护栏，§9）
- 读 `progress.json.wake_in_progress`：若存在且未超时（`started_at` 在 stale 窗口内）→ 说明上一唤醒仍在跑，**本次立即返回，不重排**（避免双跑抢 push）
- 否则写入 `wake_in_progress = {wake_id, started_at: now}`，commit

## 步骤 2.5 —— 消费闸门批准（console-mode.md）
- 读 `progress.json.pending_gate`：
  - 无 → 继续
  - 有且 `decision` 为空 → **本轮不推进**（仍在等人），释放 lock、不重排、STOP
  - 有且 `decision.action = "reject"` → 记账后清空闸门 → 硬停交用户
  - 有且 `decision.action = "approve"` 且 `decision.gate_id == pending_gate.id` →
    **执行该闸门对应的迁移**（如 `to_status`），然后把 `pending_gate` 置 `null`
- ⚠️ 本层**只读 decision，绝不写它**。写入即被 `validate-pending-gate.sh guard` 拒绝——
  那是「人闸门归人」的机械保证（console-mode.md §3.1）

## 步骤 3 —— IDEMPOTENCY（崩溃前跳）
- 若 status 隐含的步已反映在状态里（如"下一 pending feature"实际已 completed，说明上次 execute 后、writeback 前崩溃）→ 前跳，不重做该步

## 步骤 4 —— 派发一个指令周期（调 Gate Arbiter）
- 运行 `.claude/autonomous/gate-arbiter.workflow.js`，传 `args = { state, policy, ledger, now, diff, registry }`
  （`diff` = 本批未提交 `git diff`，供 spec-lock critic；`registry` 见步骤 1 注入，无则回退 v1.0 行为）
- Arbiter 内部：纯函数 `governor` 判 halt → `decode` status → 会写盘前先跑 spec-lock critic → EXECUTE 单步
  （verify 派隔离 evaluator + PASS 抽样查证据；build 派 `generator-restricted`；
  **解析到 `transport=local-cli` 的角色则改派 dispatcher subagent 走沙箱**）
- Arbiter **返回决策**，不 flip status：`{ decision, gateClass, proposedNext, writeback, reasons }`

## 步骤 5 —— 按 decision 处置
| decision | 含义 | 动作 |
|---|---|---|
| `HALT` | governor/critic/未知态触发 | **举起 `pending_gate`**（见下）→ 记 halt 原因入 session_notes → 释放 lock → **PushNotification 通知用户** → `ScheduleWakeup(stop:true)` → STOP |
| `DONE_PENDING_USER` | 批次跑完，→done 是 Class B | 同上（批次完成通知），**不自动置 done**，等用户确认 |
| `HANDBACK` | Class B 需授权但 policy 未授权 | 同上，交用户确认跨闸门 |
| `ADVANCE` | Class A 可逆，或 Class B 且 policy.auto_cross 含 B | 进步骤 6 |

**举闸门（HALT / DONE_PENDING_USER / HANDBACK 三种都要做）：** 写
`progress.json.pending_gate = {id: "<batch>-<from>-<to>-w<wake_n>", kind, raised_at: now,
raised_by: "autodriver", batch, from_status, to_status, detail: <halt 原因原文>,
evidence: [verdict 工件路径等], decision: null}`。
`kind` 按 halt 原因映射：`batch_complete`→`phase_advance` · L2 未授权→`l2_auth` ·
`debias_conflict`/`scope_drift`/`budget_breach:*`/`spec_lock_required` 同名。
**没有 pending_gate，控制台就看不见这次停机，人也无从远程批准**——通知只是提醒，闸门才是接口。

## 步骤 6 —— WRITEBACK（机械原样，§8 + 铁律 12）

### 6a. 外部派活的产物收割（`writeback.dispatch` 存在时，dispatch mode 专有）

外部 agent 的产物在**一次性 worktree** 里，且它无 push 权限——必须由本层搬运。

- **6a-1 产物入主仓：** 把 `writeback.dispatch.artifact_path` 指向的文件**原样复制**到主仓
  `docs/test-reports/` 对应路径。**不得改写内容**（铁律 12）
- **6a-2 去偏比对（职责 ③）：** 若 `writeback.debias?.compare_at === 'durable'`（外部主验时引擎手上没有逐条判定）：
  读产物中 `feature_id` 对应的 `result`，与 `debias.second_result` 比对
  - 不一致 → `debias_conflict` **硬停** + 通知，记 `{feature_id, primary_family, second_family, 两侧结论}`
  - 一致 → 继续
- **6a-3 外部 generator 回流（职责 ④）：** `role=generator` 且 `dispatch.state=COMPLETED` 时，四步顺序执行，任一失败即硬停：
  1. **tag 归属校验**：worktree 内新 commit 的 message 必须为 `feat(<batch>-<Fxxx>):` 且 `<Fxxx>` 在 `features.json` 中真实存在（铁律 10）。外部 CLI 未必守此格式——**策略：拒收，不 rewrite**（见下）
  2. **spec-lock critic**：以 worktree 路径跑机件 #2，越 scope 即硬停（**在拉回主仓前**拦，产物还没污染 main）
  3. **L1 全绿**：在 worktree 内跑 `lint / tsc / test`，任一红即硬停——这是外部 generator 的硬证据
  4. **回流**：`git cherry-pick` 该 commit 到 main（本层执行，外部实例永不直接 push）
- **6a-4 清理：** 硬停时**保留** worktree 供取证（通知里带路径）；成功回流后 `git worktree remove --force`

> **tag 不合规为何拒收而非自动 rewrite：** rewrite 意味着由编排者替外部 agent 断言「这个 commit 属于 F003」——
> 那是一次**未经取证的归属判定**，与铁律 10「无归属的代码修改 = 越界」的精神相悖，且会掩盖 scope 漂移信号。
> 拒收 + 硬停把判断交回人类，代价只是一次唤醒。若实战中高频误伤，再考虑放宽为「仅当 diff 文件集完全落在
> 该 feature 的影响文件内时允许 rewrite」——但那需要 spec 里有可机读的影响文件段，目前没有。

### 6b. 通用回写

- 每个已验/已实现 feature **立即**写 `features.json`（逐条，不等全量，抗中途崩溃）
- evaluator 的 `evaluator_feedback` **逐字**写入 `progress.json`；FAIL/PARTIAL feature 改回 pending
- **断言 verdict 工件**：`docs/test-reports/{BL-id}-verdict.json` 存在且每 feature `evidence`/`steps_to_reproduce` 非空
  - 缺失/空壳 → **重跑该 verify 步上限 1 次**；仍缺 → `evaluator_cannot_verify` 硬停 + 通知，**绝不静默无限重跑**
- 把 `proposedNext` 写入 `progress.json.status`（此处才是"按下阶段推进键"——由耐久层做，非引擎）

## 步骤 7 —— ACCOUNT（记账，铁律 6）
- 追加 `progress.json.autonomy_ledger` 条目：`{ wake_ts: now, status_before→after, gate_crossed, authorized_by_policy_version, tokens, cost, fix_round, verdict_ref }`
- **dispatch 派活时另记：** `{ dispatched_to: agent_id, model_family, task_id, receipt_state, duration_s }`
  —— 无人值守期间「哪个厂商在哪一轮验了什么」必须可回溯，否则去偏轮换无法事后审计
- 覆盖写 `session_notes['autodriver']`：本轮做了什么、跨了哪个闸门、下一步

## 步骤 8 —— COMMIT
- `git status --short docs/test-reports/ docs/test-cases/ .auto-memory/` 确认测试产物入库
- 清空 `wake_in_progress`（释放 lock）→ commit + `git push origin main`

## 步骤 9 —— RESCHEDULE 或 收尾
- 若步骤 5 已 HALT/DONE_PENDING_USER/HANDBACK → 已 stop，不到此步
- 否则 `ScheduleWakeup(delaySeconds = policy.wake_interval_s[当前阶段], prompt = "/autodrive", reason = "autodrive 下一唤醒：<阶段>")`
- 存活告警（§9）：若距上次成功唤醒 commit 超过预期窗口 → PushNotification（防心跳静默停摆）

---

## 不变量（任何唤醒都不得违反）
- **引擎不按阶段推进键**：status 的 flip 只在步骤 6 由本耐久层做，gate-arbiter 只返回 `proposedNext`
- **铁律 12**：派 evaluator 的 prompt 用固定模板，只插值 `{批次, spec/feature 路径, L2-flag}`，无实现叙述、无质量定性
- **Class C 在工具层被拒**：deploy/prod/spend 由 deny-list 拦，不依赖闸门分类器——闸门分类器只是兜底
- **⚠️ deny-list 管不到外部进程**：dispatch mode 下 Class C 的实际防线是 `sandbox-profile.sh` 的进程级四道锁
  （env 白名单 / 专用空 HOME / 禁 push / 封顶），`.claude/settings.json` 对外部 CLI 一条都不生效
- **外部产物只搬不改**：`artifact_path` 原样复制进主仓；外部 commit 经 tag 校验 + critic + L1 全绿才 cherry-pick，
  tag 不合规**拒收不重写**（重写 = 未经取证的归属判定）
- **每轮以 commit 结束**：唤醒之间 kill/压缩零丢失，下轮纯从磁盘状态恢复
- **fail-closed**：策略缺失/过期/非法、机件未装、工件校验不过 → 硬停 + 停排程，绝不降级放行
