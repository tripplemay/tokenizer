export type EnrollmentStatus = {
  usedAt: string | null;
  usedById: string | null;
  deviceName: string | null;
  expiresAt: string;
};

export function isEnrollmentClaimed(status: Pick<EnrollmentStatus, "usedById">): boolean {
  return typeof status.usedById === "string" && status.usedById.length > 0;
}

const INITIAL_POLL_DELAY_MS = 1_000;
const MAX_POLL_DELAY_MS = 10_000;

export function enrollmentPollDelayMs(attempt: number): number {
  return Math.min(MAX_POLL_DELAY_MS, INITIAL_POLL_DELAY_MS * 2 ** Math.max(0, attempt));
}
