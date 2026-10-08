# Exact development invocation profiles and logs

All commands ran from:
/Volumes/ORICO/project/.worktrees/tokenizer-host-preflight-observability-20261009.
No real host-preflight/Docker/SSH operation was executed.

For compact replay notation, expand the following literal prefixes. They are
documentation only; the actual tool invocations used the expanded absolute paths.

```sh
E='env -i HOME=/Volumes/ORICO/project/.hpog-20261009/home TMPDIR=/Volumes/ORICO/project/.hpog-20261009/tmp PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin'
N='npm_config_cache=/Volumes/ORICO/project/.hpog-20261009/npm-cache npm_config_userconfig=/Volumes/ORICO/project/.hpog-20261009/home/user.npmrc npm_config_globalconfig=/Volumes/ORICO/project/.hpog-20261009/home/global.npmrc'
NODE='/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node'
NPM='/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/npm'
R='docs/test-reports/BL-HOST-PREFLIGHT-OBSERVABILITY-20261009/generator'
```

No real user/global npm config was read. The synthetic user.npmrc/global.npmrc
paths were absent; setting those paths prevents default credential/config access.

## Runtime preparation

```sh
mkdir -p docs/test-reports/BL-HOST-PREFLIGHT-OBSERVABILITY-20261009/generator/logs /private/tmp/hpog-20261009/home /private/tmp/hpog-20261009/tmp /private/tmp/hpog-20261009/npm-cache /private/tmp/hpog-20261009/runtime
uname -m
ls -ld node_modules
env -i HOME=/private/tmp/hpog-20261009/home TMPDIR=/private/tmp/hpog-20261009/tmp PATH=/usr/bin:/bin /usr/bin/curl -fL https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-arm64.tar.gz -o /private/tmp/hpog-20261009/runtime/node.tar.gz > "$R/logs/01-node-download.log" 2>&1
env -i HOME=/private/tmp/hpog-20261009/home TMPDIR=/private/tmp/hpog-20261009/tmp PATH=/usr/bin:/bin /usr/bin/curl -fL https://nodejs.org/dist/v22.22.0/SHASUMS256.txt -o /private/tmp/hpog-20261009/runtime/SHASUMS256.txt > "$R/logs/02-checksum-download.log" 2>&1
tar -xzf /private/tmp/hpog-20261009/runtime/node.tar.gz -C /private/tmp/hpog-20261009/runtime
/private/tmp/hpog-20261009/runtime/node-v22.22.0-darwin-arm64/bin/node --version > "$R/logs/03-node-version.log" 2>&1
env -i HOME=/private/tmp/hpog-20261009/home TMPDIR=/private/tmp/hpog-20261009/tmp PATH=/private/tmp/hpog-20261009/runtime/node-v22.22.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin npm_config_cache=/private/tmp/hpog-20261009/npm-cache npm_config_userconfig=/dev/null npm_config_globalconfig=/dev/null npm ci > "$R/logs/04-npm-ci-initial.log" 2>&1
df -Pk /private/tmp/hpog-20261009 /Volumes/ORICO/project/.worktrees/tokenizer-host-preflight-observability-20261009 > "$R/logs/05-local-space.log" 2>&1
mv /private/tmp/hpog-20261009 /Volumes/ORICO/project/.hpog-20261009
tar -xzf /Volumes/ORICO/project/.hpog-20261009/runtime/node.tar.gz -C /Volumes/ORICO/project/.hpog-20261009/runtime > "$R/logs/06-node-extract-relocated.log" 2>&1
/usr/bin/shasum -a 256 /Volumes/ORICO/project/.hpog-20261009/runtime/node.tar.gz > "$R/logs/07-node-archive-sha256.log" 2>&1
rg 'node-v22.22.0-darwin-arm64.tar.gz' /Volumes/ORICO/project/.hpog-20261009/runtime/SHASUMS256.txt > "$R/logs/08-node-official-sha256.log" 2>&1
/Volumes/ORICO/project/.hpog-20261009/runtime/node-v22.22.0-darwin-arm64/bin/node --version > "$R/logs/09-node-version-relocated.log" 2>&1
env -i HOME=/Volumes/ORICO/project/.hpog-20261009/home TMPDIR=/Volumes/ORICO/project/.hpog-20261009/tmp PATH=/Volumes/ORICO/project/.hpog-20261009/runtime/node-v22.22.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin npm_config_cache=/Volumes/ORICO/project/.hpog-20261009/npm-cache npm_config_userconfig=/Volumes/ORICO/project/.hpog-20261009/home/user.npmrc npm_config_globalconfig=/Volumes/ORICO/project/.hpog-20261009/home/global.npmrc /Volumes/ORICO/project/.hpog-20261009/runtime/node-v22.22.0-darwin-arm64/bin/node /Volumes/ORICO/project/.hpog-20261009/runtime/node-v22.22.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js ci > "$R/logs/10-npm-ci-relocated.log" 2>&1
```

