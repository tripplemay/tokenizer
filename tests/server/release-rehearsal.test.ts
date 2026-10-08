import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
const sha = "c".repeat(40);
const old = "d".repeat(40);
const ref = `ghcr.io/test/app@sha256:${"a".repeat(64)}`;
const oldRef = `ghcr.io/test/prev-app@sha256:${"b".repeat(64)}`;
function run(overrides: Record<string, string> = {}) {
  return spawnSync("bash", ["scripts/test/rehearse-release.sh"], {
    cwd: dir, encoding: "utf8", env: {
      ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      EXPECTED_SHA: sha, APP_IMAGE: ref, MIGRATE_IMAGE: ref,
      PREVIOUS_SHA: old, PREVIOUS_APP_IMAGE: oldRef, PREVIOUS_MIGRATE_IMAGE: oldRef,
      CALLS: join(dir, "calls"), MOCK_FAIL: "", MOCK_DB_INIT: "", ...overrides
    }
  });
}
describe.skipIf(process.platform === "win32")("isolated release recovery rehearsal faults", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "release-rehearsal-"));
    mkdirSync(join(dir, "bin"));
    symlinkSync(join(process.cwd(), "scripts"), join(dir, "scripts"), "dir");
    writeFileSync(join(dir, "bin", "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1 $2" == 'image inspect' ]]; then
  revision='${sha}'
  if [[ "$*" == *prev-app* ]]; then revision='${old}'; fi
  printf 'sha256:${"a".repeat(64)}|%s\\n' "$revision"
elif [[ "$*" == *'--entrypoint id'* ]]; then
  if [[ "$MOCK_FAIL" == uid ]]; then echo 0; else echo 1000; fi
elif [[ "$*" == *pg_isready* && "$MOCK_DB_INIT" == 1 ]]; then
  state="$CALLS.$2"
  # The official image first accepts socket connections, shuts that server
  # down, then starts the final TCP server. Socket success is not final ready.
  if [[ "$*" != *'pg_isready -h 127.0.0.1 '* ]]; then exit 0; fi
  if [[ "$MOCK_FAIL" == source-tcp-never || ( "$MOCK_FAIL" == restore-tcp-never && "$2" != *source ) ]]; then exit 1; fi
  if [[ ! -f "$state.initializing" ]]; then touch "$state.initializing"; exit 1; fi
  touch "$state.final"
elif [[ "$*" == *pg_dump* ]]; then echo synthetic-dump
elif [[ "$*" == *pg_restore* ]]; then
  if [[ "$MOCK_FAIL" == restore ]]; then exit 6; fi
  container="$2"
  if [[ "$container" == -i ]]; then container="$3"; fi
  if [[ "$MOCK_DB_INIT" == 1 && ! -f "$CALLS.$container.final" ]]; then echo 'FATAL: the database system is shutting down' >&2; exit 6; fi
elif [[ "$*" == *psql* ]]; then
  if [[ "$MOCK_FAIL" == inventory && "$2" != *source ]]; then echo '0|0|0|0|0'; else echo '1|1|1|1|23'; fi
