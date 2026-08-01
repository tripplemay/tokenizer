---
name: build
description: 进入 Harness 状态机的 Generator 角色——按 features.json 逐条实现功能或修复 evaluator_feedback。在 progress.json status 为 building / fixing 时使用。
---

# /build — Generator 角色入口

按顺序执行，不得跳步：

1. **同步与加载（新会话时）：** `git pull --ff-only origin main`；读 `progress.json` / `features.json`；加载 T0 记忆 + T1（`role-context/generator.md`）
2. **确认阶段合法：** status 必须为 `building` / `fixing`。若为其他状态，向用户说明并停止
3. **选择 Generator 路由：** 你是 Coordinator；先运行唯一的 active-role 解析器，绝不直接用
   `progress.json.role_assignments.generator` 选择执行者：

   ```bash
   bash .claude/dispatch/resolve-active-mode-role.sh --role generator > /tmp/harness-active-generator.json
   ```

   - **输出 `{}`（fast/v1/未启用 checkpoint）：** 保持历史本机 Generator 路径，继续第 4 步。
   - **输出六字段 active record：** 该 record 是从完整签名 checkpoint 重验并按当前 registry/verified adapter 重解的唯一来源；`execution_provenance_sha256` 同时固定 target、adapter 执行契约、sandbox/timeout 与 bridge/A2A 等执行语义。按它的 `agent_id`/transport/agent type 路由；`role_assignments` 与 `mode_intent.resolution` 只作审计，不能参与选择。任何非 0、字段不匹配或执行语义漂移都硬停。用户签名仍只覆盖 `{tool,invocation}`，hash 是运行时 guard 而非文件防篡改证明；旧五字段 active v2 checkpoint 必须重新 plan/consume。
   - **`transport=subagent`：** 先读取 target provenance。仅当 `bridge_id=host-native` 时，从 active record 对应的 descriptor 读取该**精确 agent type**，以它启动受限 Generator subagent；Coordinator 只编排与收敛，不直接写 feature。若 `agent_type` 缺失或不匹配，硬停，不用默认 persona 代替。已验证外部 bridge（非 `host-native`、`session_scope=same-session`、有 protocol）不得由 Coordinator 直派，必须使用下列固定封装。
   - **`transport=local-cli` 或已验证外部 `subagent` bridge：** 用下面的固定封装派发。封装会在读 progress 前再次验证 active Generator record：

     ```bash
     TASK_ID="build-$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
     bash .claude/dispatch/dispatch-generator-handoff.sh --task-id "$TASK_ID"
     # 默认只派 features.json 顺序中的第一个 pending Generator feature；需要指定时：追加 --feature F001
     ```

     该封装固定 `l2_authorized=false`、固定 Generator handoff schema、固定 `commit_to=null`，并依次执行 registry preflight、envelope、`dispatch-run`、receipt 和 handoff 内容校验。`0` 只表示交回了待验证的沙箱 handoff；`3` 表示 `waiting`，必须交人类；`4` 才可重派且上限一次；`2` 为前置/契约失败。它绝不把 source diff、`features.json`、`progress.json` 或 commit 写回主仓。

     对 `0` 的返回，Coordinator 必须先用 spec-lock critic 审查 scope，再使用 `accept-generator-handoff.sh`。为当前项目准备严格的 `harness-l1/1` 命令文档（`lint`、`typecheck`、`test` 各一次），先不带 `--apply` 跑完整回流校验；只有得到 `READY_TO_APPLY` 后才使用同一组证据加 `--apply`。该工具会确认主仓 clean 且 HEAD 等于 `source_ref`、将实际 sandbox diff 与 `files_touched` **精确对账**、在 sandbox snapshot 重跑 L1，并只提交这个单 feature。handoff 自报的 `l1_ran` 不是证据；任一项失败即拒收，不更新状态。
   - **`transport=a2a`：** 手动 `/build` 的 source-handoff protocol 尚未实现，必须 fail closed 并向用户说明；不得退回 Coordinator 本机实现，也不得把它当作 local-cli 调用。

4. **执行角色协议（本机或 subagent 路径）：** 读取项目根 `generator.md` 并严格执行——spec 必读、pre-impl 审计触发判定、实现、自测、每 feature 独立 commit、push 后 CI 检查（可后台 `gh run watch`，红灯即停）
5. **按需加载 pattern：** 对照 `framework/patterns/README.md` 触发条件表，命中的技术域 pattern 必读
6. **并行判定：** 独立 feature ≥2 条且文件集不重叠时，按 `orchestration-patterns.md` §3 并行 subagent + worktree；否则串行
7. **阶段边界落盘：** 全部 executor:generator 完成 → status 置 `verifying`（fixing 模式 → `reverifying`，fix_rounds +1），commit + push，并提示用户「进入验收，启动隔离 evaluator（/verify）」
