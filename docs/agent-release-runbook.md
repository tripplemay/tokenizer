# Agent release and recovery (B04 candidate)

The server deploy and Agent release are separate operations. A server deploy
does not advance the Agent checkout: installers consume
`GET /api/agent/releases`, whose `release.commit` is pinned in
`src/shared/agent-releases.json`. The installer never falls back to `main`.
The Git commit ID is the content digest checked after fetch and checkout;
`npm ci` additionally checks dependency integrity from `package-lock.json`.
The endpoint is no-store and fails with 503 if the latest release lacks a pin.

## Publish

1. Freeze a candidate Git commit. Check that it contains the intended Agent
   code and lockfile, and test macOS, Linux, and native Windows independently.
2. After independent acceptance, create `agent/v<version>` at that exact
   commit. Tags are release markers; installers verify the immutable commit,
   not a mutable tag name. Do not move an existing Agent tag.
3. In a separate commit, set the latest release's `commit` field to the
   candidate's full lowercase 40-hex SHA. This second commit avoids a
   self-referential manifest. Verify that the endpoint returns the intended
   version, commit, and repository; verify the commit is fetchable from the
   advertised repository. Do not edit `AGENT_FEATURE_VERSION` or
   `MIN_AGENT_FEATURE_VERSION` for an installer-only change.
4. Deploy the server separately. Test one canary per platform, then obtain
   human approval before broadening. Do not publish Windows Agent availability
   until native Windows syntax, service, upgrade, and rollback tests pass.

The current `1.4.0` pin points to `2074991717abaf3cb34d9aad894bcd4357fefbc3`,
the pre-B04 baseline. It is a backfilled freeze point, **not** evidence that
an `agent/v1.4.0` tag or cross-platform release has been approved. Do not
describe this candidate as a completed B04 release.

## Install / upgrade

POSIX: `curl -fsSL <server>/install.sh | bash -s -- --enroll-token <token>`;
native Windows: run `install.ps1 -EnrollToken <token>`. On ordinary upgrades,
the existing `~/.tokenizer/credentials.json`, queue, state/cursor, config, and
logs remain outside the versioned checkout. Re-enrollment only occurs on a
fresh install or explicit `--force-enroll` / `-ForceEnroll`; it can revoke an
old token and is not an automatic recovery step.

Both installers fetch the manifest and prepare a new checkout before stopping
the old Agent. Fetch, digest verification, `npm ci`, and a CLI import/help
smoke must pass first. If these fail, the old checkout and service are not
intentionally touched. A cutover failure attempts to restore the old checkout
and service. POSIX uses an atomic symlink rename for subsequent releases;
the first conversion from a legacy physical `app/` directory has a short
non-atomic move window. Windows uses directory moves with a catch/restore
path, not an atomic filesystem switch.

Manual rollback: rerun the current installer with `--rollback` (POSIX) or
`-Rollback` (Windows). It uses the locally retained previous checkout and
does not query the release endpoint. On POSIX, `~/.tokenizer/previous` points
to the old checkout; on Windows, `~/.tokenizer/previous-release.txt` records
its retained directory. Neither rollback path deletes credentials or queue.
If service restart fails, run `tokenizer install-service` manually from the
restored checkout and inspect `tokenizer service-status` plus Agent logs.

## Remaining gates

- Native macOS launchd, Linux systemd/cron, and Windows Task Scheduler
  fault-injection runs have not been performed for this candidate.
- Verify kill/restart, disk-full at every move, failed native dependency
  installation, offline/old-server response, and actual queue/cursor
  preservation on each platform before declaring B04 complete.
- No detached signature is introduced. The trust chain is HTTPS manifest,
  fixed repository, Git commit digest, and lockfile integrity; source-server
  or repository compromise still requires a separate signing design.
- Uninstall remains service-only and does not implement an explicit `--purge`
  confirmation flow. Token rotation remains manual; no automatic rotation API
  was added.
