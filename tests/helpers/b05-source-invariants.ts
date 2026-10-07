import { createHash } from "node:crypto";

// LF SHA256 of the immutable 3ade5d1 recovery script and 11907f5 supplement.
// Constants carry the original evidence without requiring those Git objects.
export const RECOVERY_BASELINE_SHA256 = "2d4dfe745469ab8992a4f2b5922cbfed04f9f11b98229bffadb6badcd02eeb5c";
export const POST_CI_SUPPLEMENT_SHA256 = "0197d65339eb73ad5d1b6a9e5e2c13e2f900535a887d51832096af602f3f00e4";
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const digest = (text: string) => createHash("sha256").update(lf(text)).digest("hex");

export const RECOVERY_INVARIANTS = [
  'gate=".releases/$expected.rollback-approved"\nrm -f "$gate"',
  'dump=".releases/$expected.$prefix.backup.dump"',
  'rm -f "$temp_dump"',
  '[[ -s "$temp_dump" ]] || { echo "empty PostgreSQL backup" >&2; exit 1; }',
  'mv "$temp_dump" "$dump"',
  'sha256sum "$dump" > "$dump.sha256"',
  'docker exec -i "$db" pg_restore -U tokenizer -d tokenizer --exit-on-error --no-owner < "$dump"',
  "  canary \"$db\"\n  [[ \"$(inventory \"$db\")\" == \"$restored_inventory\" ]] || { echo \"rollback canary cleanup changed inventory\" >&2; exit 1; }\n  printf 'app_image=%s\\nprevious_sha=%s\\n' \"$previous_app\" \"$previous_sha\" > \"$gate\""
] as const;

export function matchesRecoverySource(text: string): boolean {
  const source = lf(text);
  if (!source.includes('docker exec "$1" pg_isready -h 127.0.0.1 -U tokenizer -d tokenizer')) return false;
  if (!RECOVERY_INVARIANTS.every((invariant) => source.includes(invariant))) return false;
  const normalized = source
    .replace("    # First-init uses a socket-only temporary server that will shut down.\n", "")
    .replace("    # TCP readiness accepts only the final server, before migration/restore.\n", "")
    .replace("pg_isready -h 127.0.0.1 -U", "pg_isready -U");
  return digest(normalized) === RECOVERY_BASELINE_SHA256;
}

export function matchesPostCiSupplement(text: string): boolean {
  return digest(text) === POST_CI_SUPPLEMENT_SHA256;
}

export function matchesDeploymentDocs(text: string): boolean {
  const docs = lf(text);
  return docs.includes("builds Linux app and migration OCI artifacts in CI") &&
    docs.includes("builds Linux app and migration OCI artifacts once in CI") &&
    docs.includes("It does not rebuild app images on the VPS") &&
    !docs.includes("does not yet build the deployment image in CI") &&
    !docs.includes("builds SHA-tagged images on the VPS");
}
