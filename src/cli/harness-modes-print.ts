import type { HarnessRepo } from "./harness";
import { buildModeSnapshot, type ModeSnapshot } from "./harness-modes";

const EXECUTION_LABELS: Record<ModeSnapshot["execution"], string> = {
  fast: "快车道",
  heterogeneous: "异构执行",
  slow: "跨机器",
  unknown: "形态未知"
};

function frameworkFields(snapshot: ModeSnapshot): string[] {
  const framework = snapshot.framework;
  if (!framework) return ["无框架账本", "漂移 0", "定制 0"];

  const version = !framework.version
    ? "版本未知"
    : framework.version === "unknown"
      ? "版本未知"
      : `v${framework.version}`;
  const drift = framework.drift.modified + framework.drift.missing;
  return [version, `漂移 ${drift}`, `定制 ${framework.drift.customized}`];
}

function autonomyLabel(snapshot: ModeSnapshot): string {
  if (!snapshot.autonomy.enabled) return "手动";
  if (snapshot.autonomy.policyValid === false) return "自主(策略失效)";
  return snapshot.autonomy.status ? `自主:${snapshot.autonomy.status}` : "自主";
}

export function formatHarnessModeLine(repo: HarnessRepo): string {
  const snapshot = buildModeSnapshot(repo.path);
  const machineryTotal = snapshot.machinery.hooks.length + snapshot.machinery.missing.length;
  const fields = [
    repo.name,
    ...frameworkFields(snapshot),
    EXECUTION_LABELS[snapshot.execution],
    autonomyLabel(snapshot),
    snapshot.dispatch.enabled ? "dispatch 开" : "dispatch 关",
    snapshot.gate.guardMode === "signature" ? "闸门验签" : "闸门比对 HEAD",
    `机件 ${snapshot.machinery.hooks.length}/${machineryTotal}`
  ];
  return `${fields.join(" · ")}  ${repo.path}`;
}
