// autonomous-mode.md 机件 #4「确定性 Gate Arbiter + Governor」。
// 由 /loop /autodrive 每次唤醒调用一次，跑「一个指令周期」。
// 安全关键逻辑（governor / classifyGate / budget）是纯函数，零模型判断。
// §8 契约：引擎不 flip status——本 workflow RETURN 决策，由耐久 /autodrive 层做 commit + 推进 + 重排。
// 约束：Workflow 内 Date 不可用 → 时间通过 args.now（ISO-8601 UTC 字符串）传入；过期硬判在 validate-autonomy-policy.sh。
// 依赖已装 subagent：agentType 'generator-restricted'（机件 #0）、'spec-lock-critic'（机件 #2），均在 .claude/agents/。

export const meta = {
  name: 'autodrive-gate-arbiter',
  description: 'One autonomous wake cycle: deterministic governor + gate classifier, dispatch one phase-step, return decision (never flips status)',
  phases: [{ title: 'Wake' }],
}

// ==================== 纯函数：安全关键，零模型判断 ====================

// 闸门分类：(from → to) → 'A' 可逆内环/同阶段继续 / 'B' →done / 'C' 不可逆
function classifyGate(fromStatus, toStatus) {
  if (toStatus === fromStatus) return 'A'          // 同阶段继续（如 building 下一 feature），非跨越
  if (toStatus === 'done') return 'B'
  const reversibleInner = new Set([
    'planning>building', 'planning>verifying',
    'building>verifying', 'verifying>fixing',
    'fixing>reverifying', 'reverifying>fixing',
  ])
  return reversibleInner.has(`${fromStatus}>${toStatus}`) ? 'A' : 'C'
}

// Governor：命中任一 halt_condition → 停。now 为 ISO 字符串（同格式 UTC 可字典序比较）。
function governor(state, policy, ledger, now) {
  const halts = []
  if (!policy || policy.enabled !== true) halts.push('policy_disabled')
  if (policy && policy.expires_at && now >= policy.expires_at) halts.push('policy_expired')
  if (policy && policy.batch_scope !== state.current_sprint) halts.push('scope_mismatch')
  const b = (policy && policy.budget) || {}
  if (ledger.tokens >= (b.max_tokens ?? Infinity)) halts.push('budget_breach:tokens')
  if (ledger.cost_usd >= (b.max_cost_usd ?? Infinity)) halts.push('budget_breach:cost')
  if (ledger.wake_n >= (b.max_wakes ?? Infinity)) halts.push('budget_breach:wakes')
  if (state.fix_rounds >= (b.max_fix_rounds ?? Infinity)) halts.push('max_fix_rounds')
  if ((ledger.same_feature_fail_streak ?? 0) >= 2) halts.push('no_progress')
  return { halt: halts.length > 0, reasons: halts }
}

// status → 下一动作（纯映射，不执行）
function decode(status) {
  return ({
    new: 'plan', planning: 'plan',
    building: 'build', fixing: 'build',
    verifying: 'verify', reverifying: 'verify',
    done: 'finish',
  })[status] || 'unknown'
}

const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['violation', 'detail'],
  properties: {
    violation: { type: 'boolean' },
    detail: { type: 'string' },
    offending_files: { type: 'array', items: { type: 'string' } },
    unmapped_tags: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts', 'all_pass'],
  properties: {
    all_pass: { type: 'boolean' },
    verdicts: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['feature_id', 'result', 'evidence', 'steps_to_reproduce'],
      properties: {
        feature_id: { type: 'string' },
        result: { type: 'string', enum: ['PASS', 'PARTIAL', 'FAIL'] },
        evidence: { type: 'string', minLength: 1 },          // 机件 #3：证据非空
        steps_to_reproduce: { type: 'string', minLength: 1 },
      } } },
  },
}

// 机件 #6 去偏：主 evaluator 档位按 wake_n 确定性轮换（Workflow 内无 Math.random）；
// 第二 evaluator 取"下一档"，永远与主档位不同 → 打破相关模型盲点。档位表为可调旋钮。
// v1.1：有 .agents-registry.json 时改走 family 轮换（跨厂商），本表降为无注册表时的回退。
const EVAL_TIERS = [{ model: 'opus', effort: 'high' }, { model: 'sonnet', effort: 'high' }]

// ==================== dispatch 层（dispatch-mode.md）====================
// args.registry 由 /autodrive 耐久层读盘注入（Workflow 无文件系统权限）。
// 无注册表 ⇒ 全部回退到 v1.0 行为，存量项目零影响。

// `tool-integrations/1` removes user-selectable Agent Cards. The autonomous
// workflow receives the raw registry rather than invoking Python, so it may
// derive only static local-cli/A2A targets for audit routing. In particular it
// must not turn a raw `subagent.bridge` string into a selectable external
// target: bridge-manifest and adapter verification live in tool-catalog.py.
// Verified external bridge assignments are projected below only from the
// durable layer's freshly validated `resolved_mode_bindings` snapshot. Legacy
// dispatch/1 registries retain their original descriptors unchanged.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/
const PYTHON_STRIP_WHITESPACE = /^[\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g

// Keep this in lockstep with tool-catalog.py: bounded_text() rejects controls
// then stores the stripped model family. The raw canonical registry still
// reaches this workflow for audit routing, so comparing its unnormalized value
// against the catalog-produced signed resolution would otherwise cause a false
// drift halt. Do not use JavaScript trim(): its Unicode whitespace set differs
// from Python str.strip(), which the catalog uses.
function canonicalModelFamily(value) {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) return null
  const normalized = value.replace(PYTHON_STRIP_WHITESPACE, '')
  return normalized && normalized.length <= 128 ? normalized : null
}

