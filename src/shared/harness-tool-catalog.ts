import {
  HARNESS_MODE_ROLES,
  type HarnessModeRole,
  type HarnessModeToolDescriptor,
  type HarnessTransport
} from "@/shared/harness-mode-intent";

/** Stable public protocol shared with the framework's tool-catalog resolver. */
export const HARNESS_TOOL_CATALOG_VERSION = "tool-catalog/1";

/**
 * Public catalog entry emitted by the device. It deliberately contains no
 * concrete agent id: the dispatch resolver chooses an eligible descriptor at
 * the next planning boundary.
 */
export type HarnessToolCatalogEntry = {
  tool: string;
  label: string;
  invocation: HarnessTransport;
  role: HarnessModeRole;
  agentCount: number;
  modelFamilies: string[];
  capabilities: string[];
};

/**
 * Public, non-secret observation of an external same-session bridge. The
 * runtime owns the concrete child session identifiers. Device-reported fields
 * are useful for diagnostics, but are not an attestation or authorization
 * source for a console-issued mode intent.
 */
export type HarnessSubagentBridge = {
  id: string;
  kind: string;
  sessionScope: "same-session";
  /** Roles whose framework-owned persona is declared by this bridge. */
  roles: HarnessModeRole[];
};

/**
 * A configured CLI integration as surfaced by the device. Concrete A2A
 * target and runner identifiers deliberately stay out of this public shape.
 */
export type HarnessToolIntegration = {
  id: string;
  tool: string;
  label: string;
  modelFamily: string;
  roles: HarnessModeRole[];
  invocations: HarnessTransport[];
  capabilities: string[];
  localCli: boolean;
  subagent: boolean;
  bridgeId: string | null;
  bridgeKind: string | null;
  sessionScope: "same-session" | null;
  /**
   * Observed bridge metadata. It can describe a local runtime report but must
   * never, by itself, make an external `subagent` route selectable or
   * signable. A future strict provider needs an independent trust root.
   */
  bridgeProtocol?: "acp-native-agent/v1" | null;
  bridgeCommand?: string[] | null;
  adapterBridgeCommand?: string[] | null;
  bridgeRoles?: HarnessModeRole[] | null;
  a2aTargetCount: number;
  sandboxed: boolean;
};

const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_CAPABILITY = /^[A-Za-z0-9._-]{1,64}$/;
const ACP_NATIVE_AGENT_PROTOCOL = "acp-native-agent/v1";

function stringArray(
  value: readonly string[] | null | undefined,
  predicate: (item: string) => boolean,
  minimum = 1
): value is readonly string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= 64 &&
    value.every((item) => typeof item === "string" && predicate(item));
}

function sameStringSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Validate the bounded shape of a bridge report for observability. This is
 * intentionally not named "verified": every value is supplied by the device
 * report and the control plane has no independent provider attestation in this
 * release.
 */
export function hasWellFormedExternalSubagentBridgeObservation(
  integration: Readonly<HarnessToolIntegration>
): boolean {
  if (
    integration.subagent !== true ||
    integration.localCli !== true ||
    integration.sandboxed !== true ||
    !integration.invocations.includes("local-cli") ||
    !integration.invocations.includes("subagent") ||
    !TOOL_ID.test(integration.id) ||
    !TOOL_ID.test(integration.tool) ||
    !integration.bridgeId ||
    !TOOL_ID.test(integration.bridgeId) ||
    !integration.bridgeKind ||
    !SAFE_CAPABILITY.test(integration.bridgeKind) ||
    integration.sessionScope !== "same-session" ||
    integration.bridgeProtocol !== ACP_NATIVE_AGENT_PROTOCOL ||
    !stringArray(integration.bridgeCommand, (item) => SAFE_CAPABILITY.test(item)) ||
    !stringArray(integration.adapterBridgeCommand, (item) => SAFE_CAPABILITY.test(item)) ||
    integration.bridgeCommand.length < 2 ||
    integration.bridgeCommand[1] !== "acp" ||
    !sameStringSequence(integration.bridgeCommand, integration.adapterBridgeCommand) ||
    !stringArray(integration.bridgeRoles, (role) => HARNESS_MODE_ROLES.includes(role as HarnessModeRole)) ||
    new Set(integration.bridgeRoles).size !== integration.bridgeRoles.length ||
    !integration.bridgeRoles.every((role) => integration.roles.includes(role as HarnessModeRole))
  ) return false;

  return true;
}

/**
 * The current release has no VM/ephemeral-principal external bridge provider.
 * Every `subagent` catalog entry is therefore an observation of a historical
 * Coordinator-native or external route, never a v2 mode-intent choice. Keep
 * this filter shared by the signing and detail paths so a report cannot regain
 * authority by changing only presentation data.
 */
export function isV2SelectableToolCatalogEntry(entry: Readonly<HarnessToolCatalogEntry>): boolean {
  return entry.invocation !== "subagent";
}

export function v2SelectableToolCatalogEntries(
  entries: readonly HarnessToolCatalogEntry[]
): HarnessToolCatalogEntry[] {
  return entries.filter(isV2SelectableToolCatalogEntry);
}

/**
 * A tool can legitimately expose different labels per invocation (for example
 * a local CLI and a remote A2A endpoint). Always resolve the exact pair so a
 * selection never inherits another transport's display name.
 */
export function toolCatalogLabelForInvocation(
  entries: readonly Pick<HarnessToolCatalogEntry, "tool" | "invocation" | "label">[],
  tool: string,
  invocation: HarnessTransport
): string | null {
  return entries.find((entry) => entry.tool === tool && entry.invocation === invocation)?.label ?? null;
}

/**
 * Expand the public candidate pools into the model-family facts needed for
 * signed-intent validation. The expanded values never cross the signing
 * boundary; only tool + invocation are signed.
 */
export function toolCatalogModeDescriptors(
  entries: readonly HarnessToolCatalogEntry[]
): HarnessModeToolDescriptor[] {
  const descriptors = new Map<string, HarnessModeToolDescriptor>();
  for (const entry of entries) {
    for (const model_family of entry.modelFamilies) {
      const descriptor: HarnessModeToolDescriptor = {
        tool: entry.tool,
        invocation: entry.invocation,
        role: entry.role,
        model_family
      };
      descriptors.set(
        `${descriptor.role}\u0000${descriptor.tool}\u0000${descriptor.invocation}\u0000${descriptor.model_family}`,
        descriptor
      );
    }
  }
  return [...descriptors.values()].sort((left, right) =>
    `${left.role}\u0000${left.tool}\u0000${left.invocation}\u0000${left.model_family}`.localeCompare(
      `${right.role}\u0000${right.tool}\u0000${right.invocation}\u0000${right.model_family}`
    )
  );
}
