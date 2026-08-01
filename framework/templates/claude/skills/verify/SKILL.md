---
name: verify
description: 启动 Harness 状态机的验收阶段——以隔离 evaluator subagent 独立验收当前批次（无自评铁律的执行入口）。在 progress.json status 为 verifying / reverifying 时使用。
---

# /verify — 验收阶段入口（编排 Evaluator）

**你（主上下文）在本阶段只做编排，不做评估。** 按顺序执行：

1. **前置确认：** status 为 `verifying` / `reverifying`；所有 executor:generator 的 feature 已 completed 且已 push；CI 绿色
2. **选执行形态：** 先运行唯一的 active-role 解析器：

   ```bash
   bash .claude/dispatch/resolve-active-mode-role.sh --role evaluator > /tmp/harness-active-evaluator.json
   ```

   输出 `{}` 才能走历史默认 2a。输出六字段 active record 时，它是从完整签名 checkpoint 重验并按当前
   registry/verified adapter 重解的唯一 Evaluator 来源；**不得**用 `progress.role_assignments.evaluator` 或
   `progress.mode_intent.resolution.evaluator` 选择执行者。读取 active record 对应 target：只有
   `transport=subagent` 且 `bridge_id=host-native` 才走 2a；local-cli、a2a 与带已验证 same-session bridge
   provenance 的 subagent 都走 **2b 异厂商派活**。`execution_provenance_sha256` 必须与当前 target、adapter
   执行契约、sandbox/timeout 及 bridge/A2A 语义一致；解析失败、六字段不一致或任一语义漂移即硬停。用户签名
   仍仅覆盖 `{tool,invocation}`，该 hash 是运行时 drift guard，不是防篡改证明；旧五字段 active v2 checkpoint
   必须重新 plan/consume。

   **2a 同会话隔离 subagent（默认）：** 以 `evaluator` subagent 类型（`.claude/agents/evaluator.md`）启动验收。prompt 只含：批次名、progress.json / features.json / spec 路径、[L2 是否已获用户授权]。**不得夹带实现过程叙述或质量定性描述**（harness-rules.md 铁律 12）

   **2b 异厂商派活（`dispatch-mode.md`）：**
   ```bash
   bash .claude/dispatch/validate-dispatch.sh assignments        # 先确认 family 互斥成立
   # 组装信封（字段白名单见 dispatch-envelope.schema.json；repo.ref 用 git rev-parse HEAD，不得用分支名）
   bash .claude/dispatch/validate-dispatch.sh envelope <信封>
   bash .claude/dispatch/dispatch-run.sh --agent <active-record.agent_id> --envelope <信封> > run-meta.json
   bash .claude/dispatch/validate-dispatch.sh receipt run-meta.json   # 权威判定在本地
   ```
   退出码：`0` 继续第 4 步 · `3` 产物 `waiting` 非空 → **硬停交用户**（等 L2 授权或规格裁决）· `4` 可重派**上限 1 次**，仍失败则硬停。
   产物即 evaluator 的结论，**原样**读取，不得改写。
3. **规模判定（仅 2a host-native 路径）：** completed features ≥4 条或验收维度多 → 按 `orchestration-patterns.md` §4 fan-out（每 feature 一个 evaluator subagent → FAIL/PARTIAL 对抗复核 → 机械汇总）；否则单个 evaluator subagent 全量验收
4. **结论原样落盘：** evaluator_feedback 按 subagent 返回**原样**写入 progress.json；报告确认已落 `docs/test-reports/`；不改写、不筛选、不软化任何 PASS/FAIL 判定
5. **状态流转：** 有 FAIL/PARTIAL → status 置 `fixing`，对应 feature 改回 pending，向用户汇报问题清单；全 PASS 且 signoff 已写入 → status 置 `done`
6. **推送证据：** `git status --short docs/test-reports/ docs/test-cases/` 确认测试产物全部入库后 commit + push
