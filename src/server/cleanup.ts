export type ClaudeLegacyRow = {
  id: string;
  deviceId: string;
  sessionId: string | null;
  totalTokens: number;
  sourceEventId: string;
};

export type ClaudeLegacyCleanupPlan = {
  toUpdate: Array<{ id: string; newSourceEventId: string }>;
  toDelete: string[];
  groupsCount: number;
  rowsConsidered: number;
  rowsSkippedNoSession: number;
  tokensBefore: number;
  tokensAfterCleanup: number;
};

export function selectClaudeLegacyCleanup(
  oldRows: ClaudeLegacyRow[],
  existingStableKeys: Set<string>
): ClaudeLegacyCleanupPlan {
  const groups = new Map<string, ClaudeLegacyRow[]>();
  let rowsSkippedNoSession = 0;
  let tokensBefore = 0;

  for (const row of oldRows) {
    tokensBefore += row.totalTokens;
    if (!row.sessionId) {
      rowsSkippedNoSession += 1;
      continue;
    }
    const key = `${row.deviceId}:${row.sessionId}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const toUpdate: { id: string; newSourceEventId: string }[] = [];
  const toDelete: string[] = [];
  let tokensAfterCleanup = 0;

  for (const [key, group] of groups) {
    if (existingStableKeys.has(key)) {
      toDelete.push(...group.map((r) => r.id));
      continue;
    }
    const sorted = [...group].sort((a, b) => b.totalTokens - a.totalTokens);
    const [keep, ...rest] = sorted;
    toUpdate.push({ id: keep.id, newSourceEventId: `claude-legacy:${keep.sessionId}` });
    toDelete.push(...rest.map((r) => r.id));
    tokensAfterCleanup += keep.totalTokens;
  }

  return {
    toUpdate,
    toDelete,
    groupsCount: groups.size,
    rowsConsidered: oldRows.length,
    rowsSkippedNoSession,
    tokensBefore,
    tokensAfterCleanup
  };
}
