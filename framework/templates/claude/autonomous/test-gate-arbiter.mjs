#!/usr/bin/env node
// Focused behavioral tests for the custom workflow source. The production
// workflow has top-level `return`, so execute it inside an AsyncFunction with
// deterministic agent()/phase() stubs instead of importing it as normal JS.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "gate-arbiter.workflow.js"), "utf8")
  .replace("export const meta =", "const meta =");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflow = new AsyncFunction("args", "agent", "phase", source);

const ref = "a".repeat(40);

function baseArgs(overrides = {}) {
  return {
    state: {
      status: "building",
      current_sprint: "BL-ROLE-ROUTING",
      fix_rounds: 0,
      features: [{ id: "F001", executor: "generator", status: "pending" }],
      head_sha: ref,
      spec_path: "docs/specs/BL-ROLE-ROUTING.md",
      role_assignments: null,
    },
    policy: {
      enabled: true,
      expires_at: "2099-01-01T00:00:00Z",
      batch_scope: "BL-ROLE-ROUTING",
      budget: { max_tokens: 1000, max_cost_usd: 100, max_wakes: 10, max_fix_rounds: 3 },
      auto_cross: ["A", "B"],
    },
    ledger: { tokens: 0, cost_usd: 0, wake_n: 1, same_feature_fail_streak: 0 },
    now: "2026-07-31T00:00:00Z",
    registry: { agents: [] },
    ...overrides,
  };
}

async function run(args, responseFor) {
  const calls = [];
  const result = await workflow(
    args,
    async (prompt, options) => {
      calls.push({ prompt, options });
      return responseFor(options, prompt);
    },
    () => {},
  );
  return { result, calls };
}

