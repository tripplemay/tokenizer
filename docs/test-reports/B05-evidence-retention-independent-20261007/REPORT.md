# B05 evidence-retention independent evaluation

Date: 2026-10-07

Candidate: `ec3348ecae2669c68187b7ca35dc6707a20267a8`

Exact-SHA workflow: [run 37653910013](https://github.com/tripplemay/tokenizer/actions/runs/37653910013)

## 总体结论

- **Verdict: BLOCKED.** exact-SHA run `37653910013` 终态为 `failure`，Linux Verify 失败 1 条、Windows 失败 3 条。Linux OCI/recovery job 因依赖失败被跳过，上传、下载及下载后 hash verifier 均未运行。
- **Retention 设计静态/本地检查通过。** 精确 SHA allowlist、secret 排除、大小上限、regular-file/symlink 边界、manifest/SHA256、fail-closed upload 以及 same-job download/verify 的设计完整；独立本地 synthetic roundtrip 通过。
- **真实 artifact acceptance 不存在。** 当前 run 的 artifact API 只有 `tokenizer-browser-e2e`，没有 `release-recovery-ec3348...`，因此无法执行真实下载及独立 hash 复验。
- **旧 evaluator evidence 未保持自洽。** 旧报告和 verdict 字节未变，但候选修改了旧 `SHA256SUMS` 覆盖的 evaluator test，导致该 manifest 当前失败；候选附带的 `transport-hashes.log` 已陈旧。
- Full B05 release 继续为 **NOT_READY**。即使下一版关闭 CI retention gate，main GHCR/attestation、真实生产 predecessor/bootstrap、生产备份恢复及 deploy/canary/rollback 仍须单独验收。B04 阻断与本次 B05 无关。

## Findings

### [HIGH] B05-RET-EVAL-001 - local-only Git objects 使 fresh CI 在 retention 前失败

`tests/evaluator/b05-tcp-readiness-independent.test.ts` 运行 `git show` 读取硬编码对象：

- `3ade5d1e45ac0f53f0f7a122711e6e219b7dac09`
- `11907f5df1bcedc03a5600252056502fd1e88f3f`

本地 object database 含这些对象，所以聚焦与全套件均通过；fresh GitHub checkout 不保证包含它们：

- Linux Verify：1/3 失败，`11907f5...` 无法解析；最终 `120 passed / 8 skipped / 1 failed files`，`1607 passed / 22 skipped / 1 failed tests`。
- Windows：3/3 失败，`3ade5d1...` 与 `11907f5...` 均无法解析；最终 `117 passed / 11 skipped / 1 failed files`，`1567 passed / 60 skipped / 3 failed tests`。
- PostgreSQL 16 与 authenticated browser 通过，但 `Linux OCI and recovery rehearsal` 和 Deploy 均 skipped。

这是候选 CI blocker，不是 retention helper 的已证功能错误；但它阻止了唯一能证明真实 artifact service roundtrip 的 job，因而不能绕过。

要求：旧 evaluator artifact 保持原 blob；新候选用仓库内 portable fixture/blob 实现新断言，并重新运行完整 exact-SHA workflow。不得依赖 evaluator 本地 object database。

### [HIGH] B05-RET-EVAL-002 - prior evaluator SHA256SUMS 被候选破坏

`docs/test-reports/B05-tcp-readiness-independent-20261007/evidence/SHA256SUMS` 把 `tests/evaluator/b05-tcp-readiness-independent.test.ts` 纳入旧验收证据，原 hash 为 `cd29a182...`。本候选为了更新 VPS 文档断言修改该文件，当前 hash 为 `b17c1656...`。

独立执行 `shasum -a 256 -c` 的结果是 8 项通过、该 test 失败。与此同时：

- 旧 `REPORT.md` / `verdict.json` 与原 evaluator commit `e550e27` 字节一致。
- `M1-B05-R13-round3-post-ci-evaluator-evidence/SHA256SUMS` 仍为 8/8 PASS。
- generator 保存的 `B05-evidence-retention-fix-20261007/evidence/transport-hashes.log` 显示旧 test `OK`，但该日志是在最终 test 变化前产生，不能证明当前 tree。

要求：恢复旧 test 原 blob，使旧 manifest 再次完整通过；将新文档契约放入新的 candidate-owned portable test。若旧 local-object test 不再进入常规 CI，应以显式、可审计方式归档/排除，并保留替代覆盖，不能改写旧 evidence bytes。

## Retention contract review

### Allowlist 与 secret 边界

`scripts/ci/recovery-evidence.mjs` 非 main 路径只接纳：

1. 唯一一个精确 SHA 的 `tokenizer-rehearsal-<pid>-<random>.backup.dump`；
2. 对应 `.sha256`；
3. 精确 SHA `.rehearsal`；
4. 精确 SHA `.rollback-approved`。

main 另要求 app/migrate provenance JSON 与两个 negative-control ledgers。`.env`、previous-env、live/其他 SHA backup、未知文件及非 main 不需要的 provenance 不会复制到 staging。错误只输出统一的 `recovery evidence validation failed`。

### 文件与内容限制

- dump 必须为 1..64 MiB 的 regular non-symlink file；其余每项为 1 byte..1 MiB。
- source/download 顶层必须是非 symlink directory。
- checksum sidecar 必须精确匹配 dump 内容和 `.releases/<dump>` 路径。
- ledger 必须含精确 commit、`mode=synthetic`、精确 backup path、五段 numeric inventory、非零 runtime UID 和 `rollback=passed`。
- approval 只允许 digest-pinned app image 和 40-hex previous SHA。
- downloaded directory 必须与 manifest 精确同集；manifest schema、revision、provenance flag、顺序、字节数与 SHA256 均验证。missing/extra/tamper/wrong revision/path traversal/symlink 均有负控。

本地独立 stage/copy/verify 用精确 candidate SHA 成功，manifest 含 4 个 allowlisted entries；加入 source `.env` canary 后 staged 输出中不存在 `.env`。这只证明 helper 与文件系统 copy，不是 GitHub artifact service。

### Workflow upload/download

Workflow 设计为：

1. 成功 rehearsal 后 stage 到非隐藏 `release-recovery-evidence/`；
2. `actions/upload-artifact@v4`，名称 `release-recovery-${{ github.sha }}`，`if-no-files-found: error`，retention 14 days；
3. 同 job 用 `actions/download-artifact@v4` 下载至独立目录；
4. 对下载后的字节执行 manifest/hash verifier。

这个顺序静态正确，且 upload 的 `if: always()` 会让 rehearsal/stage 缺失时因找不到文件而 fail closed。问题是本轮 release-artifact job 完全没启动，所以以上步骤没有 live evidence。

## Artifact API negative and current state

- 旧 run `37650581332`：API 当前返回 6 个 artifacts（4 个 Docker build record、Windows owner、browser），`release-recovery-*` 数量为 0；这复核了前版缺失负控。
- 当前 run `37653910013`：API 仅返回 `tokenizer-browser-e2e`，`release-recovery-*` 数量为 0。
- 因目标 artifact 不存在，不能下载、枚举真实内容、复算 manifest/hash，也不能把 local copy roundtrip 冒充为 artifact service 结果。

## 文档修正

`docs/VPS-deployment.md` 旧的“CI 不构建部署镜像 / VPS 构建 SHA 镜像”矛盾已经删除。当前描述明确区分 CI-built immutable images、main GHCR/provenance、non-main isolated registry、synthetic retained evidence，以及仍需单独授权的真实生产 baseline/restore。此项在 source/local test 层面关闭，但不抵消 CI blocker。

## Local Node 22 结果

环境：macOS arm64，Node `v22.22.0`，独立 `npm ci` 安装 671 packages。

- focused：5 files / 44 tests PASS。
- full：121 files passed / 8 skipped；1608 passed / 22 skipped。
- `npm run verify`、`npm run lint`、`npm run build`：PASS。
- `actionlint`、`node --check scripts/ci/recovery-evidence.mjs`：PASS。

边界：本地 git object availability 正是本次 CI defect 被掩盖的原因，因此本地全绿不能替代 fresh checkout。

## Readiness

### CI-only readiness

`BLOCKED_EXACT_SHA_TEST_FAILURE_AND_NO_ARTIFACT_ROUNDTRIP`。

下一候选必须同时满足：

1. 旧 evaluator evidence manifest 全部恢复 PASS；
2. portable tests 在 Linux/Windows fresh checkout 通过；
3. exact-SHA 全 workflow green，Deploy 在 non-main 正确 skipped；
4. Linux OCI/recovery 的 stage/upload/download/verify 全部实际执行并通过；
5. artifact API 存在精确名称，Evaluator 独立下载、核对 exact allowlist/manifest/size/SHA256，并重跑 verifier。

### Full B05 release readiness

即使上述 CI-only gate 关闭，仍为 `NOT_READY`，硬门包括：

1. authorized main-equivalent GHCR publication 与 signed attestation positive/wrong-source/wrong-workflow；
2. 实际 production retained old-digest/bootstrap baseline；
3. 实际 production backup 的隔离恢复；
4. 授权的 production deploy、readiness、business canary 与 rollback 证据。

## Scorecard

- Correctness：4/5 — retention contract 本地一致，但决定性 live path 未运行。
- Regression Risk：2/5 — 变更后的 evaluator test 使 Linux/Windows mandatory suites 失败。
- Security：4/5 — allowlist、generic failure、size/hash/symlink checks 完整。
- Reliability：2/5 — 无真实 roundtrip，且旧 evidence manifest 被破坏。
- Performance：N/A — bounded CI helper。
- Maintainability：4/5 — helper 清晰；active test 依赖不可用 object，handoff 证据陈旧。
- Test Readiness：1/5 — exact-SHA CI 在目标 job 前失败。

归一化约 `61/100`，红线适用，等级 **C / Not ready**。

本 Evaluator 仅新增报告及证据；未修改产品、原仓、`progress.json`、status/gate，未 push、部署或操作生产环境。
