import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = "c".repeat(40);
const appId = `sha256:${"a".repeat(64)}`;
const migrateId = `sha256:${"b".repeat(64)}`;
let dir: string;

function fixture() {
  dir = mkdtempSync(join(tmpdir(), "tokenizer-release-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  symlinkSync(join(process.cwd(), "scripts"), join(dir, "scripts"), "dir");
  writeFileSync(join(dir, ".env"), `GIT_COMMIT=${sha}\nADMIN_TOKEN=admin-token-with-at-least-thirty-two-characters\nAUTH_SECRET=auth-secret-with-at-least-thirty-two-characters\nAUTH_RESEND_KEY=re_test\nNEXT_PUBLIC_APP_URL=https://token.example.test\nPOSTGRES_PASSWORD=existing-db-password\n`);
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1 $2" == "image inspect" ]]; then
  if [[ "$*" == *tokenizer-app:* ]]; then
    printf '%s|%s\\n' "$MOCK_APP_ID" "$MOCK_REVISION"
  else
    printf '%s|%s\\n' "$MOCK_MIGRATE_ID" "$MOCK_REVISION"
  fi
elif [[ "$1 $2" == "compose ps" ]]; then
  echo old-container
elif [[ "$1" == "inspect" ]]; then
  echo "$MOCK_APP_ID"
elif [[ "$1 $2" == "compose run" && "$MOCK_MIGRATE_FAIL" == 1 ]]; then
  exit 9
fi
`);
  writeFileSync(join(bin, "curl"), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$MOCK_HEALTH_BODY"\n');
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  for (const name of ["docker", "curl", "sleep"]) chmodSync(join(bin, name), 0o755);
}

function deploy(overrides: Record<string, string> = {}) {
  return spawnSync("bash", ["scripts/deploy-vps-release.sh"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      CALLS: join(dir, "calls.log"),
      EXPECTED_SHA: sha,
      MOCK_APP_ID: appId,
      MOCK_MIGRATE_ID: migrateId,
      MOCK_REVISION: sha,
      MOCK_HEALTH_BODY: JSON.stringify({ ok: true, code: "ready", commit: sha }),
      MOCK_MIGRATE_FAIL: "0",
      ...overrides
    }
  });
}

describe.skipIf(process.platform === "win32")("release image gate and fault rehearsal", () => {
  beforeEach(fixture);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records immutable image IDs and activates only an exact readiness SHA", () => {
    const result = deploy();
    expect(result.status).toBe(0);
    const calls = readFileSync(join(dir, "calls.log"), "utf8");
    expect(calls.indexOf("compose build")).toBeLessThan(calls.indexOf("compose run --rm migrate"));
    expect(calls.indexOf("compose run --rm migrate")).toBeLessThan(calls.indexOf("compose up --no-deps -d app"));
    expect(readFileSync(join(dir, ".releases", `${sha}.manifest`), "utf8")).toContain(`app_id=${appId}`);
    expect(readFileSync(join(dir, ".releases", `${sha}.activated`), "utf8")).toContain(`commit=${sha}`);
  });

  it("rejects an image revision mismatch before migration", () => {
    const result = deploy({ MOCK_REVISION: "d".repeat(40) });
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(dir, "calls.log"), "utf8")).not.toContain("compose run --rm migrate");
    expect(existsSync(join(dir, ".releases", `${sha}.manifest`))).toBe(false);
  });

  it("refuses a changed image ID for an already recorded commit", () => {
    expect(deploy().status).toBe(0);
    const result = deploy({ MOCK_APP_ID: `sha256:${"d".repeat(64)}` });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mutable rebuild");
    expect(readFileSync(join(dir, "calls.log"), "utf8").match(/compose build/g)).toHaveLength(1);
  });

  it("keeps the previous image reference and never starts app after migration failure", () => {
    const result = deploy({ MOCK_MIGRATE_FAIL: "1" });
    expect(result.status).toBe(9);
    expect(readFileSync(join(dir, ".releases", `${sha}.previous-app-id`), "utf8")).toContain(appId);
    expect(readFileSync(join(dir, "calls.log"), "utf8")).not.toContain("compose up --no-deps -d app");
    expect(existsSync(join(dir, ".releases", `${sha}.activated`))).toBe(false);
  });

  it("does not mark a release active when health returns a different SHA", () => {
    const result = deploy({ MOCK_HEALTH_BODY: JSON.stringify({ ok: true, code: "ready", commit: "e".repeat(40) }) });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(dir, ".releases", `${sha}.activated`))).toBe(false);
    expect(result.stderr).toContain("schema compatibility review");
  });

  it("keeps the app runner non-root and makes migration completion a Compose prerequisite", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("COPY --chown=node:node");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("image: tokenizer-app:${GIT_COMMIT:-local}");
  });
});
