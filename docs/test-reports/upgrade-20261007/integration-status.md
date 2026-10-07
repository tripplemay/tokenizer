# 升级候选集成状态（非发布验收）

## 基线与状态机边界

- 原仓 `main` 仍为 `2074991717abaf3cb34d9aad894bcd4357fefbc3`。原 worktree 预存大量 mode-only 工作区变更，本集成树未读取/覆盖这些改动。编排者仅推送了 B04/B05 非 main 验证分支；没有 push main 或生产部署。
- 2026-10-07 16:54 UTC 对 `https://token.vpanel.cc/api/health` 的只读请求返回 `ok=true`、`commit=92d410c6d0bd7fbb9ca4bdb0d984936c0a1db2a1`；它比远端 main 少一个仅文档 commit `2074991`。这只确认公开 health 与当前 source revision，**不**证明真实登录业务、生产 image digest、恢复点或 F005 验收。
- 与该生产 commit 对应的旧 GitHub push run `35017447796` 整体为 failure（Windows Verify failed），但旧 Deploy job 为 success；这证明以往部署门槛未等待 Windows 成功，不能把既有生产状态当成本次 B01/B04 验收依据。
- `progress.json.status=verifying`、`current_sprint=BL-HOMEPAGE-FRESHNESS`；`features.json` F005 仍 `pending`，`pending_gate=null`。当前升级修复采用独立 hotfix 候选树，**不冒充旧批次 F005 签收**，不写 `pending_gate.decision`。
- 2026-10-07 工程审查 verdict SHA-256：`349e790bf942ba727c1836be4aa2fa907baa75d7893c27b9cad694fbe6a767d5`；前端审查 verdict SHA-256：`035e60450f48b2921bbb00f08aedd5c1e41c2247147e07896ac1b8f189e077cd`。两份原始报告各留在独立审查 worktree，未改写。

## 已回流至本隔离树的候选

