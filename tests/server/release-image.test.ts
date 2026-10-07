import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = "c".repeat(40);
const appId = `sha256:${"a".repeat(64)}`;
const migrateId = `sha256:${"b".repeat(64)}`;
const appImage = `ghcr.io/test/app@${appId}`;
const migrateImage = `ghcr.io/test/migrate@${migrateId}`;
let dir: string;

function fixture() {
  dir = mkdtempSync(join(tmpdir(), "tokenizer-release-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, "scripts", "test"), { recursive: true });
  for (const name of ["deploy-vps-release.sh", "verify-release-image.sh"]) {
    symlinkSync(join(process.cwd(), "scripts", name), join(dir, "scripts", name));
  }
  writeFileSync(join(dir, "scripts", "test", "rehearse-release.sh"), `#!/usr/bin/env bash
printf 'rehearsal\\n' >> "$CALLS"
if [[ "$MOCK_REHEARSAL_FAIL" == 1 ]]; then exit 7; fi
if [[ "$MOCK_ROLLBACK" == 1 ]]; then printf 'app_image=${appImage}\\n' > ".releases/$EXPECTED_SHA.rollback-approved"; fi
`);
  const env = `GIT_COMMIT=${sha}\nAPP_IMAGE=${appImage}\nMIGRATE_IMAGE=${migrateImage}\nADMIN_TOKEN=admin-token-with-at-least-thirty-two-characters\nAUTH_SECRET=auth-secret-with-at-least-thirty-two-characters\nAUTH_RESEND_KEY=re_test\nNEXT_PUBLIC_APP_URL=https://token.example.test\nPOSTGRES_PASSWORD=existing-db-password\n`;
  writeFileSync(join(dir, ".env"), env);
  mkdirSync(join(dir, ".releases"));
  writeFileSync(join(dir, ".releases", `${sha}.previous-env`), env.replace(sha, "d".repeat(40)));
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1 $2" == "image inspect" ]]; then
  if [[ "$*" != *org.opencontainers.image.revision* ]]; then
    echo "$MOCK_APP_ID"
  elif [[ "$*" == *ghcr.io/test/app* ]]; then
    printf '%s|%s\\n' "$MOCK_APP_ID" "$MOCK_REVISION"
  else
    printf '%s|%s\\n' "$MOCK_MIGRATE_ID" "$MOCK_REVISION"
  fi
elif [[ "$*" == *"ps -q app"* ]]; then
  echo old-container
elif [[ "$1" == "inspect" ]]; then
  echo "$MOCK_APP_ID"
elif [[ "$*" == *"run --rm migrate"* && "$MOCK_MIGRATE_FAIL" == 1 ]]; then
  exit 9
fi
`);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
if [[ -f ".releases/$EXPECTED_SHA.rollback-approved" && "$MOCK_ROLLBACK" == 1 && "$MOCK_HEALTH_BODY" != *'"code":"ready"'* ]]; then
  printf '{"ok":true,"commit":"${"d".repeat(40)}"}\\n'
else printf '%s\\n' "$MOCK_HEALTH_BODY"; fi
`);
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
      MOCK_REHEARSAL_FAIL: "0",
      MOCK_ROLLBACK: "0",
      ...overrides
    }
  });
}

describe.skipIf(process.platform === "win32")("release image gate and fault rehearsal", () => {
  beforeEach(fixture);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("deploys CI digests without rebuild and activates only exact readiness SHA", () => {
    const result = deploy();
    expect(result.status).toBe(0);
    const calls = readFileSync(join(dir, "calls.log"), "utf8");
    expect(calls).not.toContain("compose build");
    expect(calls).toContain(`pull ${appImage}`);
    expect(calls.indexOf("rehearsal")).toBeLessThan(calls.indexOf("run --rm migrate"));
    expect(calls.indexOf("run --rm migrate")).toBeLessThan(calls.indexOf("up --no-deps -d app"));
    expect(readFileSync(join(dir, ".releases", `${sha}.manifest`), "utf8")).toContain(`app_image=${appImage}`);
    expect(readFileSync(join(dir, ".releases", `${sha}.activated`), "utf8")).toContain(`commit=${sha}`);
  });

  it("rejects an image revision mismatch before migration", () => {
    const result = deploy({ MOCK_REVISION: "d".repeat(40) });
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(dir, "calls.log"), "utf8")).not.toContain("run --rm migrate");
  });

  it("refuses a changed digest for an already recorded commit", () => {
    expect(deploy().status).toBe(0);
    const env = readFileSync(join(dir, ".env"), "utf8").replace(appImage, `ghcr.io/test/app@sha256:${"d".repeat(64)}`);
    writeFileSync(join(dir, ".env"), env);
    const result = deploy();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("immutable release digest changed");
  });

  it("keeps the previous image reference and never starts app after migration failure", () => {
    const result = deploy({ MOCK_MIGRATE_FAIL: "1" });
    expect(result.status).toBe(9);
    expect(readFileSync(join(dir, ".releases", `${sha}.previous-env`), "utf8")).toContain(appImage);
    expect(readFileSync(join(dir, "calls.log"), "utf8")).not.toContain("up --no-deps -d app");
    expect(existsSync(join(dir, ".releases", `${sha}.activated`))).toBe(false);
  });

  it("does not mark a release active when health returns a different SHA", () => {
    const result = deploy({ MOCK_HEALTH_BODY: JSON.stringify({ ok: true, code: "ready", commit: "e".repeat(40) }) });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(dir, ".releases", `${sha}.activated`))).toBe(false);
    expect(result.stderr).toContain("failed new app stopped");
    expect(readFileSync(join(dir, "calls.log"), "utf8")).toContain("stop app");
  });

  it("keeps the app runner non-root and makes migration completion a Compose prerequisite", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("COPY --chown=node:node");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("image: tokenizer-app:${GIT_COMMIT:-local}");
    expect(readFileSync("docker-compose.release.yml", "utf8")).toContain("${APP_IMAGE:?digest-pinned APP_IMAGE required}");
  });

  it("refuses rehearsal failure before live migration and replacement", () => {
    expect(deploy({ MOCK_REHEARSAL_FAIL: "1" }).status).toBe(7);
    expect(readFileSync(join(dir, "calls.log"), "utf8")).not.toContain("run --rm migrate");
    expect(readFileSync(join(dir, "calls.log"), "utf8")).not.toContain("up --no-deps -d app");
  });

  it("contains then restores the retained digest only after compatibility rehearsal", () => {
    const result = deploy({ MOCK_ROLLBACK: "1", MOCK_HEALTH_BODY: '{"ok":false}' });
    expect(result.status).toBe(1);
    const calls = readFileSync(join(dir, "calls.log"), "utf8");
    expect(calls.indexOf("stop app")).toBeLessThan(calls.indexOf("--env-file"));
    expect(existsSync(join(dir, ".releases", `${sha}.rolled-back`))).toBe(true);
  });

  it.each(["dev-placeholder-set-AUTH_SECRET-in-production", " padded-secret-with-at-least-thirty-two-chars "])("rejects weak/padded AUTH_SECRET on VPS: %s", (value) => {
    writeFileSync(join(dir, ".env"), readFileSync(join(dir, ".env"), "utf8").replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET=${value}`));
    expect(deploy().status).not.toBe(0);
    expect(existsSync(join(dir, "calls.log"))).toBe(false);
  });
});
