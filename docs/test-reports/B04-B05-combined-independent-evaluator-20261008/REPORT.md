# B04+B05 组合候选技术预审（2026-10-08）

> 本文是同为 Codex model family 的只读技术预审，不是 Harness v1.1 所要求的异家族正式 Evaluator verdict，也不构成发布放行或风险接受。

## 结论

- 候选：`3cce52e360b81715c3c54752b77575b445cd46f2`（基于 `55a58cb` 的 B04+B05 组合）。
- **safe-branch CI readiness：BLOCK。** 精确 SHA 的 run `37659301770` 终态为 `failure`。Linux Verify、PostgreSQL 16、authenticated browser 成功；Windows 原生 installer 单项成功，但 Windows full suite 因历史证据在 CRLF checkout 后不再 byte-identical 而失败。依赖该 job 的 Linux OCI/recovery 被跳过。
- **production readiness：NOT_READY。** Deploy 正确地被跳过；本次没有生成/验证真实 GHCR digest、GitHub attestation、Ubuntu amd64 OCI recovery、真实 predecessor image compatibility，也未执行生产部署和部署后验收。
- 源码预审未发现 B04/B05 组合造成的 gate 弱化。`3cce52e` 唯一测试断言变更把 Deploy 的 expected `needs` 从三项更新为实际五项，是加强而非绕过。

后续修正观测（不是对原 SHA 改判）：完整三条 attributes 已落在 `8877a592d21305f03cdaea5d874d58a581e910a1`，safe run `37660385870` 终态 success。Linux、Windows、PG16、authenticated browser、Linux OCI/recovery 均成功，Deploy 因非 main 分支正确 skipped。因此 **`8877a59` 的技术性 safe-branch CI 条件已具备**；这仍不是异家族正式验收，production 仍为 `NOT_READY`。

## 阻断发现

### P1 — Windows checkout 改写不可变证据字节，组合 CI 失败

`tests/evaluator/b05-evidence-retention-round2.test.ts:28-40` 要求九项历史对象和历史 test SHA 原始字节保持一致。候选没有 `.gitattributes`；Windows runner checkout 将 LF 文本转换为 CRLF，manifest 的严格正则在首行即失败：

- run `37659301770`、head SHA 与候选完全一致；Windows `Run unit tests` 为 failure。
- 失败为 `tests/evaluator/b05-evidence-retention-round2.test.ts:30`，`expected null not to be null`。
- Windows 汇总：`1 failed / 1655 passed / 61 skipped`。
- `Linux OCI and recovery rehearsal=skipped`；`Deploy=skipped`。

这不是产品运行时缺陷，但它是精确候选的真实跨平台 release-gate 阻断，不能用 macOS/Linux 本地绿灯替代。

### 建议修复：path-scoped `-text`，不要在测试内 normalize

适合 byte-identical invariant 的最小规则是：

```gitattributes
docs/test-reports/B05-tcp-readiness-independent-20261007/evidence/** -text
scripts/test/b05-tcp-readiness-independent.mjs -text
tests/evaluator/b05-tcp-readiness-independent.test.ts -text
```

理由：

1. `-text` 禁止 checkout/checkin EOL 转换，验证的仍是仓库中原始字节；测试内剥离 `\r` 或对待 hash 内容 normalize 会把“byte-identical”降级成“语义相似”。
2. 范围仅覆盖不可变历史证据、其独立 runner 和历史 test，不改变仓库其余文本的 Windows 行尾策略。
3. 独立 `core.autocrlf=true` 双 checkout 模拟结果：无 attributes 时严格 manifest 行 `1/9`、历史 hash `0/9`、test SHA 错；完整三条规则后为 `9/9`、`9/9`、test SHA 正确。
4. 后续 SHA `8546afa` 的两条规则仍漏掉 manifest 第 8 项 `scripts/test/b05-tcp-readiness-independent.mjs`；模拟为 `8/9`，因此该 SHA 本身也不能作为修复证明。必须补第三条并在原生 Windows 完整重跑。

完整修复后的 `8877a59` 已完成上述原生重跑：Windows full suite、owner force-termination 和 `install.ps1` syntax 全部成功。

## 组合与门禁审计

### B04 Windows

- `.github/workflows/deploy-vps.yml:122-181` 保留 Windows Node 22 job、原生 pinned-installer exact test、JSON fail-closed gate、full suite、owner force-termination gate 和 `install.ps1` syntax check。
- 原生 run 中 `tests/cli/agent-release-installer-windows.test.ts` 为 `1/1 passed`（24.865s），覆盖 fresh install、故障非零、并发、升级、offline rollback 和 enrollment-token 不泄露。
- fixture 使用真实 `node.exe`，并通过 slash-normalized `NODE_OPTIONS --require` 避免此前 backslash 被剥离；对应负控继续保留。
- 因 full suite 先失败，owner force-termination 与 `install.ps1` syntax 两步被跳过；所以不能把本 run 写成 B04 Windows 全门禁通过。

### B05 recovery / provenance

