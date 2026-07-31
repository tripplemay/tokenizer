import {
  HARNESS_MODE_ROLES,
  type HarnessExecutionProfile,
  type HarnessModeRole
} from "@/shared/harness-mode-intent";

export const MODE_DRILLDOWN_QUERY_KEY = "focus";
export const MODE_EDITOR_ANCHOR = "mode-editor";
export const COORDINATOR_DETAILS_ANCHOR = "coordinator-details";

export type ModeDrilldownTarget = HarnessModeRole | "coordinator";

export function modeDrilldownTarget(value: string | string[] | undefined): ModeDrilldownTarget | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "coordinator") return candidate;
  return HARNESS_MODE_ROLES.includes(candidate as HarnessModeRole) ? candidate as HarnessModeRole : null;
}

export function isConfigurableModeRole(value: unknown): value is HarnessModeRole {
  return typeof value === "string" && HARNESS_MODE_ROLES.includes(value as HarnessModeRole);
}

export function modeDrilldownHref(projectId: string, target: ModeDrilldownTarget): string {
  const anchor = target === "coordinator" ? COORDINATOR_DETAILS_ANCHOR : MODE_EDITOR_ANCHOR;
  return `/harness/${encodeURIComponent(projectId)}?view=modes&${MODE_DRILLDOWN_QUERY_KEY}=${encodeURIComponent(target)}#${anchor}`;
}

export function modeEditorInitialProfile(selectedRole: HarnessModeRole | null): HarnessExecutionProfile {
  return selectedRole ? "heterogeneous" : "fast";
}

export function modeEditorFocusTarget(role: HarnessModeRole): string {
  return `mode-binding-${role}-tool`;
}

export function modeEditorFocusRegion(role: HarnessModeRole): string {
  return `mode-binding-${role}`;
}