elif [[ "$*" == *'prisma migrate deploy'* && "$*" != *prev-app* && "$MOCK_FAIL" == migrate ]]; then exit 7
elif [[ "$*" == *release-canary.ts* && "$MOCK_FAIL" == canary ]]; then exit 8
fi
`);
    writeFileSync(join(dir, "bin", "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    writeFileSync(join(dir, "bin", "sha256sum"), "#!/usr/bin/env bash\nif [[ $1 != -c ]]; then printf 'synthetic-checksum  %s\\n' \"$1\"; fi\n");
    for (const name of ["docker", "sleep", "sha256sum"]) chmodSync(join(dir, "bin", name), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("backs up, restores, applies exact migration, and rehearses old-image canary before approving rollback", () => {
    expect(run().status).toBe(0);
    const calls = readFileSync(join(dir, "calls"), "utf8");
    expect(calls).toContain("network create --internal");
    expect(calls.indexOf("pg_dump")).toBeLessThan(calls.indexOf("pg_restore"));
    expect(calls).toContain("--exit-on-error --no-owner");
    expect(calls.match(/release-canary.ts/g)).toHaveLength(3);
    expect(calls).toContain("rm -fv");
    expect(readdirSync(join(dir, ".releases")).some((name) => name.endsWith(".backup.dump.sha256"))).toBe(true);
    expect(readFileSync(join(dir, ".releases", `${sha}.rollback-approved`), "utf8")).toContain(oldRef);
    expect(readFileSync(join(dir, ".releases", `${sha}.rehearsal`), "utf8")).toContain("runtime_uid=1000");
  });

  it.each(["restore", "inventory", "migrate", "uid", "canary"])("does not approve rollback after %s fault and cleans scratch volumes", (failure) => {
    expect(run({ MOCK_FAIL: failure }).status).not.toBe(0);
    expect(existsSync(join(dir, ".releases", `${sha}.rollback-approved`))).toBe(false);
    expect(readFileSync(join(dir, "calls"), "utf8")).toContain("rm -fv");
    expect(readFileSync(join(dir, "calls"), "utf8")).toContain("network rm");
  });

  it("waits for the final TCP server instead of accepting the temporary initialization socket", () => {
    const result = run({ MOCK_DB_INIT: "1" });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(join(dir, "calls"), "utf8");
    const probes = calls.split(/\r?\n/).filter((line) => line.includes("pg_isready"));
    // Both the synthetic source and restore target reject their first TCP
    // probe during initialization, then accept only the final server.
    expect(probes).toHaveLength(4);
    expect(probes.every((line) => line.includes("pg_isready -h 127.0.0.1 -U tokenizer -d tokenizer"))).toBe(true);
    expect(calls).toContain("pg_restore");
    expect(existsSync(join(dir, ".releases", `${sha}.rollback-approved`))).toBe(true);
  });

  it.each(["source-tcp-never", "restore-tcp-never"])("fails closed when only the temporary socket accepts (%s)", (failure) => {
    mkdirSync(join(dir, ".releases"));
    const gate = join(dir, ".releases", `${sha}.rollback-approved`);
    writeFileSync(gate, "stale-approval-must-not-survive");
    const result = run({ MOCK_DB_INIT: "1", MOCK_FAIL: failure });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("scratch PostgreSQL did not start");
    expect(existsSync(gate)).toBe(false);
    const calls = readFileSync(join(dir, "calls"), "utf8");
    expect(calls).not.toContain("pg_restore");
    expect(calls).toContain("rm -fv");
    expect(calls).toContain("network rm");
    if (failure === "restore-tcp-never") expect(calls).toContain("pg_dump");
  });

  it("never touches the production DB in synthetic mode", () => {
    expect(run().status).toBe(0);
    expect(readFileSync(join(dir, "calls"), "utf8")).not.toContain("compose");
  });

  it("never overwrites an earlier same-SHA backup on a retry", () => {
    expect(run().status).toBe(0);
    const first = readdirSync(join(dir, ".releases")).find((name) => name.endsWith(".backup.dump"))!;
    writeFileSync(join(dir, ".releases", first), "first-backup-preserved");
    expect(run().status).toBe(0);
    expect(readdirSync(join(dir, ".releases")).filter((name) => name.endsWith(".backup.dump"))).toHaveLength(2);
    expect(readFileSync(join(dir, ".releases", first), "utf8")).toBe("first-backup-preserved");
  });

  it("requires Linux artifact/recovery job before production deployment", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    expect(workflow).toContain("needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser, release-artifact]");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("@${{ steps.app.outputs.digest }}");
    expect(workflow).toContain("bash scripts/test/rehearse-release.sh");
  });
});
