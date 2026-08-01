# BL-NATIVE-SUBAGENT-BRIDGES - Kimi 同会话子代理桥接与 Codex local-cli 策略

**批次类型：** 混合批次（4 个 Generator feature + 1 个独立 Evaluator feature）

**用户确认：** 2026-07-31，用户要求为 Codex 和 Kimi 评估同会话子代理能力，并要求未来具备同等能力的新 CLI 自动进入规则体系。

**本批次最终策略：** Kimi 只有在 Framework-owned strict `vm-v1` provider 对当前主机和本次启动生成新鲜、nonce-bound attestation 后，才是可注册、可发布的 external same-session bridge；provider 不可用、过期或漂移时必须隐藏。Codex 保持已验证的 `local-cli` 路径。这个策略是声明式 registry、verified adapter、bridge manifest 与 provider contract 的共同约束，不是 Tokenizer 或 Framework 中按工具名写死的白名单。未来 CLI 只有在完成同等强度的桥接验证、声明自己的 verified manifest，且由同一 provider 对受支持协议 attested 后，才会自动进入同一规则体系。

## 1. 背景

现有 Harness 的 `subagent: true` 表示 Coordinator 当前宿主直接调用原生 child，不能被拿来代表任意 CLI 的外部子代理能力。`tool-integrations/1` 必须通过受控的 `{ "bridge": "<id>" }` 声明和 verified manifest 发布 external bridge；未知、未验证或缺少本地 adapter/sandbox/timeout 的声明必须 fail-closed。

本机能力评估得到两种不同结果：

- Kimi Code ACP 可由 Harness 自有根会话通过原生 `Agent` / `AgentSwarm` 创建 child。桥接可用 nonce 绑定的 `tool_call` 和 completion 事件证明 child 的创建与完成；只有在 strict `vm-v1` provider 保证 worker 身份、认证、网络和生命周期隔离时，才能作为 external same-session bridge 发布。
- Codex App Server 的 `thread/fork` 可创建持久 fork 上下文，但它不是已验证的原生 child-agent 调用。即使 fork 具有 `forkedFromId` 和同一 `sessionId`，也不能在严格策略下把它宣传为 external subagent。Codex 继续使用 verified `local-cli` adapter、sandbox、凭据隔离和 timeout。

## 2. 目标与非目标

### 2.1 目标

- 建立并验证 Kimi 的 external same-session bridge，统一接入标准 Harness envelope、run-meta、receipt 与 artifact 校验。
- 通过 Framework-owned `vm-v1` provider 以 copy-in/copy-out workspace、brokered credential/network、staged SHA 与完整 job-tree reaping 执行 Kimi；worker 不读取 Coordinator HOME、用户 Kimi state 或原始凭据。
- 保持 Codex 的 local-cli 调用能力，不把 session fork 误标为外部 child bridge。
- 让目录、签发 API、CLI 和页面根据声明式 bridge manifest 工作，不出现 `tool === "kimi"` 或未来工具名的实现分支。
- 让 Tokenizer 只读取项目的 `.agents-registry.json`，绝不回退读取用户可编辑的 `.claude/dispatch/agents-registry.example.json`。

### 2.2 非目标

- 本批次不注册 Codex external bridge，不发布 Codex `subagent` candidate，也不把 session fork 命名为原生 spawn。
- 不附着、读取或复用用户已经打开的 Codex/Kimi TUI 会话；桥接只使用 Harness 自己拥有的 Kimi parent session。
- 不读取、提交、上传或展示 Kimi `wire.jsonl`、厂商凭据、完整 prompt 或模型回复。
- 不放松 Generator source-handoff、A2A Generator 禁止、model-family 互斥、人工 done 闸门或外部进程安全边界。
- 不把 `sandbox-exec`、同 UID 临时 HOME、PATH、project registry、环境变量或测试 stub 作为 strict provider 或生产 attestation。

## 3. 关键设计裁决

### D1 - 签名保持稳定，执行目标携带 bridge provenance

人类签名继续只包含 `{ tool, invocation: "subagent" }`。解析后的受控 target 才携带 `bridge_id`、`bridge_strategy`、`agent_type`、session scope、允许角色与 `execution_provenance_sha256`；后者覆盖 target、adapter 执行契约、sandbox/timeout、bridge 与 A2A 语义。活动 v2 checkpoint、Gate、dispatch、sandbox 和 A2A client 都在实际执行前复算它，旧的五字段 checkpoint 必须重新 `/plan` 并 consume。这些都是本机 registry 和 verified manifest 的运行时审计数据，不能由控制台签名载荷指定。

### D2 - 当前 registry 只注册 Kimi external bridge

当前项目中，Kimi 使用受限对象声明：

```json
"subagent": { "bridge": "kimi-acp-native-agent" }
```

该 bridge 必须有 verified manifest、完整 protocol、固定三角色 persona 映射（planner / generator / evaluator），并继承 Kimi `local_cli` 的 verified adapter、sandbox 和 timeout。它只能在 strict provider attestation 有效时展开为 target；Generator 走 provider-owned copy-in/copy-out source-handoff。Codex integration 只保留 `local_cli`，不得声明 `subagent` object 或 legacy `subagent: true`。

这不等于代码对 Kimi 有工具名特判。catalog 按 manifest id 和协议验证；未来 CLI 需要自己的 verified manifest、受支持的协议和同会话 child provenance 后，添加声明即可进入目录。不能把未来 CLI 指向 Kimi manifest，也不能仅因“存在 session fork”而获得资格。

`agents-registry.example.json` 仅是用户参考文件，不是运行时配置来源。项目缺少或拒绝 `.agents-registry.json` 时，catalog 与 integration inventory 必须不可用，而不能从 example 回退。

