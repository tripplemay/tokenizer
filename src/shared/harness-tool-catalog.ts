import {
  HARNESS_MODE_ROLES,
  type HarnessModeRole,
  type HarnessModeToolDescriptor,
  type HarnessTransport
} from "@/shared/harness-mode-intent";

/** Stable public protocol shared with the framework's tool-catalog resolver. */
export const HARNESS_TOOL_CATALOG_VERSION = "tool-catalog/1";

/**
 * The only external same-session provider admitted by the framework. The
 * proof is deliberately carried on a catalog entry rather than inferred from
 * an integration report: bridge metadata remains an observation, while this
 * value is emitted by the framework-owned provider command.
 */
export const HARNESS_VM_BRIDGE_PROVIDER_ID = "harness-vm-v1";
export const HARNESS_VM_BRIDGE_PROVIDER_KIND = "vm-v1";
export const HARNESS_VM_BRIDGE_PROVIDER_ATTESTATION_VERSION =
  "harness/external-bridge-provider-attestation/1";

const SHA256_LOWERCASE = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const VM_BRIDGE_PROVIDER_MAX_TTL_MS = 5 * 60 * 1_000;
const VM_BRIDGE_PROVIDER_MAX_FUTURE_ISSUED_MS = 30 * 1_000;

export type HarnessVmBridgeProviderAttestation = {
  version: typeof HARNESS_VM_BRIDGE_PROVIDER_ATTESTATION_VERSION;
  providerId: typeof HARNESS_VM_BRIDGE_PROVIDER_ID;
  providerKind: typeof HARNESS_VM_BRIDGE_PROVIDER_KIND;
  contractSha256: string;
  phase: "catalog";
  nonceSha256: string;
  issuedAt: string;
  expiresAt: string;
  imageSha256: string;
  runnerSha256: string;
  cliBundleSha256: string;
  brokerPolicySha256: string;
};

/** A framework-owned VM provider proof carried by an external subagent route. */
export type HarnessVmBridgeProviderProof = {
  id: typeof HARNESS_VM_BRIDGE_PROVIDER_ID;
  kind: typeof HARNESS_VM_BRIDGE_PROVIDER_KIND;
  contractSha256: string;
  attestation: HarnessVmBridgeProviderAttestation;
};

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
  /** Present only for a live, framework-attested external `subagent` route. */
  subagentProvider?: HarnessVmBridgeProviderProof;
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
  /** Diagnostic mirror of the catalog proof. It never authorizes selection. */
  subagentProvider?: HarnessVmBridgeProviderProof | null;
  a2aTargetCount: number;
  sandboxed: boolean;
};

const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_CAPABILITY = /^[A-Za-z0-9._-]{1,64}$/;
const ACP_NATIVE_AGENT_PROTOCOL = "acp-native-agent/v1";

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return Object.keys(result).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(result, key))
    ? result
    : null;
}

function utcTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number(`${match[7] ?? ""}000`.slice(0, 3));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC treats years 0-99 specially, so construct with a Date setter.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) return null;
  return date.getTime();
}

/**
 * Checks the immutable, transportable shape of a provider proof. It does not
 * require it to be live so persisted historical observations remain readable.
 */
export function hasWellFormedVmBridgeProviderProof(
  value: unknown
): value is HarnessVmBridgeProviderProof {
  const proof = exactRecord(value, ["id", "kind", "contractSha256", "attestation"]);
  if (
    !proof ||
    proof.id !== HARNESS_VM_BRIDGE_PROVIDER_ID ||
    proof.kind !== HARNESS_VM_BRIDGE_PROVIDER_KIND ||
    typeof proof.contractSha256 !== "string" ||
    !SHA256_LOWERCASE.test(proof.contractSha256)
  ) return false;

  const attestation = exactRecord(proof.attestation, [
    "version",
    "providerId",
    "providerKind",
    "contractSha256",
    "phase",
    "nonceSha256",
    "issuedAt",
    "expiresAt",
    "imageSha256",
    "runnerSha256",
    "cliBundleSha256",
    "brokerPolicySha256"
  ]);
  if (
    !attestation ||
    attestation.version !== HARNESS_VM_BRIDGE_PROVIDER_ATTESTATION_VERSION ||
    attestation.providerId !== proof.id ||
    attestation.providerKind !== proof.kind ||
    attestation.contractSha256 !== proof.contractSha256 ||
    attestation.phase !== "catalog" ||
    ![
      attestation.contractSha256,
      attestation.nonceSha256,
      attestation.imageSha256,
      attestation.runnerSha256,
      attestation.cliBundleSha256,
      attestation.brokerPolicySha256
    ].every((digest) => typeof digest === "string" && SHA256_LOWERCASE.test(digest))
  ) return false;

  const issuedAtMs = utcTimestampMs(attestation.issuedAt);
  const expiresAtMs = utcTimestampMs(attestation.expiresAt);
  return issuedAtMs !== null && expiresAtMs !== null &&
    expiresAtMs > issuedAtMs &&
    expiresAtMs - issuedAtMs <= VM_BRIDGE_PROVIDER_MAX_TTL_MS;
}

/**
 * A proof is selectable only during the narrow validity window emitted by the
 * provider. The small future allowance accounts for clock skew, never for a
 * pre-issued reusable credential.
 */
export function hasLiveVmBridgeProviderProof(
  value: unknown,
  now: Date | number = Date.now()
): value is HarnessVmBridgeProviderProof {
  if (!hasWellFormedVmBridgeProviderProof(value)) return false;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowMs)) return false;
  const issuedAtMs = utcTimestampMs(value.attestation.issuedAt);
  const expiresAtMs = utcTimestampMs(value.attestation.expiresAt);
  return issuedAtMs !== null && expiresAtMs !== null &&
    issuedAtMs <= nowMs + VM_BRIDGE_PROVIDER_MAX_FUTURE_ISSUED_MS &&
    expiresAtMs > nowMs;
}

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
 * Coordinator-native and unproved external `subagent` entries remain
 * observations, never v2 mode-intent choices. A route becomes selectable only
 * when its catalog carries a current proof from the strict framework VM
 * provider. Keep this filter shared by signing and detail paths so an
 * integration report cannot regain authority by changing presentation data.
 */
export function isV2SelectableToolCatalogEntry(
  entry: Readonly<HarnessToolCatalogEntry>,
  now: Date | number = Date.now()
): boolean {
  return entry.invocation !== "subagent" || hasLiveVmBridgeProviderProof(entry.subagentProvider, now);
}

export function v2SelectableToolCatalogEntries(
  entries: readonly HarnessToolCatalogEntry[],
  now: Date | number = Date.now()
): HarnessToolCatalogEntry[] {
  return entries.filter((entry) => isV2SelectableToolCatalogEntry(entry, now));
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
