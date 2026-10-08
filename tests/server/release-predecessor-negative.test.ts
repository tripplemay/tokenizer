import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sha = 'c'.repeat(40), oldSha = 'd'.repeat(40);
const imageId = `sha256:${'a'.repeat(64)}`;
const app = `ghcr.io/test/app@${imageId}`, migrate = `ghcr.io/test/migrate@sha256:${'b'.repeat(64)}`;
let root: string;
const script = join(process.cwd(), 'scripts/verify-vps-predecessor.sh');
const baseline = `GIT_COMMIT=${oldSha}\nAPP_IMAGE=${app}\nMIGRATE_IMAGE=${migrate}\nAPP_HOST_PORT=127.0.0.1:3010\nAUTH_SECRET=synthetic-secret-canary\n`;

function executable(name: string, body: string) {
  const path = join(root, 'bin', name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function snapshot(directory = root, prefix = ''): Record<string, string> {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'calls') return [];
    const path = join(directory, entry.name), key = `${prefix}${entry.name}`;
    return entry.isDirectory() ? Object.entries(snapshot(path, `${key}/`)) : [[key, readFileSync(path).toString('hex')]];
  }));
}

function run(overrides: Record<string, string> = {}) {
  return spawnSync('bash', [script, 'live', sha, app, migrate], { cwd: root, encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...overrides } });
}

describe.skipIf(process.platform === 'win32')('additive predecessor fail-closed controls', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'predecessor-'));
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, '.releases'));
    writeFileSync(join(root, '.env'), baseline);
    writeFileSync(join(root, 'docker-compose.yml'), 'services:\n  app: {}\n');
    writeFileSync(join(root, 'docker-compose.release.yml'), 'services:\n  app: {}\n');
    writeFileSync(join(root, '.releases', `${oldSha}.manifest`), `commit=${oldSha}\napp_image=${app}\nmigrate_image=${migrate}\n`);
    writeFileSync(join(root, '.releases', `${oldSha}.activated`), `commit=${oldSha}\napp_image=${app}\napp_id=${imageId}\n`);
    executable('docker', `printf '%s\\n' "$*" >> calls
case "$*" in
  'image inspect --format {{.Id}} '*) printf '%s\\n' '${imageId}' ;;
  *'config --quiet') exit 0 ;;
  *'config --format json') printf '{"name":"fixture"}\\n' ;;
  *'ps -q app') printf '%s\\n' "\${APP_IDS-aaaaaaaaaaaa}" ;;
  inspect*) printf '%s\\n' "\${DETAILS-true|fixture|app|${imageId}}" ;;
  'port aaaaaaaaaaaa 3000/tcp') printf '%s\\n' "\${PORT-127.0.0.1:3010}" ;;
  *) echo 'mutation-or-unknown-command' >&2; exit 99 ;;
esac`);
    executable('curl', `if [ "\${HEALTH_BODY+x}" = x ]; then printf '%s\\n' "$HEALTH_BODY"; else printf '%s\\n' '{"ok":true,"code":"ready","commit":"${oldSha}"}'; fi`);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    { APP_IDS: '' }, { APP_IDS: 'aaaaaaaaaaaa\nbbbbbbbbbbbb' },
    { DETAILS: `false|fixture|app|${imageId}` }, { DETAILS: `true|other|app|${imageId}` },
    { DETAILS: `true|fixture|postgres|${imageId}` }, { DETAILS: `true|fixture|app|sha256:${'e'.repeat(64)}` },
    { PORT: '0.0.0.0:3010' },
    { HEALTH_BODY: `{"ok":true,"code":"db_unavailable","commit":"${oldSha}"}` },
    { HEALTH_BODY: `{"ok":true,"code":null,"commit":"${oldSha}"}` },
    { HEALTH_BODY: `{"ok":true,"code":"ready","commit":"${sha}"}` }
  ])('refuses wrong or missing serving identity without writes %#', (overrides) => {
    const before = snapshot();
    const result = run(overrides);
    expect(result.status, result.stdout).not.toBe(0);
    expect(snapshot()).toEqual(before);
    expect(`${result.stdout}${result.stderr}`).not.toContain('synthetic-secret-canary');
    expect(readFileSync(join(root, 'calls'), 'utf8')).not.toMatch(/pull|\bup\b|stop|run|login|exec/);
  });

  it.each(['legacy-image', 'missing-activation', 'duplicate-sha', 'same-sha', 'manifest-diff', 'activation-diff'])
    ('refuses incomplete or conflicting predecessor provenance: %s', (kind) => {
      if (kind === 'legacy-image') writeFileSync(join(root, '.env'), baseline.replace(app, 'tokenizer-app:legacy'));
      if (kind === 'missing-activation') rmSync(join(root, '.releases', `${oldSha}.activated`));
      if (kind === 'duplicate-sha') writeFileSync(join(root, '.env'), `${baseline}GIT_COMMIT=${oldSha}\n`);
      if (kind === 'same-sha') writeFileSync(join(root, '.env'), baseline.replace(oldSha, sha));
      if (kind === 'manifest-diff') writeFileSync(join(root, '.releases', `${oldSha}.manifest`), 'wrong\n');
      if (kind === 'activation-diff') writeFileSync(join(root, '.releases', `${oldSha}.activated`), 'wrong\n');
      const before = snapshot();
      expect(run().status).not.toBe(0);
      expect(snapshot()).toEqual(before);
    });

  it('accepts the old health shape only with exact activated identity and preserves every byte', () => {
    const before = snapshot();
    const result = run({ HEALTH_BODY: `{"ok":true,"commit":"${oldSha}"}` });
    expect(result.status, result.stderr).toBe(0);
    expect(snapshot()).toEqual(before);
  });
});
