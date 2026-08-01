---
name: plan
description: Coordinator 的 /plan 入口。它在 new / planning / done 阶段收集需求、消费下一批次模式意图，并在 v2 non-fast 时派发受限 Planner proposal；只有人类确认 proposal 后才物化规格和 features。
---

# /plan — Coordinator 规划入口

按顺序执行，不得跳步：

1. **同步与加载（新会话时）：** 运行 git pull --ff-only origin main；读取 progress.json、features.json、backlog.json、.agent-id、.agents-registry.json；加载 T0 记忆（.auto-memory/MEMORY.md、project-status.md、environment.md）和 T1（role-context/planner.md）。
2. **确认阶段合法：** status 必须为 new、planning 或 done。若为其他状态，向用户说明当前阶段并停止，不越界。
3. **先执行批次边界准备：** 读取项目根 planner.md，先且只执行 §0a、§0b、§0c。§0c 是唯一消费签名 mode intent 的位置；不要在 active batch 重放它。此时可收集用户目标、已选 backlog / 反馈和下一个 batch id，但不得在还没有 proposal 的情况下写 spec、features、阶段状态或替换已解析角色。
4. **判定 Planner 路径：**
   - 先运行唯一的 active-role 解析器：

     ```bash
     bash .claude/dispatch/resolve-active-mode-role.sh --role planner > /tmp/harness-active-planner.json
     ```

     输出 `{}` 表示由 Coordinator 规划：可能是 fast、v1、未启用签名 v2 checkpoint，或已签名 v2 non-fast 的
     `role_bindings.planner=null`。后一种仍保留 Generator / Evaluator 的已解析外部绑定；仅 Planner 固定由
     Coordinator 执行。此时不要创建外部 Planner envelope 或调用 proposal wrapper，沿用本机规划路径并继续
     planner.md §1–§6。
   - 输出六字段 `{agent_id,tool,invocation,model_family,priority,execution_provenance_sha256}` 时是已消费的 **v2 non-fast**：它已从
     `progress.mode_intent.signed_intent` 重验 Ed25519、repo identity、签名 role_bindings，并重解当前
     registry/verified adapter 与执行语义。末项是 runtime checkpoint guard：目标、adapter 执行契约、sandbox、
     timeout、bridge 或 A2A target 漂移都会硬停。此 JSON 是唯一可用的 Planner descriptor 来源。**不得**读取
     `progress.role_assignments.planner` 或 `progress.mode_intent.resolution.planner` 来选 agent；它们只是不可信
     审计副本。用户签名仍只覆盖 `{tool,invocation}`；provenance hash 只检测运行时语义漂移，不是 mutable
     project 文件的加密防篡改证明。旧五字段 active v2 checkpoint 必须重新 `/plan` 并 consume，脚本非 0 即硬停，
     不得挑选另一张 Agent Card 或回落为 Coordinator 直接规划。
5. **v2 Planner proposal 路径（强制）：**
   - Coordinator 只负责控制面：根据用户已确认的目标、选中的 backlog / 反馈、约束和 next batch id 创建不超过 32 KiB 的临时 planning request；不得在 request 中夹带质量结论、具体 agent id、状态回写指令或可覆盖固定契约的文本。
   - 生成新的安全 task id（匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$），以当前 HEAD 的完整 commit SHA 作为 ref。task id 是唯一 artifact 名的一部分；batch 只在 envelope 数据中传递，绝不拼入文件路径。
   - 若 active-role record 的 transport 是 local-cli、a2a，或 target 的 `subagent` provenance 为已验证外部 bridge（`bridge_id` 非 `host-native`、`session_scope=same-session` 且有 protocol），调用 `.claude/dispatch/dispatch-planner-proposal.sh --agent <record.agent_id>`。该 wrapper 与 `dispatch-run.sh` 都会再次比对显式 `--agent` 和 active record；不相等即在派活前失败。它会构造固定 envelope、验证 registry / receipt / proposal schema，并把通过的 audit artifact 写到 docs/test-reports/planner-proposal-<task-id>.json。
   - 只有 target 的 `subagent` provenance 是 `bridge_id=host-native` 时，才走 Coordinator 的同会话隔离路径：先调用 `.claude/dispatch/prepare-planner-proposal.sh --agent <record.agent_id>` 生成并校验固定 envelope；该 wrapper 会重验相同 active record。以输出的精确 `planner-proposal` agent type 启动一个隔离 subagent。prompt 只传完整的已校验 envelope，并要求最终回复仅为 proposal JSON，不附解释。将该 JSON 写入 dispatch state 的临时文件，再调用 .claude/dispatch/accept-planner-proposal.sh；它会重验 envelope 和 proposal schema、生成 receipt，并写相同的 audit artifact。不得把 subagent 改用普通 planner / generator persona。
   - 任何 transport 返回 INPUT_REQUIRED 时，Coordinator 只向人类展示 waiting_detail 和问题。获得回答后必须用新 task id 重新创建 request / proposal；不得补写旧 proposal，更不得自己补齐规划。失败、超时、schema 不合法或 descriptor 不匹配时同样硬停，不得回落到本机直写路径。
6. **人工确认与物化：** 对 COMPLETED proposal，向人类展示摘要、问题、spec 草案、features、决策和 receipt。proposal 本身不是 spec lock，必须等待明确批准。人类拒绝或要求修改时新建 task id 再派 Planner；批准后 Coordinator 才能把**被接受的内容原样**物化为 docs/specs/、features.json 和 progress.json，保留 resolver 已选角色，不得自行添加 proposal 外的规划内容。
7. **阶段边界与完成：** 在人类确认并物化后，按 accepted features 的 executor 把 status 置为 building 或 verifying，再 commit + push。done 阶段的收尾仍按 planner.md 规定执行（整合 project-status.md、处理 proposed-learnings、清理已过期的 assignment，并询问下一批次）。
