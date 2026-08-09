# BL-REPO-MECH — 双仓机械化：解冻部署 + 契约 fixture/CI + paths-ignore 修正 + ADR

> 状态：planning 定稿 · 2026-08-09 · Planner=Coordinator（v2 签名 bindings：planner=null）
> 详细依据：`docs/analysis/2026-08-08-repo-strategy/batch-plans/BL-REPO-MECH.md`（规划期已实地核对全部代码路径）
> 战略来源：keep-separate 裁决（`docs/analysis/2026-08-08-repo-strategy/README.md` §2-§3，用户 2026-08-08 确认）

## 1. 背景与目标

1. 🔴 **main 部署管道当前冻结**：`tests/shared/framework-version.test.ts:24-27` 与 `tests/shared/mode-badges.test.ts:29-51` 硬编码 "1.7.0"，v1.7.1 升级（`7eda92e`）走 paths-ignore 未跑 CI，实跑 `7 failed | 14 passed`。任何产品 push → verify 红 → deploy 被 `needs: verify` 拦。
2. 双仓闸门/mode-intent 契约两侧（tokenizer `app/api/harness/*` ↔ 模板仓 `templates/claude/console/*`）无机械保障，靠 harness-console-demo 人工演练兜底。
3. `deploy-vps.yml` paths-ignore 与 CLAUDE.md 表述不一致（实际无 `*.md` 全局豁免），`docs/analysis/**` 推送会误触发生产部署，战略分析材料因此滞留未提交。
4. keep-separate 裁决尚未固化为 ADR。

目标：F003 解冻部署并根治版本测试税；F001/F002 把跨仓契约从「隐性耦合」变为「每次 push 机械校验」；F004 修正部署触发面；F005 固化 ADR。

## 2. Features（全部 executor:generator，普通批次）

### F003 · 版本耦合测试去税（含修当前 7 红）——【执行序第一】
- 两个测试文件的「当前最新版本」期望值改从 `framework/harness/framework-releases.json` 镜像动态派生（latest=manifest 末项，behind 用例取倒数第二项）；历史锚点字面量（如 "1.0.3"）保留。
- acceptance：①两文件测试全绿（基线 7 failed）；②`npm run test` 全量绿；③grep 无「当前最新版本」硬编码；④假版本注入验证：manifest fixture 追加假版本后测试仍绿（证明「上游发版只 sync 不改测试」成立）。

### F001 · 上游 contract-fixtures + 框架 v1.8.0 发版（跨仓：/Users/yixingzhou/project/harness-template）
- 新增 `contract-fixtures/`：fixtures.json 清单 + canonical-json 测试向量（**必须含非 ASCII/中文用例**、嵌套 scope 递归排序、空对象边界）+ pending-gate 与 mode-intent 的 valid/invalid 金标签名载荷 + TEST-ONLY 测试密钥对；新增 `scripts/validate-contract-fixtures.py` + 测试；`release-contract.yml` 接入。
- 发布三件套：VERSION 1.7.1→**1.8.0** + CHANGELOG + framework-releases.json 追加，三向一致。
- acceptance：①validate-contract-fixtures.py 退出 0 且 schema 快照与 `templates/claude/console/*.schema.json` sha256 一致；②canonicalJson 向量 Python 侧逐字节复算通过；③金标签名 openssl 全验过、invalid 全被拒；④release-contract 校验器 + 测试通过；⑤本地 clone 缺失的 `v1.7.1` tag 一并补打（push 与 tag 由人类执行，见 §4）。

### F002 · tokenizer 契约一致性 CI + 框架同步 v1.8.0
- `bash .claude/harness.sh sync --from /Users/yixingzhou/project/harness-template`（codex.json 唯一定制文件走 resolve 保留，先例 `e59c822`）。
- 新增 `tests/contract/`：canonical-json 向量逐字节断言、Node 签发→框架验签器 E2E（`validate-pending-gate.sh`/`validate-mode-intent.sh`）、框架 fixture 灌服务端解析器（valid 全收 invalid 全拒）；`CONTRACT_FIXTURES_DIR` 未设置时显式 skip（`npm run test` 全量不受影响）。
- 新增 `.github/workflows/contract-conformance.yml`（独立 workflow，不进 deploy 关键路径；paths 圈定契约面 + workflow_dispatch；clone 后 `git checkout $(jq -r .framework.commit harness.json)`——短 sha 不能用 actions/checkout ref）。**已核实模板仓为公开仓（API 200），无需 PAT。**
- acceptance：①本机设 env 后 `npx vitest run tests/contract/` 全绿、未设 env 显式 skip；②双向契约各含中文 note + 嵌套 scope 用例；③`harness.sh verify` 对账全 ok 且 version=1.8.0、codex.json 定制保留；④workflow YAML 合法（Actions 实跑绿属 push 后验证，验收时以 workflow_dispatch 实测）。