function registryAgents(registry) {
  if (!registry || typeof registry !== 'object') return []
  if (registry.version !== 'tool-integrations/1') return Array.isArray(registry.agents) ? registry.agents : []
  if (!Array.isArray(registry.integrations) || !Array.isArray(registry.a2a_targets)) return []
  const integrations = new Map()
  for (const integration of registry.integrations) {
    if (!integration || typeof integration !== 'object' || typeof integration.id !== 'string') continue
    const modelFamily = canonicalModelFamily(integration.model_family)
    if (!modelFamily) continue
    integrations.set(integration.id, { ...integration, model_family: modelFamily })
  }
  const targets = []
  const roles = ['planner', 'generator', 'evaluator']
  const priorityOf = value => Number.isSafeInteger(value) && value >= 0 ? value : 1000
  const roleConstraints = role => ({ l2: false, write_src: role === 'generator', push: false })
  for (const integration of integrations.values()) {
    const base = {
      tool: integration.tool,
      model_family: integration.model_family,
      priority: priorityOf(integration.priority),
      capabilities: Array.isArray(integration.capabilities) ? integration.capabilities : [],
      integration_id: integration.id,
    }
    if (integration.local_cli && typeof integration.local_cli === 'object') {
      for (const role of roles) {
        targets.push({
          ...base,
          id: `local-cli--${integration.id}--${role}`,
          roles: [role],
          transport: 'local-cli',
          adapter: integration.local_cli.adapter,
          sandbox: integration.local_cli.sandbox,
          timeout_s: integration.local_cli.timeout_s,
          constraints: roleConstraints(role),
        })
      }
    }
    // Do not project `subagent` here. A syntactically valid registry string
    // says nothing about a verified bridge manifest, protocol, or matching
    // adapter command. See verifiedExternalBridgeCandidate() for the only
    // v2 external-bridge path this workflow may use.
  }
  for (const target of registry.a2a_targets) {
    if (!target || typeof target !== 'object' || typeof target.id !== 'string') continue
    const integration = integrations.get(target.integration_id)
    if (!integration || !integration.local_cli || typeof integration.local_cli !== 'object') continue
    const capabilities = [
      ...(Array.isArray(integration.capabilities) ? integration.capabilities : []),
      ...(Array.isArray(target.capabilities) ? target.capabilities : []),
    ]
    for (const role of ['planner', 'evaluator']) {
      targets.push({
        id: `a2a--${target.id}--${role}`,
        integration_id: integration.id,
        tool: integration.tool,
        model_family: integration.model_family,
        priority: priorityOf(target.priority ?? integration.priority),
        capabilities: [...new Set(capabilities)],
        roles: [role],
        transport: 'a2a',
        endpoint: target.endpoint,
        auth: target.auth,
        remote_runner_id: target.remote_runner_id,
        constraints: roleConstraints(role),
      })
    }
  }
  return targets
}

const eligible = (registry, role) =>
  registryAgents(registry).filter(a => (a.roles || []).includes(role))

// 确定性轮换：同一 wake_n 恒选同一个（无 Math.random，可重放）
const pick = (pool, n) => (pool.length ? pool[((n % pool.length) + pool.length) % pool.length] : null)

// 已解析的 role_assignments 是人类签名工具绑定在本机 resolver 后的运行时事实。
// 有显式 assignment 时，绝不能退回 registry 全局池另挑一个 agent；那会让控制台显示的
// 工具选择与实际派活脱钩。无 assignment 才保留 v1.0/v1.1 的默认轮换。
function assigned(registry, state, role, currentResolution) {
  const assignments = state && state.role_assignments
  if (!assignments || typeof assignments !== 'object' || !Object.prototype.hasOwnProperty.call(assignments, role)) {
    return { configured: false, candidate: null, id: null }
  }
  const id = assignments[role]
  if (typeof id !== 'string' || !id) return { configured: true, candidate: null, id: null }
  const candidate = candidateForAssignment(registry, state, role, currentResolution)
  return { configured: true, candidate, id }
}

const ROLE_NAMES = ['planner', 'generator', 'evaluator']
const STABLE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const STABLE_TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const EXECUTION_PROVENANCE_SHA256 = /^[0-9a-f]{64}$/
const EXTERNAL_SUBAGENT_TARGET = /^subagent--([A-Za-z0-9][A-Za-z0-9._-]{0,63})--(planner|generator|evaluator)$/

function descriptorPriority(descriptor) {
  return Number.isSafeInteger(descriptor && descriptor.priority) && descriptor.priority >= 0
    ? descriptor.priority
    : 1000
}

function exactResolutionRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = Object.keys(value).sort()
  if (fields.join(',') !== 'agent_id,execution_provenance_sha256,invocation,model_family,priority,tool') return false
  return typeof value.agent_id === 'string' && STABLE_AGENT_ID.test(value.agent_id)
    && STABLE_TOOL_ID.test(value.tool)
    && ['subagent', 'local-cli', 'a2a'].includes(value.invocation)
    && typeof value.model_family === 'string' && value.model_family.length > 0
    && Number.isSafeInteger(value.priority) && value.priority >= 0
    && typeof value.execution_provenance_sha256 === 'string'
    && EXECUTION_PROVENANCE_SHA256.test(value.execution_provenance_sha256)
}

function sameResolution(left, right) {
  return exactResolutionRecord(left)
    && exactResolutionRecord(right)
    && left.agent_id === right.agent_id
    && left.tool === right.tool
    && left.invocation === right.invocation
    && left.model_family === right.model_family
    && left.priority === right.priority
    && left.execution_provenance_sha256 === right.execution_provenance_sha256
}

// The workflow cannot read bridge manifests or adapter contracts. Treat the
// six-field output of validate-resolved-mode-bindings.sh as its trust boundary:
// the durable caller supplies it only after tool-catalog.py has revalidated
// the current registry, bridge manifest, and adapter. The raw registry is used
// here solely to bind the opaque target to a unique integration's non-bridge
// identity; it can never create an external candidate by itself.
function verifiedExternalBridgeCandidate(registry, role, record) {
  if (!exactResolutionRecord(record) || record.invocation !== 'subagent') return null
  const match = EXTERNAL_SUBAGENT_TARGET.exec(record.agent_id)
  if (!match || match[2] !== role) return null
  if (!registry || registry.version !== 'tool-integrations/1' || !Array.isArray(registry.integrations)) return null
  const integrationId = match[1]
  const matches = registry.integrations.filter(integration => integration
    && typeof integration === 'object'
    && integration.id === integrationId)
  if (matches.length !== 1) return null
  const integration = matches[0]
  const modelFamily = canonicalModelFamily(integration.model_family)
  const priority = Number.isSafeInteger(integration.priority) && integration.priority >= 0
    ? integration.priority
    : 1000
  if (!STABLE_TOOL_ID.test(integration.tool) || !modelFamily
    || integration.tool !== record.tool
    || modelFamily !== record.model_family
    || priority !== record.priority) return null
  const personas = { planner: 'planner-proposal', generator: 'generator-restricted', evaluator: 'evaluator' }
  return {
    id: record.agent_id,
    integration_id: integrationId,
    tool: record.tool,
    model_family: record.model_family,
    priority: record.priority,
    capabilities: Array.isArray(integration.capabilities) ? integration.capabilities : [],
    roles: [role],
    transport: 'subagent',
    agent_type: personas[role],
    // This is deliberately a boolean rather than the raw bridge ID. The
    // dispatcher receives only the opaque target id and re-resolves the real
    // manifest immediately before execution.
    verified_bridge: true,
    constraints: { l2: false, write_src: role === 'generator', push: false },
  }
}

function candidateForAssignment(registry, state, role, currentResolution) {
  const assignments = state && state.role_assignments
  if (!assignments || typeof assignments !== 'object' || !Object.prototype.hasOwnProperty.call(assignments, role)) {
    return null
  }
  const id = assignments[role]
  if (typeof id !== 'string' || !id) return null
  const staticCandidate = registryAgents(registry).find(candidate =>
    candidate.id === id && (candidate.roles || []).includes(role)) || null
  if (staticCandidate) return staticCandidate

  // Only a consumed v2 intent plus the fresh, verified resolver snapshot may
  // materialize an external same-session bridge candidate.
  const stored = state && state.mode_intent && state.mode_intent.resolution
  const current = currentResolution && currentResolution[role]
  if (!stored || typeof stored !== 'object' || !sameResolution(stored[role], current)
    || current.agent_id !== id) return null
  return verifiedExternalBridgeCandidate(registry, role, current)
}

function resolutionDrift(state, registry, currentResolution) {
  const modeIntent = state && state.mode_intent
  if (!modeIntent || typeof modeIntent !== 'object' || !Object.prototype.hasOwnProperty.call(modeIntent, 'resolution')) {
    return null // v1 and non-v2 paths intentionally retain their historical assignment behavior.
  }
  const audit = modeIntent.resolution
  const assignments = state && state.role_assignments
  if (!audit || typeof audit !== 'object' || Array.isArray(audit) || !assignments || typeof assignments !== 'object') {
    return { role: 'mode_intent', detail: 'v2 resolution or role_assignments is malformed' }
  }
  for (const role of ROLE_NAMES) {
    const expected = audit[role]
    if (role === 'planner' && expected === null) {
      if (assignments[role] !== null) {
        return { role, detail: 'Coordinator Planner assignment must remain null' }
      }
      const current = currentResolution && currentResolution[role]
      if (current !== undefined && current !== null) {
        return { role, detail: 'current Planner resolution drifted from Coordinator route' }
      }
      continue
    }
    if (!exactResolutionRecord(expected)) {
      return { role, detail: 'stored v2 resolution must contain exactly six fields including execution provenance' }
    }
    if (assignments[role] !== expected.agent_id) {
      return { role, detail: 'role_assignments agent_id differs from stored v2 resolution' }
    }
    if (!currentResolution || typeof currentResolution !== 'object' || Array.isArray(currentResolution)
      || !Object.prototype.hasOwnProperty.call(currentResolution, role)) {
      return { role, detail: 'v2 execution provenance requires a verified current catalog resolution' }
    }
    const resolved = currentResolution[role]
    if (!sameResolution(expected, resolved)) {
      return { role, detail: 'current adapter/catalog resolution differs from stored v2 resolution' }
    }
    const descriptor = registryAgents(registry).find(item =>
      item && item.id === expected.agent_id && (item.roles || []).includes(role))
      || verifiedExternalBridgeCandidate(registry, role, resolved)
    if (!descriptor) return { role, detail: 'stored v2 agent_id no longer resolves to an authorized descriptor' }
    if (descriptor.transport !== expected.invocation) {
      return { role, detail: 'descriptor invocation drifted from stored v2 resolution' }
    }
    if (descriptor.model_family !== expected.model_family) {
      return { role, detail: 'descriptor model_family drifted from stored v2 resolution' }
    }
    if (descriptorPriority(descriptor) !== expected.priority) {
      return { role, detail: 'descriptor priority drifted from stored v2 resolution' }
    }
  }
  return null
}