### D3 - Kimi child 的证据标准

Kimi receipt 只记录受限 session 标识、nonce 哈希/有限标识、child tool-call 摘要、子代理类型、终态与 artifact digest。只有 nonce、预期 Agent 类型和 completion 同时匹配时才接受 child；ACP 错误、权限请求、无 child 证据、provider attestation 漂移或 artifact 缺失都 fail-closed。session wire 只可作本机诊断，不能成为实现数据源或产物。

### D5 - Strict VM provider 是外部 bridge 的唯一执行边界

Provider 必须符合 `external-bridge-provider.schema.json`：worker 使用与 Coordinator 不同的 VM principal，仓库、runner 和 staged CLI bundle 仅 copy-in/copy-out，host filesystem 默认拒绝，凭据与网络仅经 broker，provider 负责完整 job-tree 生命周期，结果仅经 supervisor pipe 返回。provider 的 canonical contract SHA、stable id 与 nonce-bound attestation 进入 resolved target 和 `execution_provenance_sha256`，并在 catalog resolution 与 launch 前重新验证。缺失、过期、字段漂移或非 provider-owned observation 都不能发布或执行 bridge。

### D4 - profile 语义按可执行外部能力定义

`heterogeneous` 表达“非 A2A 的异家族外部执行”，可组合 Codex `local-cli` 与 Kimi verified same-session bridge，但 Generator/Evaluator 仍必须使用不同 model family。`slow` 继续要求至少一个 A2A；A2A 不可担任 Generator。前端、服务端签发校验、console validator 和本机 Agent mirror 必须保持同一判断。

## 4. Feature 与验收

### F001 - 声明式桥接注册与能力目录

**范围：** Harness template 的 registry schema/catalog/active resolver，以及 Tokenizer 的 catalog mirror。

**验收：**

- 当前 registry 只在 strict provider attestation 有效时把 Kimi 的 verified manifest 展开为 planner / generator / evaluator external `subagent` candidate；Codex 只发布 `local-cli`（以及独立配置的 A2A）candidate。
- bridge manifest 严格校验 `id`、`_verified`、`session_scope`、`strategy`、`protocol`、`personas` 和可选说明字段；外部 bridge 必须继承 verified local-cli contract。
- future CLI 的独立 verified manifest 可被同一解析器发现，未知或未验证 bridge 均 fail-closed，且目录实现不含工具名白名单。
- 缺少项目 registry 时不读取 user example registry；legacy Coordinator-native Claude 路径保持兼容，但不被误路由为 external bridge。

### F002 - Codex local-cli 保持与 external bridge 禁止

**范围：** Codex integration 声明、catalog regression 和运行边界。

**验收：**

- Codex 继续使用 verified adapter、sandbox、凭据隔离和 timeout 执行 local-cli 任务。
- Codex 不声明 external `subagent` bridge，catalog、report、签发页面和模式快照均不显示 Codex bridge provenance。
- 不把 App Server `thread/fork` 的上下文关系作为 Harness child-agent 证据，也不生成 Codex bridge receipt。

### F003 - Kimi ACP 原生 Agent 子代理 bridge

**范围：** 通用 ACP strategy、Kimi bridge manifest、fixture 和 receipt 校验。

**验收：**

- runner 在 provider-owned worker 中用 ACP 管理 Harness 自有 session，并强制 root 通过 `Agent` 委派一个带 nonce 的 child；planner / generator / evaluator 分别使用受控的 plan / coder / explore persona，Generator 的修改仅通过 source-handoff artifact 返回。
- 仅 nonce、类型和 completion 一致时接受 child；无证据、ACP 错误或权限请求都 fail-closed/准确映射。
- 不读取或泄露用户会话 wire、prompt、模型输出或凭据；worker 不复制或挂载用户 Kimi state，认证和网络仅由 provider broker 提供。

### F004 - 模式签发、设备目录与动态界面语义

**范围：** mode intent 校验、profile 规则、Tokenizer Agent report/catalog mirror、模式编辑器及中英文文案。

**验收：**

- Kimi bridge 仅在 strict provider attestation 有效时在现有动态三角色选择器中自动出现并显示 external same-session provenance；Codex 只显示 local-cli 路径。
- `heterogeneous` 可签发 Kimi bridge 与 Codex local-cli 的异家族组合；slow/A2A 和 family-exclusivity 约束不被放宽。
- 设备 report、服务端 API、CLI 与 UI 对同一 Kimi-only registry 的接受/拒绝结果一致；user example registry 不参与发现。

### F005 - 真实探针、回归矩阵与独立验收

**范围：** 只读探针、测试报告和 release gate；禁止产品功能代码修改。

**验收：**

- 在已认证的本机 Kimi 上通过 strict provider 运行无源码写入 probe，得到合格的 parent-child provenance；Codex 只运行 local-cli 健康检查，不执行 child-bridge probe。
- Framework 和 Tokenizer 聚焦测试、全量 test/typecheck/lint/build 通过。
- fresh-context Evaluator 锁定 SHA 自行复验并写 schema 合法 verdict；全 PASS 后举一次性 `BL-NATIVE-SUBAGENT-BRIDGES-verifying-done-w1` 人工闸门。批准前不得 push、部署或更新本机 Agent。

## 5. 完成定义

- F001-F005 完成，Kimi external bridge 有可复验的最小 provenance，Codex 保持 local-cli，且不泄露会话内容。
- future CLI 只有在自身 bridge capability 经独立验证后才自动出现在 catalog；目录和解析不含工具名特判。
- 独立验收全 PASS、人工签名闸门已消费；随后才允许提交、推送、部署和本机 Agent 更新。
