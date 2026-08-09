# BL-REPO-MECH 批次签发报告（signoff）

- 批次：BL-REPO-MECH —— 双仓机械化：解冻部署 + 契约 fixture/CI + paths-ignore 修正 + ADR
- 规格：`docs/specs/BL-REPO-MECH-spec.md`
- 签发日期：2026-08-09（fix_round=1 复核完成后）
- 验收机件：`docs/test-reports/BL-REPO-MECH-verdict.json`（fix_round=1，本报告唯一结论来源）

## 总结论

**5/5 全部 PASS，批次可签发。** round 0 为 4 PASS + F004 PARTIAL（唯一缺口：acceptance ③ 的 docs-only push 实验当时尚未发生）；fix_round=1 针对该单项复核，实验已由人类补做且证据闭环，F004 升为 PASS。

| Feature | 最终结果 | 轮次 | 内容 |
|---|---|---|---|
| F001 | PASS | round 0 沿用 | 上游 contract-fixtures + 框架 v1.8.0 发版 |
| F002 | PASS | round 0 沿用 | tokenizer 契约一致性 CI + 框架同步 v1.8.0 |
| F003 | PASS | round 0 沿用 | 版本耦合测试去税（7 红→全绿） |
| F004 | PASS | **fix_round=1** | paths-ignore 扩 docs/** + CLAUDE.md 表述修正 |
| F005 | PASS | round 0 沿用 | keep-separate 正式 ADR |

## 各 feature 证据指针

### F001 · PASS（round 0 验收，本轮未重跑）
- 证据：上游 `/Users/yixingzhou/project/harness-template` @4ac7a6f 实核——`validate-contract-fixtures.py` 退出 0（schema 快照 sha256 逐条比对 + 金标重放 valid 全过/invalid 全拒）；`test-contract-fixtures.py` 6 tests OK（含五路负向钉子）；VERSION/CHANGELOG/framework-releases.json 三向一致于 1.8.0；tag v1.7.1/v1.7.2/v1.8.0 齐备。
- 指针：verdict.json → F001.evidence / steps_to_reproduce。

### F002 · PASS（round 0 验收，本轮未重跑）
- 证据：`tests/contract/` 设 env 6/6 绿、未设 env 显式 skip 且全量 1013 passed 不受影响；双向契约含中文 note + 嵌套 scope，篡改一字节必拒；`harness.sh verify` ok 223 / version=1.8.0 / codex.json 定制保留；contract-conformance.yml Actions 实跑 run 31300526608 success；`npm run verify`/`lint` exit 0。
- 指针：verdict.json → F002.evidence / steps_to_reproduce。

### F003 · PASS（round 0 验收，本轮未重跑）
- 证据：两目标文件 21/21 绿（基线 7 红消除）；全量 1013 passed；无当前版本硬编码（期望值从 framework-releases.json 派生）；假版本注入 1.9.0 后仍 21/21 绿——「上游发版只 sync 不改测试」成立。
- 指针：verdict.json → F003.evidence / steps_to_reproduce。

### F004 · PASS（fix_round=1 本轮复核）
- round 0 缺口：③docs-only push 未以独立 push 发生（战略材料随混合批次 001ecd9→e5f6572 出库，Deploy VPS run 31300526619 正确触发）。
- 本轮新证（未认证 GitHub API 实查 + 本地 reverify ref 30e098b 实查）：
  1. push 事件存在：2026-08-09T07:36:16Z PushEvent before=`e5f6572`→head=`f31e21b`（events API）。
  2. compare `e5f6572...f31e21b`：1 commit、4 文件（`docs/analysis/.../implementation-plan.md`、`docs/test-reports/BL-REPO-MECH-verdict.json`、`features.json`、`progress.json`）——4/4 全在 deploy-vps.yml paths-ignore 豁免清单内。
  3. workflows API 列出 Deploy VPS（id 277525598，active）；其 runs 端点最新 run 为 31300526619（head_sha=`e5f6572`，07:10:04Z），**无任何 head_sha 新于 e5f6572 的 run**——`f31e21b` 及后续 `30e098b` 两次纯豁免 push 均零新增 Deploy run。
  4. 本地：HEAD=`30e098b`，`.github/workflows/deploy-vps.yml:15` 仍含 `- "docs/**"`；`git diff e5f6572..HEAD` 不触 `.github/` 与 `CLAUDE.md`，round 0 的 ①②④ 结论（YAML 合法、清单 17/17 一致、PR/dispatch 行为不变）原样成立。
- 指针：verdict.json → F004.evidence / steps_to_reproduce（含全部 curl 命令）。

### F005 · PASS（round 0 验收，本轮未重跑）
- 证据：`docs/adr/0001-keep-separate-repos.md` 标准段落齐备（Accepted/2026-08-09/Context/Decision/Consequences + hybrid 出口）；三视角得分 0.85/0.80/0.72 与 judges.json 逐笔一致；六条 Decision drivers 带仓库证据引用且抽查忠实；24 个相对链接 0 缺失；与 F004 同一 push（07:10:02Z 001ecd9→e5f6572）。
- 指针：verdict.json → F005.evidence / steps_to_reproduce。

## 存量观察（不阻塞签发，沿 round 0 记录）

- Deploy VPS run 31300526619 的 Verify (Windows) 在 Run unit tests 步 failure，与批次前 run 31093273152（2026-08-06）失败签名完全相同，判为存量 Windows 问题而非本批次回归；Linux Verify + Deploy 均绿。建议另开批次处理。

## 交接事项状态（spec §5）

1. 模板仓 push + tags（v1.8.0、补 v1.7.1）——round 0 已确认完成（tag 实核在册）。
2. tokenizer 唯一一次产品面 push——07:10:02Z 完成，部署后 run 结论见上（Linux 链绿）。
3. contract-conformance 实跑绿后删除 `/Users/yixingzhou/project/harness-console-demo`——CI 已绿（run 31300526608），删除动作属人类决定，不在本批次验收面内。