// 独立性互斥（dispatch-mode.md §3.2）：evaluator 的 model_family 必须 ≠ generator 的。
// validate-dispatch.sh assignments 是第一道门，这里是派活当下的第二道——纵深防御。
function resolveEvaluators(registry, wakeN, generatorFamily, configuredPrimary) {
  if (configuredPrimary) {
    if (generatorFamily && configuredPrimary.model_family === generatorFamily) return null
    const secondaryPool = eligible(registry, 'evaluator').filter(a =>
      a.id !== configuredPrimary.id
      && a.model_family !== configuredPrimary.model_family
      && (!generatorFamily || a.model_family !== generatorFamily))
    return { primary: configuredPrimary, second: pick(secondaryPool, wakeN) }
  }
  const pool = eligible(registry, 'evaluator').filter(a => !generatorFamily || a.model_family !== generatorFamily)
  if (!pool.length) return null
  const primary = pick(pool, wakeN)
  const second = pool.find(a => a.model_family !== primary.model_family) || null
  return { primary, second }
}

// 信封 contract 字段：**常量模板，不由模型撰写**。外部 CLI 不读仓内指令文件，契约随信封走。
const CONTRACT = {
  evaluator:
    '你是独立 Evaluator。只依据 acceptance 与实测证据判 PASS/PARTIAL/FAIL；不修改任何产品代码'
    + '（src/ prisma/ 配置一律不动），只写 tests/ 与 docs/test-reports/。每条判定必须带非空 evidence 与'
    + ' steps_to_reproduce，无证据的 PASS 一律降级 PARTIAL。撞 L2（真实外部服务/计费/生产写入）而'
    + ' l2_authorized=false 时，写 waiting="auth" + waiting_detail 后正常退出，不得自行触达。'
    + '规格歧义无法客观判定时写 waiting="adjudication"。产物必须满足 deliverable.schema。',
}

const DELIVERABLE = {
  evaluator: (batch) => ({
    artifact: `docs/test-reports/${batch}-verdict.json`,
    schema: '.claude/autonomous/verdict-artifact.schema.json',
    commit_to: null,
  }),
}

// batch 会同时进入 envelope、artifact 和 dispatcher 写出的 envelope filename。
// 不要依赖下游校验器才发现它不安全：task id 在本 workflow 内由 batch 派生，
// 因而在任何 agent 被要求写文件前先把组成项和最终值一起封住。
const SAFE_DISPATCH_BATCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_DISPATCH_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/

function boundedDispatchCounter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`unsafe dispatch ${label}: expected a non-negative safe integer`)
  }
  return value
}

function makeDispatchTaskId(batch, role, wakeN, fixRound) {
  if (typeof batch !== 'string' || !SAFE_DISPATCH_BATCH.test(batch)) {
    throw new Error('unsafe dispatch batch: must be a safe identifier')
  }
  const wake = boundedDispatchCounter(wakeN, 'wake_n')
  const round = boundedDispatchCounter(fixRound, 'fix_round')
  const taskId = `${batch}-${role}-w${wake}-r${round}`
  if (!SAFE_DISPATCH_TASK_ID.test(taskId)) {
    throw new Error('unsafe dispatch task_id derived from batch/role/counters')
  }
  return taskId
}

// dispatcher subagent 的返回 schema —— 注意这里**结构性地没有装结论的字段**：
// 它只搬运指针（receipt state + 产物路径），验收结论由耐久层直接读产物文件。
// 模型在这条链路上永远不携带结论 ⇒ 铁律 12 从自觉变为结构强制。
const RECEIPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['state', 'artifact_path', 'run_meta_path'],
  properties: {
    state: { type: 'string', enum: ['COMPLETED', 'AUTH_REQUIRED', 'INPUT_REQUIRED', 'FAILED', 'CANCELED', 'ARTIFACT_INVALID'] },
    artifact_path: { type: 'string' },
    run_meta_path: { type: 'string' },
    envelope_path: { type: 'string' },
    // local-cli Generator 回流前需要定位沙箱 clone；A2A Generator 在注册表层已拒绝，
    // 这里仍允许 null 以保持 Evaluator/A2A receipt 兼容。
    worktree_path: { type: ['string', 'null'] },
    reason: { type: 'string', description: '仅描述运输层失败原因，不得描述验收内容' },
    // 机械投影：只有布尔与计数，schema 层禁止任何自由文本结论字段。
    // 引擎需要 all_pass 才能提出 proposedNext；完整结论仍由耐久层从产物文件**逐字**回写（铁律 12）。
    verdict_summary: {
      type: 'object', additionalProperties: false,
      required: ['all_pass'],
      properties: {
        all_pass: { type: 'boolean' },
        pass_count: { type: 'integer', minimum: 0 },
        partial_count: { type: 'integer', minimum: 0 },
        fail_count: { type: 'integer', minimum: 0 },
      },
    },
  },
}