The last command retained its original session 85769 through one STOP/CONT pause.
All subsequent commands below used the Coordinator-directed existing Node22 bin,
not an extra install or a changed dependency lock.

## Scoped development runs

| Log | Expanded command suffix following E (and N for npm) | Exit |
| --- | --- | --- |
| 11-old-host-tests-initial.log | NODE node_modules/vitest/vitest.mjs run tests/ci/vps-host-preflight.test.ts --reporter=verbose | 0 |
| 12-new-host-tests-initial.log | NODE node_modules/vitest/vitest.mjs run tests/ci/vps-host-preflight-observability.test.ts --reporter=verbose | 1 |
| 13-verify-initial.log | N NPM run verify | 2 |
| 14-lint-initial.log | N NPM run lint | 0 |
| 15-new-host-tests-after-fixture-fix.log | NODE node_modules/vitest/vitest.mjs run tests/ci/vps-host-preflight-observability.test.ts --reporter=verbose | 0 |
| 16-verify-after-env-types.log | N NPM run verify | 0 |

Each command appended exactly `> "$R/logs/<name>" 2>&1`; separate numbered files
were used, never overwriting an initial failure. Session final returns were
awaited only for real running IDs 69174, 40584 and 52265. No old suite retry was
used to obtain a first green result; it returned exit 0 on its first run.

The only post-failure manual source edit was in the new test: add HEAD_CODE='',
HANG='', EARLY='', LC_ALL to the baseline fixture environment to match the
candidate; add NODE_ENV='test' / NodeJS.ProcessEnv to synthetic env objects.
Script/workflow remained unchanged after their original implementation.

## Freeze and identity checks

```sh
git diff --check > "$R/logs/17-diff-check-before-source-commit.log" 2>&1
/bin/bash -n scripts/ci/vps-host-preflight.sh > "$R/logs/18-bash-syntax.log" 2>&1
git add .github/workflows/deploy-vps.yml scripts/ci/vps-host-preflight.sh tests/ci/vps-host-preflight-observability.test.ts
git commit -m '[BL-RELEASE-READINESS-F003] Add bounded Compose probe metadata' -m 'Preserve shared query, refusal reasons, SSH invocation, and all old tests. Add a separate synthetic observability suite and extend only the existing host inventory jq filter. Generator development outputs are recorded separately and do not constitute independent acceptance.' > "$R/logs/19-source-commit.log" 2>&1
git diff --name-status a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca cddb822cc2452c2042309de73064a38f0c4224cf > "$R/logs/20-source-file-list.log"
git diff a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca cddb822cc2452c2042309de73064a38f0c4224cf -- .github/workflows/deploy-vps.yml scripts/ci/vps-host-preflight.sh tests/ci/vps-host-preflight-observability.test.ts > "$R/source.diff"
git diff --exit-code a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca cddb822cc2452c2042309de73064a38f0c4224cf -- progress.json features.json harness-rules.md CLAUDE.md AGENTS.md generator.md package.json package-lock.json vitest.config.ts tests/ci/vps-host-preflight.test.ts .auto-memory framework docs/test-reports > "$R/logs/25-frozen-path-source-diff.log" 2>&1
```

Logs 21/22 recheck existing Node/npm versions with E (N for npm). Log 23 records
`df -Pk /Volumes/ORICO/project/.hpog-20261009 /private/tmp`. Log 24 records
fs.realpathSync and fs.lstatSync for only the three synthetic helper directories.
No relevant source changed after cddb822cc2452c2042309de73064a38f0c4224cf.