| 范围 | 集成 commit | 生成/独立评估 | 仍未满足 |
| --- | --- | --- | --- |
| R02 Git remote 三层脱敏 | `48efe92` | Generator `b7e4cef`；独立 R02 verdict `PASS`，见 `/tmp/tokenizer-r02-eval.4MEIQ7/docs/test-reports/R02-git-privacy-evaluator-verdict-2026-10-07.json` | 历史 queue/DB 备份与清理、跨版本仓库身份迁移、生产 Agent |
| FR-001/007 首次使用与历史空窗 | `b79c0b0` | Generator `f5f3718`；独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-b10-first-use-eval-20261007/docs/test-reports/BL-UPGRADE-FR-FIRST-USE-evaluator-verdict-20261007.json` | 离线恢复、F005 原批次生产验收、B10 剩余认证闭环 |
| R05/B09 可变成本缓存切片 | `106b7fd` + `0a9308a` + replay 修正 `f225652`/`b0ac3ce` | Generator `1925f7d` + `0ccacd8`；二轮独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-cost-cache-eval-20261007/docs/test-reports/B09-usage-cost-cache-20261007/evaluator-verdict-round2.json`；组合树真实 PG/Next replay 通过 | B06/B08 前置、生产多实例、外部直接 DB 写入首次请求可能 stale |
| B01 CI 基础门禁与 SIGTERM 修复 | `6aeabce` + `fc957f2`/`2817730`/`9392919`/`bdd4730` + 独立报告 `03eee41` | CI 基础二轮独立 verdict `PASS_WITH_LIMITATIONS`；SIGTERM 独立 verdict `PASS_FOR_SAFE_BRANCH_CI`；B05/B02/B01 组合 SHA `3ade5d1` 的 GitHub run `37645682850` Linux、Windows owner、PG16、浏览器四项成功 | Agent 原生安装矩阵、B05 OCI 恢复与完整发布仍未满足 |
| B02 安全依赖与认证配置 | `d8faf07` + 集成修正 `5b3a8be` | Generator `4b67b2e`；独立 verdict `PASS_WITH_LIMITATIONS` 且 `release_ready=false`，见 `tokenizer-b02-evaluator-20261007/docs/test-reports/B02-security-evaluator-20261007/verdict.json`；组合树 Node 22 clean install、verify/lint/test/build、Playwright 3/3 | 真实邮件/session/双租户 PG、剩余依赖风险人类处置、Linux Docker；公共 health 未证明 Auth.js 配置就绪 |
| B03/R06 默认采集最小化 | `0517260` + 组合 canary `dd1eb90` | Generator `1967242`；独立 round2 verdict `PASS_WITH_LIMITATIONS`，见 `/private/tmp/tokenizer-b03-eval.vFpv2h/docs/test-reports/M1-B03-R06-evaluator-round2-verdict.json`；组合树真实 Claude 源→队列→HTTP→PG→认证 API/UI 双租户 canary 通过，DB/日志敏感 canary 0 命中；全量 1515/22 skip、verify/lint/build PASS | 历史数据审批清理、限时 diagnostic opt-in、旧 Agent wire 暴露与路径型 ID 迁移；backlog/scope 语义后续切片单列 |
| B03 隐私规则前向生效与积压 admission 切片 | `9ccb08b` + 独立报告 `8868d23` | Generator `deca956`；独立 verdict `PASS_WITH_LIMITATIONS`，见 `docs/test-reports/B03-scope-admission-independent-20261007/verdict.json`；真实 CLI baseline 负控积压 1→0，修复后 1→1；本树合并 B01 后 Node22 全量 1586 pass/22 skip，verify/lint PASS | `tokenizer replay` 未实现，历史规则外数据仅有非执行规格；diagnostic 到期、历史清理、路径身份迁移、生产 canary 待办 |
| B02 Next 16 安全依赖闭环 | `217b9de` + Evaluator 产物 `f358a3b`/`f92a884` | Generator `305201e`；独立 verdict `PASS_WITH_RELEASE_BLOCKERS`，见 `docs/test-reports/B02-security-next16-evaluator-20261007/verdict.json`；组合树 Node 22 clean install、verify/lint/build、全量 1518/22 skip、PG16 Playwright 3/3 及 B09 双租户真实 Next/PG 可变成本 replay 通过 | 全依赖 dev/build/test 审计仍 2 Critical/10 High/4 Moderate；真实邮件/生产密钥及后续业务包未完成 |
| B02 构建依赖审计分诊（仅证据） | `86d5659` | 独立只读报告 `docs/test-reports/B02-dev-dependency-triage-20261007/`；最小升级模拟 Node 22 install/verify/lint/full test/build 通过，审计由 2 Critical/10 High/4 Moderate 降至 0 Critical/7 High/0 Moderate | 7 High 均追溯至未有上游修复版本的 `braces@3.0.3`；模拟未改本树依赖，禁止据此宣称 B02 完成或发布放行 |
| B02 `braces` 修复路线分析（仅证据） | `1f185d6` | `docs/test-reports/B02-braces-route-decision-20261007/` 记录构建调用跟踪、深层输入负控和非官方 fork 模拟 | 非官方 fork 直接 AST 仍可触发 `RangeError`，其版本绕过 advisory 不能算权威修复；无条件采用被否决，B02 发布门仍阻断 |
| B04 Agent 安装/回退候选与 Windows CI fixture | `67966e9`–`017349b` + 独立报告 `50af1aa`/`1ab3054` | Run `37651552909` 的 Linux、Windows 原生 fixture、PG16、认证浏览器均成功，Deploy skipped；独立 round4 verdict `PASS_CI_GATE_ONLY`，见 `docs/test-reports/B04-agent-release-evaluator-round4-20261007/verdict.json` | 完整 Agent release=`NOT_READY`：manifest/tag、native macOS launchd、真实 Windows Task Scheduler 与故障矩阵未闭环；不得 push main |

本树 `d8faf07`（B01+B02 合并后）以 Node 22 执行 `npm ci`、verify、lint、build 与全量 `npm run test` 均通过：**1500 通过、22 跳过**。组合树 scratch PG16 的 28 项迁移成功；B01 数据库 opt-in 探针 **48/48、0 skip**，锁定框架 `027c369` 的双向契约 **6/6、0 skip**。`5b3a8be` 上本地 PG16 + 生产 Next + 合成认证 Playwright 关键旅程 **3/3 通过**。第一次 B02 组合 E2E 因缺少 `AUTH_RESEND_KEY` 正确失败；补测试专用值后复测通过。B03/R06 合并后 Node 22 全量 **1515 通过、22 跳过**，verify/lint/build 通过；B04 仍在隔离树。更新后的真实原生 CI 结果见下方发布门槛段。

## 发布门槛

用户已在 2026-10-07 明确选择继续修复 B02 的 Next 内嵌 PostCSS High 与 next-intl Moderate 后再发布，**不接受本轮残留依赖风险作为放行理由**。因此 B02 独立 verdict 的 `release_ready=false` 必须保持，直到修复版依赖树、功能回归与独立复验有实物证据。

B02 修复版已回流候选树：独立 Evaluator 在原候选验证生产依赖审计 0 Critical/High/Moderate、PG16 双租户 Auth.js/magic-link、Chromium 渲染及 Node 22 三次全量通过；含 dev 依赖的审计仍是 2 Critical/10 High/4 Moderate，属于构建/CI 风险，不能称整体零漏洞。本树集成时保持 B09 的 `invalidateModelPricesCache()` 包装，按 Next 16 的第二参数契约更新 model-price 和 usage-cost tag invalidation。组合树验证 Node 22 全量 1518/22 skip、PG16 迁移 28 项/Playwright 3/3。B09 replay 首次失败是 scratch PostgreSQL 数据库会话 `Asia/Jakarta` 与项目 UTC 约束冲突；仅将隔离 `tokenizer_b09_cache` 数据库设为 UTC，并将测试专用 `ADMIN_TOKEN`/`AUTH_RESEND_KEY` 更新为 B02 强配置要求后重跑通过，覆盖 $2.50→$5.00→$7.50→$15.00→删除 $10.00→legacy 清理 $20.00、双租户 404。该结果不代替生产或 GitHub CI。