// 派一个外部 Evaluator（local-cli、a2a 或已验证同会话 bridge）。dispatcher subagent 只跑三条机械命令，无评估权。
// Generator 绝不能复用此通道：它需要固定 handoff 信封、未提交 sandbox diff 和 Coordinator 回流协议。
async function dispatchExternal(d, { batch, role, ref, spec, features, l2, fixRound, wakeN }) {
  const makeDeliverable = DELIVERABLE[role]
  if (!CONTRACT[role] || !makeDeliverable) {
    throw new Error(`unsupported external role ${role}`)
  }
  // 幂等键：确定性（Workflow 内无 Date/Math.random），且每次唤醒唯一。
  // makeDispatchTaskId 还确保派生值本身仍在 envelope 的安全长度/字符集内。
  const taskId = makeDispatchTaskId(batch, role, wakeN, fixRound)
  const envelope = {
    task_id: taskId, contract_version: 'harness/1.1', batch, role,
    repo: { url: '.', ref }, spec: spec || null, features: features || [],
    l2_authorized: l2 === true, contract: CONTRACT[role],
    deliverable: makeDeliverable(batch, taskId),
  }
  return await agent(
    `你是 dispatch 搬运工，**无评估权**。严格执行四条命令，不做任何解读、不总结产物内容：\n`
    + `1. 把以下 JSON 原样写入 .harness-dispatch/envelope-${taskId}.json（一个字节都不要改）：\n`
    + `${JSON.stringify(envelope)}\n`
    + `2. bash .claude/dispatch/validate-dispatch.sh envelope .harness-dispatch/envelope-${taskId}.json\n`
    + `3. bash .claude/dispatch/dispatch-run.sh --agent ${d.id} --envelope .harness-dispatch/envelope-${taskId}.json\n`    + `   （该入口按 descriptor.transport 自动路由：local-cli 走本机沙箱，a2a 走远端 runner + SSE 订阅）\n`
    + `4. bash .claude/dispatch/validate-dispatch.sh receipt <上一步 run-meta 路径>\n`
    + `返回 receipt 的 state、artifact_path、run_meta_path、envelope_path；再从 run-meta JSON 机械读取 worktree 字段并以`
    + ` worktree_path 返回（不存在则 null）。role=evaluator 时另用 python3 从产物机械统计 verdict_summary`
    + `（all_pass 与三个计数）。**除此之外不要读取、引用或转述产物内容**——结论由耐久层逐字读文件回写。`,
    { label: `dispatch:${role}:${d.id}`, phase: 'Wake', effort: 'low',
      agentType: 'general-purpose', schema: RECEIPT_SCHEMA })
}

function generatorHandoffArtifact(taskId) {
  return `docs/test-reports/generator-handoff-${taskId}.json`
}

function generatorCapabilityIssue(descriptor) {
  const returnable = descriptor && (descriptor.transport === 'local-cli'
    || (descriptor.transport === 'subagent' && descriptor.verified_bridge === true))
  if (!returnable) {
    return 'Generator source return requires local-cli or a verified same-session subagent bridge'
  }
  const constraints = descriptor.constraints
  if (!constraints || typeof constraints !== 'object') {
    return 'Generator descriptor lacks fixed source-handoff constraints'
  }
  if (constraints.write_src !== true) return 'Generator requires constraints.write_src=true'
  if (constraints.push !== false) return 'Generator requires constraints.push=false'
  if (constraints.l2 !== false) return 'Generator requires constraints.l2=false'
  return null
}

// Generator has a deliberately separate protocol. The wrapper reconstructs a
// fixed envelope from the already materialized runtime assignment, validates
// the handoff, and returns a sandbox-contained *uncommitted* diff. Only the
// Coordinator can later rerun L1, apply the diff, and create the feature commit.
async function dispatchExternalGenerator(d, { batch, featureId, fixRound, wakeN }) {
  const taskId = makeDispatchTaskId(batch, 'generator', wakeN, fixRound)
  const artifact = generatorHandoffArtifact(taskId)
  return await agent(
    `你是 dispatch 搬运工，**无评估权**。严格执行下面这一条命令；不要自行组装通用 Generator 信封、`
    + `不要提交、push、apply diff，也不要解读 handoff 内容：\n`
    + `bash .claude/dispatch/dispatch-generator-handoff.sh --task-id ${taskId} --feature ${featureId}\n`
    + `该包装器固定生成 deliverable.artifact=${artifact}，要求 external Generator 只返回 sandbox 内的未提交源码 diff `
    + `与 handoff；它会机械校验信封、run-meta、handoff。命令成功后，只从其 JSON 输出机械映射：`
    + `receipt.state -> state，handoff_path -> artifact_path，run_meta_path、envelope_path，以及 `
    + `receipt.worktree_path -> worktree_path。不得读取、引用或转述 handoff 内容。`,
    { label: `dispatch:generator:${d.id}`, phase: 'Wake', effort: 'low',
      agentType: 'general-purpose', schema: RECEIPT_SCHEMA })
}

