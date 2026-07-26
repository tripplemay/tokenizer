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

const eligible = (registry, role) =>
  ((registry && registry.agents) || []).filter(a => (a.roles || []).includes(role))

// 确定性轮换：同一 wake_n 恒选同一个（无 Math.random，可重放）
const pick = (pool, n) => (pool.length ? pool[((n % pool.length) + pool.length) % pool.length] : null)

// 独立性互斥（dispatch-mode.md §3.2）：evaluator 的 model_family 必须 ≠ generator 的。
// validate-dispatch.sh assignments 是第一道门，这里是派活当下的第二道——纵深防御。
function resolveEvaluators(registry, wakeN, generatorFamily) {
  const pool = eligible(registry, 'evaluator').filter(a => !generatorFamily || a.model_family !== generatorFamily)
  if (!pool.length) return null
  const primary = pick(pool, wakeN)
  const second = pool.find(a => a.model_family !== primary.model_family) || pick(pool, wakeN + 1)
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
  generator:
    '你是 Generator。只实现 features 列出的条目，越界即停；每条 feature 独立 commit，message 必须为'
    + ' feat(<batch>-<feature_id>): 格式且对应 features.json 真实条目。禁止任何 deploy / 生产写入 / 花钱调用。'
    + '不得 git push（沙箱已禁用）。本地 lint/tsc/test 必须全绿；bug 修复须同 commit 补回归测试。'
    + '规格歧义时写 waiting="adjudication" + waiting_detail 后正常退出，不要猜测规格。',
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

// 派一个外部 agent（transport=local-cli 或 a2a）。dispatcher subagent 只跑三条机械命令，无评估权。
// transport 差异由 dispatch-run.sh 吸收，引擎侧完全不感知。
async function dispatchExternal(d, { batch, role, ref, spec, features, l2, fixRound, wakeN }) {
  // 幂等键：确定性（Workflow 内无 Date/Math.random），且每次唤醒唯一
  const taskId = `${batch}-${role}-w${wakeN}-r${fixRound}`
  const envelope = {
    task_id: taskId, contract_version: 'harness/1.1', batch, role,
    repo: { url: '.', ref }, spec: spec || null, features: features || [],
    l2_authorized: l2 === true, contract: CONTRACT[role],
    deliverable: {
      artifact: `docs/test-reports/${batch}-verdict.json`,
      schema: '.claude/autonomous/verdict-artifact.schema.json',
      commit_to: null,
    },
  }
  return await agent(
    `你是 dispatch 搬运工，**无评估权**。严格执行三条命令，不做任何解读、不总结产物内容：\n`
    + `1. 把以下 JSON 原样写入 .harness-dispatch/envelope-${taskId}.json（一个字节都不要改）：\n`
    + `${JSON.stringify(envelope)}\n`
    + `2. bash .claude/dispatch/validate-dispatch.sh envelope .harness-dispatch/envelope-${taskId}.json\n`
    + `3. bash .claude/dispatch/dispatch-run.sh --agent ${d.id} --envelope .harness-dispatch/envelope-${taskId}.json\n`    + `   （该入口按 descriptor.transport 自动路由：local-cli 走本机沙箱，a2a 走远端 runner + SSE 订阅）\n`
    + `4. bash .claude/dispatch/validate-dispatch.sh receipt <上一步 run-meta 路径>\n`
    + `返回 receipt 的 state 与两个路径。role=evaluator 时另用 python3 从产物机械统计 verdict_summary`
    + `（all_pass 与三个计数）。**除此之外不要读取、引用或转述产物内容**——结论由耐久层逐字读文件回写。`,
    { label: `dispatch:${role}:${d.id}`, phase: 'Wake', effort: 'low',
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
    // v1.1：generator 可解析到外部 CLI（transport=local-cli）。无注册表 / 无外部 generator ⇒ 走原路径。
    const extGen = eligible(registry, 'generator').find(a => a.transport !== 'subagent')
    let extWorktree = null

    if (extGen) {
      const r = await dispatchExternal(extGen, {
        batch: state.current_sprint, role: 'generator', ref: state.head_sha,
        spec: state.spec_path, features: [t.id], l2: false,
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
      stepResult = { feature_id: t.id, result: 'completed', dispatch: r, agent_id: extGen.id }
      extWorktree = r.run_meta_path                 // 耐久层据此定位 worktree 做 tag 校验 + 回流
    } else {
      stepResult = await agent(
        `实现 feature ${t.id}${t.title ? '（' + t.title + '）' : ''}。读 docs/specs 对应段与 acceptance；`
        + `只做本 feature、越界即停；本地自测通过后以 feat(${state.current_sprint}-${t.id}): 独立 commit。`
        + `禁止任何 deploy/生产/花钱动作（deny-list 已强制）。bug 修复须同 commit 补回归测试。`,
        { label: `build:${t.id}`, phase: 'Wake', agentType: 'generator-restricted',
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
  const genFamily = (eligible(registry, 'generator').find(a => a.transport === 'local-cli') || {}).model_family
  const evals = resolveEvaluators(registry, w, genFamily)   // 已排除与 generator 同 family 者
  const sampled = feats.length ? feats[w % feats.length] : null

  if (evals && evals.primary.transport !== 'subagent') {
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
      dispatch: r, agent_id: evals.primary.id, model_family: evals.primary.model_family,
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
      { label: 'verify:evaluator', phase: 'Wake', agentType: 'general-purpose',
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
