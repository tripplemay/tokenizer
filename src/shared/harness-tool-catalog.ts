import {
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
