# B06 server bounded-schema Generator checkpoint

Base: `4d96e4bb23224f393099b2187c8b42cd7a521cd8`.
Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b06-bounded-schema-20261007`.
Role: isolated Generator. This is a checkpoint, not completed implementation or acceptance.

Before product edits, own Node22 `npm ci` and the existing `tests/server/usage-batch-input.test.ts` passed (2 tests). Its first test deliberately accepts a poison source and overlong/control-character device name, then asserts device and usage writes. `evidence/baseline-poison-acceptance.log` retains that old behavior. No product/test code has been changed yet.

The plan README is absent from the integration base; it was read from the isolated plan worktree at `/Volumes/ORICO/project/.worktrees/tokenizer-upgrade-plan-20261007/docs/analysis/2026-10-07-upgrade-plan/README.md`. B06 calls for pre-write bytes/count/string/enum/time/numeric/depth/size checks and explicit ACK semantics. This assigned slice must reject the whole invalid batch with safe structured 400 codes, not send a partial 200 that old Agents would clear. Client poison-row quarantine/partial ID ACK and future B07 outbox coordination remain NOT DONE.

Inspected: both API batch routes, auth read-only lookup, ingest device/token writes, Prisma Int/Decimal/BigInt columns, old Agent upload shape, quota provider registry, privacy minimization, and the older optional PG poison-acceptance probe. Proposed implementation should preserve old valid payloads, including quota requests without a device field, and validate all rows before timezone/device/token writes. No transaction/outbox migration is in scope.

Coordinator requested a priority switch to the separate B05 evidence-retention blocker. B06 implementation will resume in this same isolated worktree after that task; B04/B05 changes must not be mixed into it. No state/gate changes or push occurred.
