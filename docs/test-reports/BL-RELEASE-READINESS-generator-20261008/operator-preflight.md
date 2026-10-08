# Read-only Actions host inventory

Generator delivery, not acceptance or permission to switch/deploy a host.

After the Coordinator has published the reviewed non-main candidate, dispatch
the exact candidate SHA using the existing Actions VPS connection identity:

```sh
gh workflow run deploy-vps.yml --ref <reviewed-candidate-ref> -f operation=host-preflight
```

The workflow is available only when its definition exists at that ref. Record
the run ID, head SHA and terminal conclusion; download only
`tokenizer-host-preflight-<SHA>/inventory.json`. A zero exit means the scoped
serving identity and backend were observable, not that release gates passed.

## Scope

- `host-preflight` runs only the inventory job, including on `main`. Verify,
  native Windows/macOS, PG16, browser, OCI/recovery and deploy jobs do not run.
  Normal push/PR gates and dispatch `operation=release` retain those gates.
- Uses existing `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT` and
  `VPS_DEPLOY_PATH` Secrets. This implementation neither edits Secrets nor
  changes environment protection. Connection data is validated before SSH
  interpolation. No personal key/host alias fallback exists.
- Sends `scripts/ci/vps-host-preflight.sh` through SSH stdin. No files are
  uploaded to the VPS. Key/known-host/private response staging is only on the
  disposable Actions runner. SSH keyscan retains the existing trust-discovery
  model; it is not out-of-band host-key authentication.
- Fixed Docker project `tokenizer`, services `app`/`postgres`, network
  `tokenizer_default`, volume `tokenizer_postgres-data`, backend
  `127.0.0.1:3010`. Nonstandard project/storage layouts fail closed; do not
  broaden scope to unrelated projects to work around a refusal.
- No `.env` sourcing, `Config.Env`, database query/dump, registry login/pull,
  build, backup, rsync/scp, migration, service change, activation ledger
  creation, or signals to user services. `timeout` can kill only its own query
  subprocess. Query output is capped at 16KiB/5s; SSH output at 64KiB/150s.
- Selected config values are only `GIT_COMMIT`, `APP_IMAGE`, `MIGRATE_IMAGE`,
  `APP_HOST_PORT`. Config/ledger bytes are never retained: only SHA256/mode or
  missing markers. Raw stderr is discarded, including failed SSH/Docker/curl.
  An invalid response retains only the local fixed `transport_failed` record.
- The configured image user `node` is reported as user=`node`, uid=`unknown`;
  no container exec is used to guess its numeric UID. Explicit numeric image
  users can yield a UID. Missing revision/config/ledger is explicit.

## Interpretation and limits

`legacy_or_unknown` is permitted for a healthy source-built predecessor inventory
with exact project/service/port/backend SHA. It cannot pass the deployment
predecessor guard. `digest_activated` means the observed selected digest settings
and existing manifest/activation ledger agree; it is not cryptographic provenance,
recovery rehearsal, release acceptance, or permission to fabricate those files.

Absent/multiple/stopped/wrong-project/wrong-image/wrong-port/unhealthy app or
wrong/unready backend returns nonzero with a redacted refusal. A failed inventory
does not mutate the host. Resolve its cause through Coordinator/user adjudication;
never create a ledger or change the host using this script.

The inventory reports storage/free-space and local health only. No live host
inventory was executed by this Generator. Production source/backup destination,
backup encryption/restore, main-only provenance, exact native CI and original
homepage/browser deployment acceptance remain separate Coordinator/Evaluator
gates. F004 remains pending until exact-candidate native jobs are recorded.