async function testConfiguredGeneratorWinsOverRegistryOrder() {
  const registry = {
    agents: [
      { id: "fallback-generator", roles: ["generator"], transport: "local-cli", model_family: "codex", constraints: { write_src: true, push: false, l2: false } },
      { id: "selected-generator", roles: ["generator"], transport: "local-cli", model_family: "kimi", constraints: { write_src: true, push: false, l2: false } },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "local-cli", model_family: "claude" },
    ],
  };
  const { result, calls } = await run(
    baseArgs({ registry, state: { ...baseArgs().state, role_assignments: {
      generator: "selected-generator", evaluator: "selected-evaluator",
    } } }),
    (options) => {
      if (options.label === "dispatch:generator:selected-generator") {
        return {
          state: "COMPLETED", artifact_path: "handoff.json", run_meta_path: "run-meta.json",
          envelope_path: "envelope.json", worktree_path: "/tmp/selected-generator", verdict_summary: { all_pass: false },
        };
      }
      if (options.label === "critic:spec-lock") return { violation: false, detail: "clean" };
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(result.decision, "ADVANCE");
  assert.equal(result.writeback.agent_id, "selected-generator");
  assert.equal(result.writeback.role, "generator");
  assert.equal(result.writeback.handoff_path, "handoff.json");
  assert.equal(result.writeback.envelope_path, "envelope.json");
  assert.equal(calls[0].options.label, "dispatch:generator:selected-generator");
  assert.match(calls[0].prompt, /dispatch-generator-handoff\.sh --task-id BL-ROLE-ROUTING-generator-w1-r0 --feature F001/);
  assert.match(calls[0].prompt, /docs\/test-reports\/generator-handoff-BL-ROLE-ROUTING-generator-w1-r0\.json/);
  assert.doesNotMatch(calls[0].prompt, /独立 commit|feat\(<batch>/);
}

async function testConfiguredEvaluatorWinsOverRegistryOrder() {
  const registry = {
    agents: [
      { id: "selected-generator", roles: ["generator"], transport: "local-cli", model_family: "codex", constraints: { write_src: true, push: false, l2: false } },
      { id: "fallback-evaluator", roles: ["evaluator"], transport: "local-cli", model_family: "kimi" },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "a2a", model_family: "claude" },
    ],
  };
  const state = {
    ...baseArgs().state,
    status: "verifying",
    features: [],
    role_assignments: { generator: "selected-generator", evaluator: "selected-evaluator" },
  };
  const { result, calls } = await run(
    baseArgs({ registry, state }),
    (options) => {
      if (options.label === "dispatch:evaluator:selected-evaluator") {
        return {
          state: "COMPLETED", artifact_path: "verdict.json", run_meta_path: "run-meta.json",
          envelope_path: "envelope.json", verdict_summary: { all_pass: false },
        };
      }
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(result.decision, "ADVANCE");
  assert.equal(result.writeback.agent_id, "selected-evaluator");
  assert.equal(calls[0].options.label, "dispatch:evaluator:selected-evaluator");
}

async function testInvalidConfiguredRoleFailsClosed() {
  const { result, calls } = await run(
    baseArgs({ state: { ...baseArgs().state, role_assignments: { generator: "missing" } } }),
    () => { throw new Error("agent must not run"); },
  );
  assert.equal(result.decision, "HALT");
  assert.deepEqual(result.reasons, ["configured_role_unresolvable:generator"]);
  assert.equal(calls.length, 0);
}

async function testConfiguredSubagentUsesItsDescriptorPersona() {
  const registry = {
    agents: [
      { id: "selected-generator", roles: ["generator"], transport: "subagent", model_family: "claude", agent_type: "generator-restricted" },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "subagent", model_family: "codex", agent_type: "evaluator" },
    ],
  };
  const { result, calls } = await run(
    baseArgs({ registry, state: { ...baseArgs().state, role_assignments: {
      generator: "selected-generator", evaluator: "selected-evaluator",
    } } }),
    (options) => {
      if (options.label === "build:F001") return { feature_id: "F001", result: "completed", files_touched: [] };
      if (options.label === "critic:spec-lock") return { violation: false, detail: "clean" };
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(result.decision, "ADVANCE");
  assert.equal(calls[0].options.agentType, "generator-restricted");
}

async function testExternalGeneratorWithoutReturnEvidenceHalts() {
  const registry = {
    agents: [
      { id: "selected-generator", roles: ["generator"], transport: "local-cli", model_family: "codex", constraints: { write_src: true, push: false, l2: false } },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "subagent", model_family: "claude", agent_type: "evaluator" },
    ],
  };
  const { result } = await run(
    baseArgs({ registry, state: { ...baseArgs().state, role_assignments: {
      generator: "selected-generator", evaluator: "selected-evaluator",
    } } }),
    (options) => {
      if (options.label === "dispatch:generator:selected-generator") {
        return {
          state: "COMPLETED", artifact_path: "handoff.json", run_meta_path: "run-meta.json",
          envelope_path: "", worktree_path: "/tmp/selected-generator",
        };
      }
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(result.decision, "HALT");
  assert.deepEqual(result.reasons, ["external_generator_missing_return_evidence"]);
}

async function testUnsafeBatchCannotReachDispatcher() {
  const registry = {
    agents: [
      { id: "selected-generator", roles: ["generator"], transport: "local-cli", model_family: "codex", constraints: { write_src: true, push: false, l2: false } },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "subagent", model_family: "claude", agent_type: "evaluator" },
    ],
  };
  const args = baseArgs({
    registry,
    state: { ...baseArgs().state, current_sprint: "../escape", role_assignments: {
      generator: "selected-generator", evaluator: "selected-evaluator",
    } },
    policy: { ...baseArgs().policy, batch_scope: "../escape" },
  });
  const calls = [];
  await assert.rejects(
    workflow(
      args,
      async (prompt, options) => {
        calls.push({ prompt, options });
        throw new Error("dispatcher must not run");
      },
      () => {},
    ),
    /unsafe dispatch batch/,
  );
  assert.equal(calls.length, 0);
}

async function testExternalGeneratorWithoutFixedSourceReturnCapabilityHalts() {
  const registry = {
    agents: [
      { id: "selected-generator", roles: ["generator"], transport: "local-cli", model_family: "codex", constraints: { write_src: true, push: true, l2: false } },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "subagent", model_family: "claude", agent_type: "evaluator" },
    ],
  };
  const { result, calls } = await run(
    baseArgs({ registry, state: { ...baseArgs().state, role_assignments: {
      generator: "selected-generator", evaluator: "selected-evaluator",
    } } }),
    () => { throw new Error("dispatcher must not run"); },
  );
  assert.equal(result.decision, "HALT");
  assert.deepEqual(result.reasons, ["external_generator_capability_invalid"]);
  assert.equal(calls.length, 0);
}

async function testV2ResolutionFiveFieldDriftFailsClosed() {
  const registry = {
    agents: [
      { id: "selected-planner", roles: ["planner"], transport: "subagent", agent_type: "planner-proposal", model_family: "claude", priority: 10 },
      { id: "selected-generator", roles: ["generator"], transport: "local-cli", tool: "codex", model_family: "codex", priority: 20, constraints: { write_src: true, push: false, l2: false } },
      { id: "selected-evaluator", roles: ["evaluator"], transport: "subagent", agent_type: "evaluator", model_family: "kimi", priority: 30 },
    ],
  };
  const resolution = {
    planner: { agent_id: "selected-planner", tool: "claude-code", invocation: "subagent", model_family: "claude", priority: 10 },
    generator: { agent_id: "selected-generator", tool: "codex", invocation: "local-cli", model_family: "codex", priority: 20 },
    evaluator: { agent_id: "selected-evaluator", tool: "claude-code", invocation: "subagent", model_family: "kimi", priority: 30 },
  };
  const valid = await run(
    baseArgs({
      registry,
      resolved_mode_bindings: resolution,
      state: {
        ...baseArgs().state,
        role_assignments: {
          planner: "selected-planner", generator: "selected-generator", evaluator: "selected-evaluator",
        },
        mode_intent: { resolution },
      },
    }),
    (options) => {
      if (options.label === "dispatch:generator:selected-generator") {
        return { state: "COMPLETED", artifact_path: "handoff.json", run_meta_path: "run-meta.json", envelope_path: "envelope.json", worktree_path: "/tmp/selected-generator" };
      }
      if (options.label === "critic:spec-lock") return { violation: false, detail: "clean" };
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(valid.result.decision, "ADVANCE");
  for (const [field, changed] of Object.entries({
    agent_id: "other-generator",
    tool: "other-cli",
    invocation: "a2a",
    model_family: "other-family",
    priority: 21,
  })) {
    const mutated = structuredClone(resolution);
    mutated.generator[field] = changed;
    const { result, calls } = await run(
      baseArgs({
        registry,
        resolved_mode_bindings: resolution,
        state: {
          ...baseArgs().state,
          role_assignments: {
            planner: "selected-planner", generator: "selected-generator", evaluator: "selected-evaluator",
          },
          mode_intent: { resolution: mutated },
        },
      }),
      () => { throw new Error("dispatcher must not run after resolution drift"); },
    );
    assert.equal(result.decision, "HALT", field);
    assert.deepEqual(result.reasons, ["configured_role_resolution_drift:generator"], field);
    assert.equal(calls.length, 0, field);
  }
}

async function testCanonicalRegistryKeepsCoordinatorAndLongA2ATarget() {
  const targetId = "r".repeat(64);
  const evaluatorId = `a2a--${targetId}--evaluator`;
  const registry = {
    version: "tool-integrations/1",
    integrations: [
      {
        id: "codex",
        tool: "codex",
        model_family: "\u0085codex\u0085",
        local_cli: { adapter: "codex", sandbox: { home_dir: "/tmp/codex" } },
      },
      {
        id: "claude",
        tool: "claude-code",
        model_family: " claude ",
        local_cli: { adapter: "claude-code", sandbox: { home_dir: "/tmp/claude" } },
      },
    ],
    a2a_targets: [{
      id: targetId,
      integration_id: "claude",
      remote_runner_id: "claude-runner",
      endpoint: "http://127.0.0.1:41243",
    }],
  };
  const resolution = {
    planner: null,
    generator: { agent_id: "local-cli--codex--generator", tool: "codex", invocation: "local-cli", model_family: "codex", priority: 1000 },
    evaluator: { agent_id: evaluatorId, tool: "claude-code", invocation: "a2a", model_family: "claude", priority: 1000 },
  };
  const { result, calls } = await run(
    baseArgs({
      registry,
      resolved_mode_bindings: resolution,
      state: {
        ...baseArgs().state,
        status: "verifying",
        features: [],
        role_assignments: {
          planner: null,
          generator: "local-cli--codex--generator",
          evaluator: evaluatorId,
        },
        mode_intent: { resolution },
      },
    }),
    (options) => {
      if (options.label === `dispatch:evaluator:${evaluatorId}`) {
        return {
          state: "COMPLETED", artifact_path: "verdict.json", run_meta_path: "run-meta.json",
          envelope_path: "envelope.json", verdict_summary: { all_pass: false },
        };
      }
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(evaluatorId.length > 64, true);
  assert.equal(result.decision, "ADVANCE");
  assert.equal(result.writeback.agent_id, evaluatorId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.label, `dispatch:evaluator:${evaluatorId}`);
}

async function testCanonicalRegistryUsesPythonModelFamilyStripRules() {
  const preservedFamily = "\ufeffclaude\ufeff";
  const registry = {
    version: "tool-integrations/1",
    integrations: [
      {
        id: "preserved",
        tool: "claude-code",
        model_family: preservedFamily,
        subagent: true,
      },
      {
        id: "codex",
        tool: "codex",
        model_family: "codex",
        local_cli: { adapter: "codex", sandbox: { home_dir: "/tmp/codex" } },
      },
    ],
    a2a_targets: [],
  };
  const resolution = {
    planner: null,
    generator: { agent_id: "subagent--preserved--generator", tool: "claude-code", invocation: "subagent", model_family: preservedFamily, priority: 1000 },
    evaluator: { agent_id: "local-cli--codex--evaluator", tool: "codex", invocation: "local-cli", model_family: "codex", priority: 1000 },
  };
  const { result, calls } = await run(
    baseArgs({
      registry,
      resolved_mode_bindings: resolution,
      state: {
        ...baseArgs().state,
        role_assignments: {
          planner: null,
          generator: "subagent--preserved--generator",
          evaluator: "local-cli--codex--evaluator",
        },
        mode_intent: { resolution },
      },
    }),
    (options) => {
      if (options.label === "build:F001") {
        return { feature_id: "F001", result: "completed", files_touched: [] };
      }
      if (options.label === "critic:spec-lock") return { violation: false, detail: "clean" };
      throw new Error(`unexpected agent call ${options.label}`);
    },
  );
  assert.equal(result.decision, "ADVANCE");
  assert.equal(calls[0].options.agentType, "generator-restricted");
}

await testConfiguredGeneratorWinsOverRegistryOrder();
await testConfiguredEvaluatorWinsOverRegistryOrder();
await testInvalidConfiguredRoleFailsClosed();
await testConfiguredSubagentUsesItsDescriptorPersona();
await testExternalGeneratorWithoutReturnEvidenceHalts();
await testUnsafeBatchCannotReachDispatcher();
await testExternalGeneratorWithoutFixedSourceReturnCapabilityHalts();
await testV2ResolutionFiveFieldDriftFailsClosed();
await testCanonicalRegistryKeepsCoordinatorAndLongA2ATarget();
await testCanonicalRegistryUsesPythonModelFamilyStripRules();
console.log("[gate-arbiter] 10/10 role-routing and dispatch-id checks passed");