- `release-artifact` 依赖 `verify`、`verify-windows`、`verify-db`、`verify-browser`；Deploy 又依赖这四项和 `release-artifact`，未发现依赖削弱。
- 源码继续要求 digest-pinned app/migrate images、distinct predecessor、非 bootstrap fail-closed、old-image compatibility rehearsal、TCP `pg_isready -h 127.0.0.1`、错误 source SHA / workflow provenance 负控，以及 Deploy 的 `attestations: read`。
- 本地独立 focused suite 为 `113/113`；TCP runner证明正常路径使用四次 TCP probe，source/restore 永不 ready 时均无 stale rollback gate 且完成 cleanup。
- 但本次 CI 在 release-artifact 之前停止，因此源码检查和模拟测试不能替代真实 Ubuntu amd64 OCI build、local-registry recovery 或 main-only GHCR/attestation。
- 后续 `8877a59` run 补齐了 safe-branch 的 Ubuntu amd64 OCI/local-registry recovery：候选和 predecessor 的 app/migrate build、backup/restore/migrate/old-image rehearsal、证据 staging/upload/download/hash verification 均成功。main-only login、attest、provenance verification 仍按设计 skipped，不能据此推断 GHCR/attestation 已验证。

### Integration-only 变更

`3cce52e` 只新增一份组合说明，并将 `tests/server/release-rehearsal.test.ts` 的 Deploy dependency 断言更新为：

```text
needs: [verify, verify-windows, verify-db, verify-browser, release-artifact]
```

该断言与 workflow 一致，增加 PostgreSQL/browser 前置条件，没有降低任何 gate。

## 独立执行结果

| 检查 | 结果 |
|---|---|
| `actionlint .github/workflows/deploy-vps.yml` | PASS |
| release shell `bash -n` | PASS |
| Node `v22.22.0` clean `npm ci` | PASS；672 packages，audit 仍报告 16 vulnerabilities，非本评估范围 |
| `npm run verify` / `npm run lint` | PASS / PASS |
| B04+B05 focused suite | 10 files，113/113 PASS |
| independent TCP readiness runner | PASS；正常/两项 never-ready 负控符合预期 |
| clean Node 22 full suite | 129 files passed、9 skipped；1694 passed、23 skipped |
| `NEXT_OUTPUT=standalone npm run build` + `verify-standalone` | PASS；31 files / 47,912 bytes outside dependencies and `.next` |
| Docker daemon | UNAVAILABLE；client 29.3.1，但指定 Colima socket 不存在 |

第一次 full-suite 尝试在 Node 22 下复用了此前 Node 25 `npm ci` 生成的 `better-sqlite3` ABI，产生 6 个 `NODE_MODULE_VERSION 141/127` 环境失败；已作废。重新以 Node 22 clean `npm ci` 后完整通过，保留两份日志以便审计。

## 边界与后续门槛

1. 精确候选 `3cce52e` 保持 **BLOCK**；不可将其本地 PASS 或部分 CI PASS 宣称为 safe-branch ready。
2. attributes 修复必须覆盖 manifest 内全部九项（尤其 `scripts/test/b05-tcp-readiness-independent.mjs`），并在新的精确 SHA 上完成原生 Windows full suite。
3. 同一个新 SHA 还必须让 Linux OCI/recovery job 成功；否则 B05 组合门禁仍未闭环。
4. safe-branch 即使全绿也只证明非 main local-registry 路径；真实 GHCR push、attestation issue/verify、保留旧镜像和生产发布仍需 main/生产门禁与部署后验收。
5. 由于本预审与 Generator 同属 Codex family，异家族 Evaluator 必须基于修复后的精确 SHA 独立给出正式 verdict。

上述第 2、3 项已由 `8877a59` / run `37660385870` 技术性满足。下载的 `release-recovery-8877a592d21305f03cdaea5d874d58a581e910a1` 包含严格 allowlist 的 5 个文件（manifest 有 4 项 recovery entry，外加 `manifest.json`）；本地再次执行 `recovery-evidence.mjs verify ... false` 成功。ledger 为 `mode=synthetic`、`restore_inventory=2|2|1|1|23`、`runtime_uid=1000`、`rollback=passed`。第 4、5 项仍未满足。

## 证据索引

- `evidence/safe-branch-run-37659301770.json`
- `evidence/safe-branch-run-37659301770-failed.log`
- `evidence/windows-native-gate-excerpt.log`
- `evidence/gitattributes-autocrlf-simulation.log`
- `evidence/gitattributes-8546afa-simulation.log`
- `evidence/focused-node22.log`
- `evidence/tcp-readiness-independent.log`
- `evidence/full-test-node22-clean.log`
- `evidence/build-standalone-node22.log`
- `evidence/verify-standalone.log`
- `evidence/decisive-evidence.txt`
- `evidence/followup-run-37660385870.json`
- `evidence/followup-run-37660385870-artifacts.json`
- `evidence/followup-run-37660385870-oci-excerpt.log`
- `evidence/followup-run-37660385870-downloaded-artifact-verify.log`