// spec-lock 稽核（机件 #2）：在会写盘的 build/fix 步后、推进前跑；critic 自行 git diff，不需传入。
// v1.1：外部 generator 的产物在独立 worktree 里，稽核时机前移到「拉回主仓前」——传 worktree 路径。
async function specLockCritic(batchScope, worktree) {
  const c = await agent(
    `你是 spec-lock 稽核员，稽核 batch_scope=${batchScope}。`
    + (worktree ? `本次改动在外部 worktree ${worktree}（尚未进主仓），用 git -C ${worktree} log/diff 取证。` : '')
    + `自行 git show HEAD / git diff HEAD~1 取本次改动，`
    + `对照 features.json 判断是否越 scope 或 commit tag 不映射真实 feature id（铁律 10；`
    + `用 pre-impl-adjudication.md §4.6/§4.7 anti-patterns 为清单）。拿不准判 VIOLATION。`,
    { label: 'critic:spec-lock', phase: 'Wake', effort: 'low', agentType: 'spec-lock-critic', schema: CRITIC_SCHEMA })
  return c
}

// ==================== 一个唤醒周期 ====================
phase('Wake')
const { state, policy, ledger, now, registry } = args   // registry 由耐久层读盘注入；无则全程回退 v1.0 行为
const modeResolutionDrift = resolutionDrift(state, registry, args.resolved_mode_bindings)
if (modeResolutionDrift) {
  return {
    decision: 'HALT',
    reasons: ['configured_role_resolution_drift:' + modeResolutionDrift.role],
    detail: modeResolutionDrift.detail,
  }
}
const configuredRoles = {
  planner: assigned(registry, state, 'planner', args.resolved_mode_bindings),
  generator: assigned(registry, state, 'generator', args.resolved_mode_bindings),
  evaluator: assigned(registry, state, 'evaluator', args.resolved_mode_bindings),
}
for (const [role, resolution] of Object.entries(configuredRoles)) {
  if (role === 'planner' && resolution.configured && resolution.id === null) continue
  if (resolution.configured && !resolution.candidate) {
    return {
      decision: 'HALT',
      reasons: ['configured_role_unresolvable:' + role],
      detail: `progress.role_assignments.${role}=${resolution.id || '<empty>'} cannot be resolved in the injected registry`,
    }
  }
}
if (
  configuredRoles.generator.candidate
  && configuredRoles.evaluator.candidate
  && configuredRoles.generator.candidate.model_family === configuredRoles.evaluator.candidate.model_family
) {
  return {
    decision: 'HALT',
    reasons: ['configured_generator_evaluator_same_family'],
    detail: 'configured generator and evaluator have the same model_family',
  }
}

// 1. GOVERN（纯函数）— 任一 halt 条件命中即停，不回写
const gov = governor(state, policy, ledger, now)
if (gov.halt) return { decision: 'HALT', reasons: gov.reasons, writeback: null }

// 2. DECODE
const action = decode(state.status)
if (action === 'unknown') return { decision: 'HALT', reasons: ['undecodable_status:' + state.status] }
if (action === 'finish') return { decision: 'DONE_PENDING_USER', reasons: ['batch_complete'] }

// 3. EXECUTE 单步
let stepResult = null
let proposedNext = null

