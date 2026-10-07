# B05 evidence-retention independent evaluation, round 2

Date: 2026-10-08

Candidate: `6164b4e29922dbce685d01bf2c4c9d41428c9a08`

Safe branch: `codex/b05-portable-retention-ci-20261008`

GitHub Actions run: `37656417182`

## 结论

- **B05 retention fix / safe-branch CI admission: PASS.** 候选在精确 SHA 上完成 Linux、原生 Windows、PostgreSQL 16、authenticated browser 和 Linux OCI/recovery job；CI 中 staging、上传、下载和下载后哈希校验均成功，Deploy 按非 main 规则跳过。
- **完整 B05 生产发布: NOT READY.** 本次是非 main run，GHCR 登录/发布、app 与 migration 的 GitHub signed attestation、wrong-SHA/wrong-workflow provenance 负控均按设计跳过；真实生产 predecessor/bootstrap、真实生产备份隔离恢复、生产 deploy/canary/rollback 尚无证据。
- `8d646d8` 的 portable regression 修复没有缩减旧不变量：它只精确排除依赖本地 git object 的历史 evaluator test，保留该文件原字节和旧 `SHA256SUMS`，并新增无 `git show` 依赖的 active source-invariant suite。
- B04 的 agent release blockers 与本 B05 候选无关，不计为 B05 缺陷；若做聚合发布，仍需由对应 B04 gate 单独裁决。

## 关键验收

### 1. 旧证据不可变与 portable regression

- `docs/test-reports/B05-tcp-readiness-independent-20261007/evidence/SHA256SUMS` 的 **9/9** 条目全部通过。
- 历史 test 当前 SHA-256 为 `cd29a182483084db6135c97f8c0a6644758a4e86c6a37d7d776243f8c81d5ba0`，与旧 manifest 一致。
- 候选没有修改旧 report、verdict 或 evidence；历史 evaluator test 仅从 active Vitest discovery 中被精确排除，文件本身未删除、未改写。
- replacement `tests/ci/b05-recovery-source.test.ts` 与 `tests/helpers/b05-source-invariants.ts` 不调用 `git show`/子进程读取旧对象，支持 LF/CRLF，并覆盖 TCP readiness-only delta、stale approval、checksum、`--exit-on-error`、rollback ledger、临时 dump cleanup、supplement/docs drift 等负控。
- evaluator 新增的独立 test 验证了 9 条旧哈希、精确排除、active replacement、workflow 顺序、非 main 四文件 allowlist、secret canary 排除及下载内容篡改 fail-closed：**4/4 PASS**。

证据：

- `evidence/legacy-sha256sums-check.log`
- `evidence/candidate-inspection.txt`
- `evidence/evaluator-round2-test.log`
- `tests/evaluator/b05-evidence-retention-round2.test.ts`

### 2. retention 设计

`.github/workflows/deploy-vps.yml` 在 OCI/recovery job 中：

1. 以精确 `GITHUB_SHA` 和 main-only `REQUIRE_PROVENANCE` 调用 `recovery-evidence.mjs stage`；
2. 从专用 `release-recovery-evidence/` 上传，不直接上传整个 `.releases/`；
3. 设置 `include-hidden-files: true` 和 `if-no-files-found: error`；
4. 用相同 artifact name 下载到独立目录；
5. 对下载副本执行 manifest、文件集合、byte count 和 SHA-256 验证。

`scripts/ci/recovery-evidence.mjs` 只允许当前 SHA 的 dump、dump checksum、rehearsal ledger、rollback approval；main 额外要求 app/migrate provenance 与两个负控记录。它拒绝 symlink、非普通文件、额外文件、大小超限、revision/path/digest/inventory/runtime UID/rollback 不匹配。`.env`、previous env、生产备份及其他 `.releases` 内容不会进入 staging。

本轮未发现新的 retention 设计 blocker。main provenance JSON 的真实性依赖 workflow 前置 `gh attestation verify`；非 main run 不提供该证明，这属于下述生产 gate，而不是本 safe-branch retention 失败。

### 3. 精确 SHA 原生 CI

Run `37656417182` 的 API 结果为 `completed/success`，`headSha` 精确等于候选：