### F004 · paths-ignore 扩 docs/** + CLAUDE.md 表述修正
- `deploy-vps.yml:12-15` 三条 docs 子目录替换为 `docs/**`（已 grep 核实 src/、app/ 无 docs/ 运行时读取）；CLAUDE.md「`*.md` 已列入 paths-ignore」误述改为与 workflow 逐条一致的准确清单。
- acceptance：①YAML 合法；②CLAUDE.md 与 paths-ignore 逐条对得上；③合入后实测 docs-only push 不触发 Deploy VPS run（以提交 `docs/analysis/2026-08-08-repo-strategy/` 全目录作为实测载荷，顺带完成战略材料入库）；④pull_request 与 workflow_dispatch 行为不变。

### F005 · keep-separate 正式 ADR
- 新增 `docs/adr/0001-keep-separate-repos.md`：Status(Accepted)/Date/Context/Decision/Consequences + 三视角评审得分（0.85/0.80/0.72）+ 六条论据带仓库证据引用 + 三件机械化替代方案 + hybrid 出口条款；链接分析目录与本 spec。
- acceptance：①标准段落齐备；②论据逐条带证据引用；③与 F004 同一个 push（F004 生效前单独推会白烧一次部署）。

## 3. 关键决策（Planner 裁决）

| # | 决策 | 依据 |
|---|---|---|
| 1 | 执行序：F003 → F001 → F002 → F004 → F005；F002 依赖 F001 产物 | F003 解冻最紧急且独立；先例 BL-FW-RELEASE-CONTRACT「源仓发布依赖，串行执行」 |
| 2 | tokenizer 侧**单次 push**（含全部 5 个 feature 的 commit，必含 F003），触发恰一次生产部署；运行时零行为变化（改动全在测试/CI/文档面），部署后照常核对 `/api/health` | batch-plans 部署打包策略；deploy-vps.yml `concurrency` 串行保护 |
| 3 | Generator **不得 push、不得打 tag**（沙箱 `constraints.push=false` 锁死）；上游仓 push + tag（v1.8.0、补 v1.7.1）与 tokenizer push main 均由人类确认后执行 | 先例 BL-FW-RELEASE-CONTRACT §5：闸门批准不含 push/tag/release/部署授权 |
| 4 | 模板仓公开（无需 PAT）；contract CI 独立 workflow 不阻塞与契约无关的部署 | 本次 planning 实测 API 200 |
| 5 | 框架版本定 v1.8.0（minor，新增能力）；STEERING 批次将用下一个 minor | implementation-plan.md §2 序列规则 |
| 6 | 测试密钥对 TEST-ONLY 显著标注，validator 校验其不与消费仓 console.pub 惯例混淆 | batch-plans 风险节 |

## 4. 编排与闸门

- **Generator**：`local-cli--codex--generator`（v2 resolution，provenance `92e2e2aa…`）。独立 worktree、env 白名单、禁 push、wall-clock 封顶（四道锁）；F001 属源仓本地实现，仿 BL-FW-RELEASE-CONTRACT「仅允许 source/consumer 的本地实现」先例。
- **spec-lock critic**：`.github/workflows/**`、`CLAUDE.md` 属敏感文件，diff 必须过 spec-lock 稽核且映射本 spec 的 F002/F004。
- **Evaluator**：`local-cli--kimi--evaluator`（fresh context，family 与 generator 互斥）。验收要点：F003 的 7 红→绿全量实跑；双向契约测试实跑（含篡改一字节必拒的负向）；假版本注入去税验证；F004 的 docs-only push 实测（Actions run 列表核对）；ADR 完整性；`npm run verify`/`lint`/`test`/`build` 全绿。
- **闸门**：`verifying → done` 走 Class B 人工 `phase_advance` 闸门；批准不含 push/tag/release/部署授权（各为独立人类动作）。

## 5. 用户交接事项（人类手动）

1. F001 完成并验收后：模板仓 `git push` + `git push --tags`（v1.8.0 + 补 v1.7.1）。
2. tokenizer 侧唯一一次 `git push origin main`（触发一次部署，盯 `/api/health`）。
3. F002 的 contract-conformance 在 GitHub Actions 实跑绿之后：删除 `/Users/yixingzhou/project/harness-console-demo`（演练职能已被 CI 取代）。