if (action === 'plan') {
  // 自主模式不自撰 spec（scope 漂移最危险处）——spec-lock 是人类闸门。
  // 仅当已有 locked spec + numbered features + status=planning 时，机械跨到 building/verifying；否则 HALT 交人类。
  const specLocked = state.spec_locked === true   // 由 /autodrive 从 docs/specs + progress.json.docs.spec 判定注入
  if (state.status === 'planning' && specLocked && (state.features || []).length > 0) {
    const allEval = state.features.every(f => f.executor === 'evaluator')
    proposedNext = allEval ? 'verifying' : 'building'
  } else {
    return { decision: 'HALT', reasons: ['spec_lock_required'],
      detail: '自主模式不自撰 spec；请人类先 /plan 锁定 spec 与 features.json 再启动。' }
  }

} else if (action === 'build') {
  // 派受限 generator subagent 实现/修复一个 pending 的 executor:generator feature（跑在 deny-list 下）。
  const pending = (state.features || []).filter(f => f.executor === 'generator' && f.status === 'pending')
  if (pending.length === 0) {
    proposedNext = 'verifying'                     // 所有 generator feature 完成 → 跨到验收
  } else {
    const t = pending[0]
    // 显式 assignment 必须精确命中；只有没有 assignment 的存量项目才可从默认池选外部 generator。
    const generatorChoice = configuredRoles.generator
    const extGen = generatorChoice.configured
      ? (generatorChoice.candidate.transport === 'subagent' && generatorChoice.candidate.verified_bridge !== true ? null : generatorChoice.candidate)
      : eligible(registry, 'generator').find(a => generatorCapabilityIssue(a) === null)
    const generatorAgentType = generatorChoice.configured && generatorChoice.candidate.transport === 'subagent'
      ? (generatorChoice.candidate.agent_type || 'generator-restricted')
      : 'generator-restricted'
    let extWorktree = null

    if (extGen) {
      const capabilityIssue = generatorCapabilityIssue(extGen)
      if (capabilityIssue) {
        return {
          decision: 'HALT',
          reasons: ['external_generator_capability_invalid'],
          detail: `${extGen.id}: ${capabilityIssue}`,
        }
      }
      const r = await dispatchExternalGenerator(extGen, {
        batch: state.current_sprint, featureId: t.id,
        fixRound: state.fix_rounds || 0, wakeN: ledger.wake_n ?? 0,
      })
      if (!r) return { decision: 'HALT', reasons: ['dispatch_failed:' + t.id], detail: 'dispatcher 返回空' }
      if (r.state === 'AUTH_REQUIRED' || r.state === 'INPUT_REQUIRED') {
        return { decision: 'HALT', reasons: [r.state.toLowerCase()], detail: r.reason,
          writeback: { dispatch: r, feature_id: t.id } }
      }
      if (r.state !== 'COMPLETED') {
        return { decision: 'HALT', reasons: ['external_generator_failed:' + r.state], detail: r.reason,
          writeback: { dispatch: r, feature_id: t.id } }
      }
      if (!r.artifact_path || !r.run_meta_path || !r.envelope_path || !r.worktree_path) {
        return { decision: 'HALT', reasons: ['external_generator_missing_return_evidence'],
          detail: 'Generator receipt lacks a handoff, envelope, run-meta, or local sandbox worktree',
          writeback: { dispatch: r, feature_id: t.id } }
      }
      stepResult = {
        role: 'generator', feature_id: t.id, result: 'completed', dispatch: r, agent_id: extGen.id,
        handoff_path: r.artifact_path, envelope_path: r.envelope_path, run_meta_path: r.run_meta_path,
        worktree_path: r.worktree_path, source_ref: state.head_sha,
      }
      extWorktree = r.worktree_path                 // 仅本地 clone 可在回流前做 scope/L1 核验
    } else {
      stepResult = await agent(
        `实现 feature ${t.id}${t.title ? '（' + t.title + '）' : ''}。读 docs/specs 对应段与 acceptance；`
        + `只做本 feature、越界即停；本地自测通过后以 feat(${state.current_sprint}-${t.id}): 独立 commit。`
        + `禁止任何 deploy/生产/花钱动作（deny-list 已强制）。bug 修复须同 commit 补回归测试。`,
        { label: `build:${t.id}`, phase: 'Wake', agentType: generatorAgentType,
          schema: { type: 'object', additionalProperties: false, required: ['feature_id', 'result', 'files_touched'],
            properties: {
              feature_id: { type: 'string' },
              result: { type: 'string', enum: ['completed', 'blocked'] },
              files_touched: { type: 'array', items: { type: 'string' } },
              blocked_reason: { type: 'string' },
            } } })
      if (!stepResult || stepResult.result === 'blocked') {
        return { decision: 'HALT', reasons: ['feature_blocked:' + t.id],
          detail: (stepResult && stepResult.blocked_reason) || 'generator 返回空/受阻', writeback: stepResult }
      }
    }

    // 机件 #2：完成后、推进前跑 spec-lock 稽核；越界即 HALT 交人类裁决（不自动 revert）。
    // 外部 generator 的稽核在**回流主仓前**进行——产物还在 worktree 里，拦得住才不会污染 main。
    const critic = await specLockCritic(state.current_sprint, extWorktree)
    if (critic && critic.violation) {
      return { decision: 'HALT', reasons: ['scope_drift'], detail: critic.detail, writeback: stepResult }
    }
    proposedNext = 'building'                       // 本 feature 完成 → 继续 building，下一 feature 交下一唤醒
  }

} else if (action === 'verify') {
  // 隔离 evaluator（≥4/多维 → fan-out）。对 FAIL/PARTIAL 证伪；对 PASS 抽样查证据（机件 #3）。
  // 机件 #6：v1.0 按档位轮换（同家族）；v1.1 有注册表时升级为**跨厂商 family 轮换**——
  // 同家族换档位只降一点盲区相关性，换 family 才是真去偏。
  const w = ledger.wake_n ?? 0
  const feats = state.features || []
  const configuredGenerator = configuredRoles.generator.candidate
  const configuredEvaluator = configuredRoles.evaluator
  const genFamily = configuredGenerator
    ? configuredGenerator.model_family
    : (eligible(registry, 'generator').find(a => a.transport === 'local-cli') || {}).model_family
  const evals = resolveEvaluators(
    registry,
    w,
    genFamily,
    configuredEvaluator.configured ? configuredEvaluator.candidate : null
  )
  const sampled = feats.length ? feats[w % feats.length] : null

  if (evals && (evals.primary.transport !== 'subagent' || evals.primary.verified_bridge === true)) {
    // ── 外部 evaluator：引擎只拿回执与机械投影，不碰结论 ──
    const r = await dispatchExternal(evals.primary, {
      batch: state.current_sprint, role: 'evaluator', ref: state.head_sha,
      spec: state.spec_path, features: [], l2: state.l2_authorized === true,
      fixRound: state.fix_rounds || 0, wakeN: w,
    })
    if (!r) return { decision: 'HALT', reasons: ['dispatch_failed:verify'], detail: 'dispatcher 返回空' }
    if (r.state === 'AUTH_REQUIRED' || r.state === 'INPUT_REQUIRED') {
      return { decision: 'HALT', reasons: [r.state.toLowerCase()], detail: r.reason, writeback: { dispatch: r } }
    }
    if (r.state !== 'COMPLETED') {
      return { decision: 'HALT', reasons: ['evaluator_cannot_verify:' + r.state], detail: r.reason,
        writeback: { dispatch: r } }
    }
    stepResult = {
      role: 'evaluator', dispatch: r, agent_id: evals.primary.id, model_family: evals.primary.model_family,
      all_pass: !!(r.verdict_summary && r.verdict_summary.all_pass),
    }
    // 去偏抽检：第二 evaluator 恒为不同 family。外部主验时引擎手上没有逐条判定，
    // 故只带回第二方结论 + 抽样 feature id，**分歧比对下沉到耐久层**（它本就要逐字读产物）。
    if (sampled && evals.second) {
      const second = await agent(
        `你是第二独立 evaluator（去偏抽检）。只验 feature ${sampled.id}：读 spec/acceptance + 实测，`
        + `独立给 PASS/PARTIAL/FAIL。prompt 无实现叙述、无第一 evaluator 的结论（铁律 12）。`,
        { label: `verify:debias:${sampled.id}`, phase: 'Wake', agentType: 'general-purpose',
          effort: 'high',
          schema: { type: 'object', additionalProperties: false, required: ['feature_id', 'result'],
            properties: { feature_id: { type: 'string' }, result: { type: 'string', enum: ['PASS', 'PARTIAL', 'FAIL'] } } } })
      stepResult.debias = second ? {
        feature_id: sampled.id, second_result: second.result,
        second_family: evals.second.model_family, primary_family: evals.primary.model_family,
        compare_at: 'durable',        // 耐久层：与产物中该 feature 的 result 比对，不一致 → debias_conflict 硬停
      } : null
    }

  } else {
    // ── 内部 subagent evaluator（无注册表 / 无外部 evaluator 时的默认路径，与 v1.0 一致）──
    const primaryTier = EVAL_TIERS[w % EVAL_TIERS.length]
    const secondTier = EVAL_TIERS[(w + 1) % EVAL_TIERS.length]
    stepResult = await agent(
      `以隔离 evaluator 验收 batch=${state.current_sprint}。prompt 只含 {spec/feature 路径, L2-flag}，`
      + `无任何实现叙述（铁律 12）。对 FAIL/PARTIAL 证伪已知环境误报；对 PASS 抽样核对 `
      + `steps_to_reproduce + evidence 非空，无证据的 PASS 一律降级 PARTIAL。`,
      { label: 'verify:evaluator', phase: 'Wake',
        agentType: configuredEvaluator.configured
          ? (configuredEvaluator.candidate.agent_type || 'general-purpose')
          : 'general-purpose',
        model: primaryTier.model, effort: primaryTier.effort, schema: VERDICT_SCHEMA })

    // 机件 #6：每批抽一个 feature 跑第二独立 evaluator，与主判定对比。
    // 抽样确定性（wake_n % n，无 Math.random）；分歧 → debias_conflict 硬停，防相关盲点整夜传播。
    if (stepResult && sampled) {
      const primary = (stepResult.verdicts || []).find(v => v.feature_id === sampled.id)
      const second = await agent(
        `你是第二独立 evaluator（去偏抽检）。只验 feature ${sampled.id}：读 spec/acceptance + 实测，`
        + `独立给 PASS/PARTIAL/FAIL。prompt 无实现叙述、无第一 evaluator 的结论（铁律 12）。`,
        { label: `verify:debias:${sampled.id}`, phase: 'Wake', agentType: 'general-purpose',
          model: secondTier.model, effort: secondTier.effort,
          schema: { type: 'object', additionalProperties: false, required: ['feature_id', 'result'],
            properties: { feature_id: { type: 'string' }, result: { type: 'string', enum: ['PASS', 'PARTIAL', 'FAIL'] } } } })
      if (second && primary && second.result !== primary.result) {
        return { decision: 'HALT', reasons: ['debias_conflict'], writeback: stepResult,
          detail: `去偏抽检分歧 @${sampled.id}：主 ${primary.result}（${primaryTier.model}）vs 第二 ${second.result}（${secondTier.model}）——交人类裁决` }
      }
    }
  }
  proposedNext = stepResult && stepResult.all_pass ? 'done' : 'fixing'
}

// 4. 分类结果闸门 + 组装返回。真正的 commit/status flip/reschedule 由耐久 /autodrive 层执行（§8）。
const gateClass = proposedNext ? classifyGate(state.status, proposedNext) : 'A'
const allowed = gateClass === 'A' || (gateClass === 'B' && (policy.auto_cross || []).includes('B'))

return {
  decision: allowed ? 'ADVANCE' : (gateClass === 'C' ? 'HALT' : 'HANDBACK'),
  gateClass,
  proposedNext,          // 目标 status，交 /autodrive 层落盘
  writeback: stepResult, // evaluator_feedback 等由 /autodrive 层原样写 progress.json/features.json（铁律 12）
  reasons: allowed ? [] : [`gate_${gateClass}_requires_user`],
}
