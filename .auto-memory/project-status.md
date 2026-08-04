---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-NATIVE-SUBAGENT-BRIDGES（reverifying，1/5，fix_rounds=1）**：fixing 完成于 2026-08-04。根因是 vm-v1 provider 的 limactl 子进程缺 HOME（Go 直接 panic），所有已安装 runtime 被误判 not running；ff896dd 修复后目录三角色发布 kimi subagent，target 带 bridge provenance 与 execution_provenance_sha256。
- 本机环境同步完成：provider.json 移除过时 image_location、bundle manifest 移除死键 kimi_identity（备份 *.bak-20260804）、~/.tokenizer/app 应用包已同步 provider 修复；`limactl` harness-vm-v1 VM Running，doctor available:true。
- F003 receipt nonce_sha256 与凭据隔离（私有空 KIMI_CODE_HOME）、F004 TS 侧 proof-gated 可选性均已在 c5fe6be 落地；待 fresh-context 复验。
- L1 全绿：vitest 63 files / 971 passed / 4 skipped，framework 聚焦套件全 OK（test-tool-catalog 已补宿主机 provider 隔离）。
- 原始 fan-out 与复核证据：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-fanout-2026-08-01.json`；schema verdict：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-verdict.json`。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。

## 已知边界

- strict-provider 冲突已按 FIX1 裁决（`docs/specs/BL-NATIVE-SUBAGENT-BRIDGES-FIX1-strict-provider-adjudication.md`，#1-#4 全 A）：vm-v1 provider 严格路线，实现主体见 c5fe6be；无可 attest provider 时目录隐藏属预期 fail-closed。
- 用户已于 2026-08-04 授权 F005 L2：Kimi 真实 parent-child probe（brokered auth、不暴露 host credential、不写源码）+ Codex 仅 local-cli health，证据脱敏结构化落盘。
- 2026-08-02 遗留的 capability-9 工作已登记 backlog `BL-AGENT-SINGLE-INSTANCE-LIFECYCLE` 并本地提交，不并入本批；**该提交未推送——push main 触发生产部署 + DB 迁移，推送时机由用户决定**。
- 当前没有 done 人工闸门，也没有 mode intent。
