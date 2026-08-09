import type { Prisma } from "@prisma/client";

export function ownedHarnessProjectDetailQuery(id: string, userId: string) {
  return {
    where: { id, userId },
    select: {
      id: true,
      name: true,
      repoKey: true,
      status: true,
      batch: true,
      fixRounds: true,
      completedCount: true,
      totalCount: true,
      headSha: true,
      signoff: true,
      dashboardUrl: true,
      autonomyStatus: true,
      lastHaltCondition: true,
      lastHaltDetail: true,
      features: true,
      modes: true,
      reportedAt: true,
      createdAt: true,
      updatedAt: true,
      device: {
        select: {
          id: true,
          name: true,
          hostname: true,
          platform: true,
          lastSeenAt: true,
          agentVersion: true,
          agentFeatureVersion: true
        }
      },
      project: { select: { id: true, name: true, repoKey: true } },
      gates: {
        where: { userId },
        orderBy: { raisedAt: "desc" as const },
        take: 50,
        select: {
          id: true,
          gateId: true,
          kind: true,
          batch: true,
          fromStatus: true,
          toStatus: true,
          detail: true,
          evidence: true,
          raisedAt: true,
          raisedBy: true,
          decisionAction: true,
          decisionBy: true,
          decisionAt: true,
          decisionNote: true,
          relayedAt: true,
          consumedAt: true
        }
      },
      modeIntents: {
        where: { userId },
        orderBy: { issuedAt: "desc" as const },
        take: 50,
        select: {
          id: true,
          intentId: true,
          status: true,
          issuedBy: true,
          issuedAt: true,
          intentExpiresAt: true,
          relayedAt: true,
          stagedAt: true,
          appliedAt: true,
          failedAt: true,
          appliedBatch: true,
          stagedCommitSha: true,
          failureCode: true,
          failureDetail: true
        }
      },
      transitions: {
        where: { userId },
        orderBy: { observedAt: "desc" as const },
        take: 100,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          fromBatch: true,
          toBatch: true,
          batchBoundary: true,
          fixRounds: true,
          headSha: true,
          observedAfter: true,
          observedAt: true
        }
      },
      dispatchRuns: {
        where: { userId },
        orderBy: { startedAt: "desc" as const },
        take: 50,
        select: {
          id: true,
          runId: true,
          taskId: true,
          batch: true,
          feature: true,
          role: true,
          agentId: true,
          modelFamily: true,
          transport: true,
          lockedSha: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          outcome: true,
          exitCode: true,
          verdict: true,
          errorSummary: true,
          artifactPath: true,
          artifactSha256: true,
          usageInputTokens: true,
          usageOutputTokens: true,
          usageCapture: true
        }
      }
    }
  } satisfies Prisma.HarnessProjectFindFirstArgs;
}

export type OwnedHarnessProjectDetail = Prisma.HarnessProjectGetPayload<
  ReturnType<typeof ownedHarnessProjectDetailQuery>
>;
