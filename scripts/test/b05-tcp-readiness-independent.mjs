#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? ".");
const revision = process.argv[3];
const expectation = process.argv[4];
if (!isAbsolute(repo) || !/^[0-9a-f]{7,40}$/.test(revision ?? "") || !["baseline", "candidate"].includes(expectation)) {
  throw new Error("usage: b05-tcp-readiness-independent.mjs <absolute-repo> <revision> <baseline|candidate>");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const script = execFileSync("git", ["-C", repo, "show", `${revision}:scripts/test/rehearse-release.sh`], { encoding: "utf8" });
const root = mkdtempSync(join(tmpdir(), "tokenizer-b05-tcp-independent-"));

function runScenario(failure = "") {
  const dir = mkdtempSync(join(root, "case-"));
  mkdirSync(join(dir, "scripts", "test"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, ".releases"));
  writeFileSync(join(dir, "scripts", "test", "rehearse-release.sh"), script);
  writeFileSync(join(dir, "scripts", "verify-release-image.sh"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(dir, "bin", "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(dir, "bin", "sha256sum"), "#!/usr/bin/env bash\nif [[ $1 != -c ]]; then printf 'synthetic-checksum  %s\\n' \"$1\"; fi\n");
  writeFileSync(join(dir, "bin", "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$*" == *pg_isready* ]]; then
  container="$2"
  if [[ "$*" != *'pg_isready -h 127.0.0.1 '* ]]; then exit 0; fi
  if [[ "$MOCK_FAIL" == source-tcp-never && "$container" == *source ]] ||
     [[ "$MOCK_FAIL" == restore-tcp-never && "$container" != *source ]]; then exit 1; fi
  if [[ ! -f "$CALLS.$container.initializing" ]]; then touch "$CALLS.$container.initializing"; exit 1; fi
  touch "$CALLS.$container.final"
elif [[ "$*" == *pg_dump* ]]; then
  echo synthetic-dump
elif [[ "$*" == *pg_restore* ]]; then
  container="$2"
  if [[ "$container" == -i ]]; then container="$3"; fi
  if [[ ! -f "$CALLS.$container.final" ]]; then
    echo 'FATAL: the database system is shutting down' >&2
    exit 6
  fi
elif [[ "$*" == *psql* ]]; then
  echo '1|1|1|1|23'
elif [[ "$*" == *'--entrypoint id'* ]]; then
  echo 1000
fi
`);
  for (const file of [
    join(dir, "scripts", "test", "rehearse-release.sh"),
    join(dir, "scripts", "verify-release-image.sh"),
    join(dir, "bin", "sleep"),
    join(dir, "bin", "sha256sum"),
    join(dir, "bin", "docker")
  ]) chmodSync(file, 0o755);

  const sha = "c".repeat(40);
  const oldSha = "d".repeat(40);
  const image = `ghcr.io/test/app@sha256:${"a".repeat(64)}`;
  const oldImage = `ghcr.io/test/old@sha256:${"b".repeat(64)}`;
  const gate = join(dir, ".releases", `${sha}.rollback-approved`);
  writeFileSync(gate, "stale-gate");
  const callsPath = join(dir, "calls");
  const result = spawnSync("bash", ["scripts/test/rehearse-release.sh"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      EXPECTED_SHA: sha,
      APP_IMAGE: image,
      MIGRATE_IMAGE: image,
      PREVIOUS_SHA: oldSha,
      PREVIOUS_APP_IMAGE: oldImage,
      PREVIOUS_MIGRATE_IMAGE: oldImage,
      CALLS: callsPath,
      MOCK_FAIL: failure
    }
  });
  const calls = existsSync(callsPath) ? readFileSync(callsPath, "utf8") : "";
  const releaseFiles = readdirSync(join(dir, ".releases"));
  return {
    failure: failure || "none",
    status: result.status,
    stderr: result.stderr.trim(),
    tcpProbeCount: calls.split(/\r?\n/).filter((line) => line.includes("pg_isready -h 127.0.0.1")).length,
    socketProbeCount: calls.split(/\r?\n/).filter((line) => line.includes("pg_isready") && !line.includes(" -h ")).length,
    dumped: calls.includes("pg_dump"),
    restored: calls.includes("pg_restore"),
    backupFileCount: releaseFiles.filter((file) => file.endsWith(".backup.dump")).length,
    checksumFileCount: releaseFiles.filter((file) => file.endsWith(".backup.dump.sha256")).length,
    rollbackGate: existsSync(gate),
    removedContainers: calls.includes("rm -fv"),
    removedNetwork: calls.includes("network rm")
  };
}

try {
  const normal = runScenario();
  if (expectation === "baseline") {
    assert(normal.status !== 0, "baseline unexpectedly survived the first-init shutdown window");
    assert(normal.tcpProbeCount === 0 && normal.socketProbeCount === 2, "baseline control did not use socket readiness");
    assert(normal.dumped && normal.restored, "baseline did not reach the decisive restore failure");
    assert(normal.backupFileCount === 1 && normal.checksumFileCount === 1, "baseline did not retain its completed backup");
    assert(!normal.rollbackGate && normal.removedContainers && normal.removedNetwork, "baseline failure cleanup/gate invariant failed");
    process.stdout.write(`${JSON.stringify({ expectation, revision, normal }, null, 2)}\n`);
  } else {
    assert(normal.status === 0, `candidate readiness flow failed: ${normal.stderr}`);
    assert(normal.tcpProbeCount === 4 && normal.socketProbeCount === 0, "candidate did not wait twice for each final TCP server");
    assert(normal.dumped && normal.restored && normal.rollbackGate, "candidate success did not complete recovery and rollback gate");
    assert(normal.backupFileCount === 1 && normal.checksumFileCount === 1, "candidate success did not retain its backup and checksum");

    const sourceNever = runScenario("source-tcp-never");
    const restoreNever = runScenario("restore-tcp-never");
    for (const failed of [sourceNever, restoreNever]) {
      assert(failed.status !== 0 && failed.stderr.includes("scratch PostgreSQL did not start"), `${failed.failure} did not fail closed`);
      assert(!failed.restored && !failed.rollbackGate, `${failed.failure} reached restore or retained a stale gate`);
      assert(failed.removedContainers && failed.removedNetwork, `${failed.failure} skipped cleanup`);
    }
    assert(!sourceNever.dumped && restoreNever.dumped, "failure ordering does not distinguish source and restore readiness");
    assert(sourceNever.backupFileCount === 0 && restoreNever.backupFileCount === 1 && restoreNever.checksumFileCount === 1,
      "completed source backup was not retained across restore-target readiness failure");
    process.stdout.write(`${JSON.stringify({ expectation, revision, normal, sourceNever, restoreNever }, null, 2)}\n`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