| Job | 结果 |
| --- | --- |
| Verify | `completed/success` |
| Verify (Windows) | `completed/success` |
| Verify (PostgreSQL 16) | `completed/success` |
| Verify (authenticated browser) | `completed/success` |
| Linux OCI and recovery rehearsal | `completed/success` |
| Deploy | `completed/skipped` |

Windows job 是 GitHub hosted Windows 原生执行，unit、owner force-termination evidence 和 PowerShell syntax 均成功；不是本地 mock。OCI job 构建 candidate app/migrate 及 previous-source app/migrate，并完成 PostgreSQL 16 synthetic backup/restore/migration/business/old-image rehearsal。由于 run 非 main，GHCR login 与三个 attestation/provenance steps 均明确为 `skipped`。

证据：

- `evidence/native-run-37656417182-final.json`
- `evidence/native-run-37656417182-oci-job.log`

### 4. GitHub artifact API 与独立下载复验

GitHub artifact API 返回：

- artifact ID: `11498713000`
- name: `release-recovery-6164b4e29922dbce685d01bf2c4c9d41428c9a08`
- size: `14473` bytes
- expired: `false`
- API digest: `sha256:c0274b4509562f35880985d145aa0da69f2159445782629d51ef9f93245de709`
- expiry: `2026-10-21T17:13:56Z`

Evaluator 通过 artifact API 独立下载 ZIP；本地 ZIP SHA-256 同为 `c0274b4509562f35880985d145aa0da69f2159445782629d51ef9f93245de709`。解压后再次运行 candidate verifier，exit 0。manifest 的 revision 为精确 candidate SHA、`provenanceRequired=false`，只含四个 allowlisted 文件；四个文件的 byte count 和 SHA-256 均匹配。

负控 run `37650581332` 的 API 当前仍有 6 个其他 artifacts，但 `release-recovery-*` 匹配数为 **0**，证明本轮验证的 recovery artifact 是新 workflow 真正新增的保留结果，而非沿用旧 run。

证据：

- `evidence/native-run-37656417182-artifacts.json`
- `evidence/negative-run-37650581332-artifacts.json`
- `evidence/downloaded-artifact-sha256.txt`
- `evidence/downloaded-artifact-verify.log`
- `evidence/downloaded-manifest.json`

### 5. 本地 Node 22 回归

环境：macOS 26.6.2 arm64，Node `v22.22.0`。

- `npm run verify`: PASS。
- focused B05 suite: **5 files / 51 tests PASS**。
- full Vitest（含本轮 evaluator test）: **122 files passed, 8 skipped; 1619 tests passed, 22 skipped**。
- `node --check scripts/ci/recovery-evidence.mjs`: PASS。
- `actionlint .github/workflows/deploy-vps.yml`: PASS。

证据：

- `evidence/verify-node22.log`
- `evidence/focused-regression.log`
- `evidence/full-test-node22.log`
- `evidence/static-checks.log`

## Readiness boundary

### Safe-branch CI

**PASS.** 上轮的 hard blocker（绿灯但没有 retained recovery artifact）已在新 SHA 上关闭：artifact 存在、可下载、ZIP API digest 匹配、内部 manifest/allowlist/hash 可复验，缺文件与篡改均 fail closed。候选可进入候选分支 CI/集成评审。

### Full B05 production release

**NOT READY。剩余硬门：**

1. 在获授权的 main release path 发布 GHCR app/migration immutable digests。
2. 生成并验证绑定精确 source SHA/workflow 的 signed attestations，并运行 wrong-SHA/wrong-workflow 负控。
3. 建立、记录并验证真实生产 retained predecessor digest/config 或 bootstrap baseline。
4. 对真实生产备份执行隔离恢复和 migration/canary rehearsal，而不是只依赖 synthetic CI dump。
5. 经人工授权执行生产 deploy、health/business canary 与可审计 rollback；本轮 Deploy 为 `skipped`。

## Scope

- 未修改候选产品实现、原 worktree、`progress.json`、status、gate 或人工 decision。
- 未 push、未发布、未运行生产操作。
- 本提交只包含 evaluator-owned test、报告与证据。