用户已确认 B03 隐私行为：`local-only` 切回 `sync` 后自动上传本机积压事件；include/exclude 规则修改只对后续采集生效，历史事件仅通过单独有界回扫。后续 UI/CLI 需显式呈现积压数量及回扫入口，不得把 `projectRoots` 当作采集白名单。

当前没有生产部署或发布验收。B01/B02/B05 组合分支 `codex/b05-next16-b01-ci-20261007` 的真实 GitHub Actions run `37645682850` 已通过 Linux verify、Windows owner、PG16、认证浏览器和双向契约，但 Linux OCI/recovery job 在首次 PostgreSQL 初始化后 `pg_restore` 报 `database system is shutting down` 而失败。TCP readiness 修正分支 `codex/b05-tcp-readiness-ci-20261007` 的 run `37650581332` 五个验证 job 全通过（包含 OCI 备份、恢复、旧版/候选/回退 canary），但 `.releases/` 隐藏目录未被 `upload-artifact` 默认采集，实际**没有留存 recovery artifact**；独立 verdict 因证据门槛阻断，修复中。B04 第三次非 main CI run `37651552909` Linux、Windows 原生 fixture、PG16、认证浏览器全通过，Deploy 跳过；独立复核进行中，发布矩阵仍未闭环。B02 本树构建/开发依赖图仍有 2 Critical/10 High/4 Moderate，修复模拟残留 7 High 不能放行；M1-M7 余下工作、独立 F005/人闸门、备份恢复与真实生产健康检查仍需后续分包完成。用户已指定本主会话兼任发布编排者；子 agent 仍不得推送。主会话只会在所有发布闸门满足后考虑 push-main。

B04 补丁候选 `c8c79cf` 二轮独立 verdict 为 `BLOCK/NOT_READY`，见 `tokenizer-b04-agent-release-eval-r2-20261007/docs/test-reports/B04-agent-release-evaluator-round2-20261007/verdict.json`。随后 Windows 原生 fixture 修正 `62dba5a` 的 run `37647920920` 暴露测试预加载路径空格/反斜杠问题；测试专用修正 `26607f5` 的 run `37651552909` Windows 原生安装/升级/离线回退 fixture 通过，原有 5 项失败亦已清零。最终 manifest pin/tag、macOS launchd 与真实服务故障矩阵仍未完成。B05 round3 独立 verdict 为 `PASS_WITH_LIMITATIONS` 且 `release_ready=false`，见 `tokenizer-b05-round3-eval-20261007/docs/test-reports/M1-B05-R13-round3-evaluator-verdict.json`；TCP 修正 `fff9d37` 的独立补评估见 `tokenizer-b05-tcp-readiness-independent-20261007`，结论因 release artifact 缺失维持 `BLOCKED`。不得将 CI 绿灯等同发布证据留存或生产验收。

B05 证据留存候选 `ec3348e` 的非 main run `37653910013` 在 OCI/recovery job 启动前失败：Linux Verify 1 项、Windows 3 项均为历史 evaluator active test 使用新 checkout 不具备的 `git show` 对象路径；PG16、认证浏览器成功，OCI 和 Deploy 跳过，未生成 recovery artifact。独立复核另发现旧 evaluator 的 `SHA256SUMS` 包含被候选改过的 active test，导致旧证据清单不再自洽。正在做窄范围 CI 可移植性修复；旧报告/verdict/证据字节必须保持不变，且新回归不得降低原脚本/回退不变量覆盖。该失败不能归为 OCI 修复已通过。

后续 B05 candidate `6164b4e` 的非 main run `37656417182` 已终态 success：Verify、native Windows、PG16、认证浏览器、Linux OCI/recovery 五个 job 成功，Deploy skipped。GitHub artifact API 确认 `release-recovery-6164b4e29922dbce685d01bf2c4c9d41428c9a08` 存在且未过期；编排者下载后运行候选 `recovery-evidence.mjs verify` 成功，文件精确为合成 dump、checksum、rehearsal、rollback-approved、manifest；ledger 显示 `mode=synthetic`、`rollback=passed`。这修复的是**非 main CI 合成证据留存门**；独立复评、main-only GHCR attestation/负控、真实生产前驱 digest/备份恢复/部署仍未完成，不是 B05 发布放行。
