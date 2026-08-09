# BL-REPO-MECH 落地方案

> 规划前实地核查发现一个**活体事故**，直接改变本批次的优先级排序：main 当前有 7 个测试是红的（`npx vitest run tests/shared/framework-version.test.ts tests/shared/mode-badges.test.ts` 实跑：`7 failed | 14 passed`）。成因：`7eda92e` 升级 v1.7.1 时只更新了 `framework/harness/framework-releases.json` 镜像（manifest 末项已是 1.7.1），但 `tests/shared/framework-version.test.ts:24-27` 与 `tests/shared/mode-badges.test.ts:29-51` 仍硬编码 "1.7.0"；而该 push 全部路径落在 paths-ignore 内，CI 根本没跑，红灯无人看见。**后果：当前任何触发 CI 的产品改动 push 都会 verify 失败 → deploy job（`deploy-vps.yml:118` `needs: verify`）被阻塞，生产部署管道实质冻结。** 这正是本批次③要消的「版本测试税」的最严重形态，F003 必须打头阵。

## 目标

把 keep-separate 裁决（战略分析 §0/§2）配套的「三件增量机械化」落成可运行的 CI 与测试，使双仓契约（闸门签名 / mode intent / canonicalJson）从「隐性耦合靠人记」变为「每次 push 机械校验」；同时修正 paths-ignore 与 CLAUDE.md 的不一致、把裁决固化为正式 ADR，并顺手解除当前 main 的 CI 红灯 / 部署冻结。

## 范围（In / Out）

**In：**
1. 上游 harness-template 新增 `contract-fixtures/`（schema 快照 + 金标签名载荷 + canonicalJson 测试向量），随发布契约版本化，release-contract CI 校验（F001）
2. tokenizer 新增 `contract-conformance` CI job + `tests/contract/` 双向契约测试，框架同步至上游新版本（F002）
3. 版本耦合测试去税 + 修当前 7 个红测试（F003）
4. `deploy-vps.yml` paths-ignore 扩 `docs/**` + CLAUDE.md「`*.md` 已豁免」误述修正（F004）
5. keep-separate 裁决写成 `docs/adr/0001-keep-separate-repos.md`（F005）

**Out（刻意不做）：**
- **「契约制品」独立小包**（schemas + canonicalJson + 类型的 npm 包）：战略分析 §3 明确这是未来 hybrid 出口，仅当控制台需要运行时 import 框架机件时才做；本批次 fixture 化已覆盖当下需求
- **upstream-first 补丁纪律的机械化**（如 codex.json 定制漂移的自动回流提醒）：属流程纪律，留给框架仓自身的 proposed-learnings 通道
- **框架仓的本机批量升级脚本**（9 消费仓扇出成本，摩擦点 7）：独立工具，留给未来框架仓批次
- **`docs/analysis/` 三处「存而不显」补显（dashboardUrl 等）**：属 BL-GATE-INBOX 批次（roadmap 近期表）
- **agent↔服务端协议任何改动**：本批次零触碰（详见协议节）
- harness-console-demo 删除本身：用户手动操作，本方案只列交接清单

## Features 预案

---

**F001 · 上游 contract-fixtures/ 与发布契约扩展 · executor: generator（跨仓：在 harness-template 仓执行）**

涉及文件（模板仓 `/Users/yixingzhou/project/harness-template/`）：
- 新增 `contract-fixtures/fixtures.json`（fixture 清单：所覆盖 framework version、文件枚举、schema 快照 sha）
- 新增 `contract-fixtures/canonical-json/vectors.json`（输入 JSON → 期望 canonical 字节串；**必须含非 ASCII 用例**——两侧契约是 Python `json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False)`（`templates/claude/console/validate-pending-gate.sh` 对应 tokenizer 安装副本 `:125`）对 Node `JSON.stringify` 不转义非 ASCII，中文 note 字段是真实载荷；另含嵌套 scope 递归排序、undefined 剔除、数组、空对象用例，对齐 tokenizer `tests/server/harness-sign.test.ts` 已钉的语义）
- 新增 `contract-fixtures/pending-gate/`（valid：带金标 `sig` 的完整 `progress.json` 样例若干；invalid：坏 gate_id / 篡改 decision / 缺 sig 等负向样例）
- 新增 `contract-fixtures/mode-intent/`（valid / invalid 的 `harness.json.project.mode_defaults` 样例，v2 role_bindings 形态）
- 新增 `contract-fixtures/keys/test-console.key` + `test-console.pub`（**TEST-ONLY 显著标注**，供金标签名可复算/可验证）
- 新增 `scripts/validate-contract-fixtures.py` + `tests/test-contract-fixtures.py`
- 修改 `.github/workflows/release-contract.yml`（paths 追加 `contract-fixtures/**` 与新脚本，steps 追加两条 run）
- 发布三件套：`VERSION`（1.7.1 → **1.8.0**，新增能力属 minor）+ `CHANGELOG.md` + `harness/framework-releases.json` 追加条目，push 后打 tag `v1.8.0`

acceptance：
1. `python3 scripts/validate-contract-fixtures.py` 退出 0，且校验：fixtures 内 schema 快照与 `templates/claude/console/{pending-gate,mode-intent}.schema.json` 逐字节一致（sha256 比对）
2. canonicalJson 向量：脚本用 Python 侧同款 dumps 复算每条 `expected`，逐字节相等（含非 ASCII 条目）
3. 金标签名：对每条 valid fixture 以 `openssl pkeyutl -verify -pubin -inkey contract-fixtures/keys/test-console.pub -rawin` 全部验过；invalid fixture 全部验不过或被 schema 拒
4. `python3 scripts/validate-framework-release-contract.py` + `python3 tests/test-framework-release-contract.py` 通过（VERSION == manifest 末项 == CHANGELOG 末项，v1.8.0 三向一致）
5. release-contract CI 在模板仓 push 后绿

---

**F002 · tokenizer 契约一致性 CI（含框架同步 v1.8.0） · executor: generator**

涉及文件（tokenizer）：
- `harness.json` / `harness.lock` / `framework/**` / `.claude/**`（`bash .claude/harness.sh sync --from /Users/yixingzhou/project/harness-template` 产物；注意 `.claude/dispatch/transports/adapters/codex.json` 是唯一有意定制文件，sync 需走 resolve 语义保住定制——reader-evolution §2）
- 新增 `tests/contract/canonical-json.contract.test.ts`（fixtures 向量 → `src/server/harness-sign.ts` 的 `canonicalJson`（`:31-38`）逐字节断言）
- 新增 `tests/contract/sign-verify.contract.test.ts`（方向①：临时 Ed25519 密钥对 → `signDecision`/`signHarnessPayload`（`harness-sign.ts:68-76`）签发 → 组装 progress.json / harness.json → 框架侧 `validate-pending-gate.sh schema|guard` 与 `validate-mode-intent.sh` 退出 0；openssl 探测复用 `tests/server/harness-sign.test.ts:24-41` 的 `findOpenSsl` 模式）
- 新增 `tests/contract/fixture-ingest.contract.test.ts`（方向②：框架 fixture 灌 tokenizer 解析层——`src/server/harness-mode-intent-api.ts` 的 `parseModeIntentSummary` / `parseModeDefaultsSummary` / `readBoundedJson`，及 `src/cli/harness.ts:500` 的 `verifyDecision` 中继验签；invalid fixture 必须全被拒）
- 新增 `.github/workflows/contract-conformance.yml`（独立 workflow，不塞进 deploy-vps.yml 的 verify job，避免契约测试挂掉阻塞与契约无关的部署；paths 过滤到契约面：`src/server/harness-sign.ts`、`src/server/harness-mode-intent-api.ts`、`src/cli/harness.ts`、`app/api/harness/**`、`.claude/console/**`、`harness.json`、`tests/contract/**`、workflow 自身，另加 `workflow_dispatch`）
- 可能的小幅重构：`src/cli/harness.ts` 的 `verifyDecision` 当前未 export（`:500` 为模块内函数）、`app/api/harness/report/route.ts` 的 gate 解析内嵌于 route（`:50-60` ParsedGate 类型附近）——如需直接可测则提取导出，**纯移动不改行为**（未核提取的确切函数边界，实现时定）

CI job 内 checkout 模板仓的机械步骤：`git clone https://github.com/tripplemay/harness-template.git` 后 `git checkout "$(jq -r .framework.commit harness.json)"`——**必须 clone 后 checkout，不能用 actions/checkout 的 ref**（`harness.json.framework.commit` 是短 sha `78756ab` 形态，ref 不收短 sha）。

acceptance：
1. `CONTRACT_FIXTURES_DIR=/Users/yixingzhou/project/harness-template/contract-fixtures npx vitest run tests/contract/` 本机全绿；未设置该 env 时 suite 显式 skip（`npm run test` 全量不受影响，CI verify job 不需要模板仓）
2. contract-conformance workflow 在 GitHub Actions 实跑一次绿（含 checkout 模板仓 @ harness.json 钉的 commit）
3. 方向①：服务端签发物过框架验签器（含带中文 note、带嵌套 scope 的载荷各至少 1 例）
4. 方向②：全部 valid fixture 被解析器接受、全部 invalid fixture 被拒（fail-closed 负向覆盖）
5. `bash .claude/harness.sh verify` 报告 managed 文件与 lock 一致，codex.json 定制保留（`harness.json.framework.version` == "1.8.0"）

---

**F003 · 版本耦合测试去税（含修当前 7 红） · executor: generator**

涉及文件：
- `tests/shared/framework-version.test.ts`（`:24-27` 硬编码 `"1.7.0"`、`:95-118` 的 latest/behind/ahead 字面量 → 改从 `framework/harness/framework-releases.json` 镜像动态派生：latest 取 manifest 末项，behind 用例取 manifest 倒数第二项，语义断言保持 `:106-114` 已有的「相对清单表达」风格）
- `tests/shared/mode-badges.test.ts`（`:29-32` `"1.7.0"`、`:42` `behindN:1`、`:51` `ahead:1.7.0` → 同样从 manifest 派生期望串）
- （核查排除：`tests/cli/harness-vm-provider-ceiling.test.ts` 的 "1.7.0" 仅出现在注释与用例描述串（`:14`、`:55`），断言不耦合版本号，不改）

acceptance：
1. `npx vitest run tests/shared/framework-version.test.ts tests/shared/mode-badges.test.ts` 全绿（当前基线：7 failed | 14 passed）
2. `npm run test` 全量绿（解除部署冻结的机械证明）
3. 两个测试文件 grep 不到「当前最新版本」的硬编码字面量（历史锚点如 `"1.0.3"` 允许保留，因其断言已相对清单表达）
4. 去税验证：临时在 manifest 副本追加假版本 `9.0.0` 注入测试（或等价 fixture 注入手段），两文件测试仍绿——证明「上游发版 → tokenizer 只 sync 不改测试」成立

---

**F004 · paths-ignore 扩 docs/** + CLAUDE.md 表述修正 · executor: generator**

涉及文件：
- `.github/workflows/deploy-vps.yml`（`:12-15` 的 `docs/specs|test-cases|test-reports` 三条替换为 `docs/**` 一条；已核 `src/`、`app/` 无 docs/ 运行时读取——grep 仅命中注释与外链 URL）
- `CLAUDE.md`（「本项目特有的硬约束」段落的「`*.md`）已列入 paths-ignore」误述——实际只豁免根目录列举的 7 个 md 文件——改为与 deploy-vps.yml 逐条一致的准确清单，含新的 `docs/**`）

acceptance：
1. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-vps.yml'))"` 通过（本机是否装 actionlint 未核，YAML 合法性为底线）
2. CLAUDE.md 豁免描述与 deploy-vps.yml paths-ignore 逐条对得上，不再含 `*.md` 全称量表述
3. 合入后实测：一个只动 `docs/analysis/**` 的 push 在 GitHub Actions 中不触发 Deploy VPS run（顺手把当前未提交的 `docs/analysis/2026-08-08-repo-strategy/` 目录提交推送，作为实测载荷——该目录正因此约束滞留未提交）
4. Deploy VPS 的 pull_request 触发与 workflow_dispatch 行为不变（对照改动 diff 仅 paths-ignore 块）

---

**F005 · keep-separate 正式 ADR · executor: generator**

涉及文件：
- 新增 `docs/adr/0001-keep-separate-repos.md`（`docs/adr/` 目录当前不存在，harness-rules.md 文档目录约定已预留该位置）

acceptance：
1. ADR 含标准段落：Status（Accepted）/ Date / Context / Decision / Consequences，并记录三视角评审得分（0.85/0.80/0.72）
2. 六条不合并论据逐条带仓库证据引用（如 `harness.sh:92-93` 源树硬校验、console-mode.md:291-296 中立性条款），与替代方案「三件机械化」及 hybrid 出口条款（契约制品小包）完整收录
3. 链接 `docs/analysis/2026-08-08-repo-strategy/README.md` 作为全量依据；链接本批次 spec 作为落地记录
4. 与 F004 同一个 push 推送（见部署打包策略；F004 生效前单独推 ADR 会白烧一次部署）

## 数据模型 / migration

无。全批次不触碰 `prisma/schema.prisma`，无迁移。

## API 与协议影响

- **无新增/修改 endpoint**：`app/api/harness/{report,gates,decisions,mode-intents}` 行为零变化；F002 若为可测性提取导出（`verifyDecision`、report gate 解析），属纯代码移动，请求/响应契约不变
- **AGENT_FEATURE_VERSION 不 bump**：无任何要求 agent 升级的新能力（`src/shared/agent-feature-version.ts` 两常量不动）；agent↔服务端协议零触碰，符合近期批次总原则
- **部署触发说明（硬约束 1）**：本批次 tokenizer 侧改动中 `tests/**`、`.github/workflows/**`、`src/cli/harness.ts`（若提取导出）均不在 paths-ignore 内，**push 即触发生产部署**。打包策略：**F002+F003+F004+F005 合成一次 push**（每 feature 独立 commit，一次推送）——恰好一次 CI + 一次部署；且该 push 必含 F003（否则 verify 红、deploy 被拦，什么都上不去）。部署内容对运行时无行为变化（改动全在测试/CI/文档面），属「安全的空部署」，但仍会重建镜像、滚动重启，需照常观察 `/api/health`。此后 docs-only push（含 ADR 后续修订、analysis 目录增补）不再触发部署
- 模板仓侧 F001 按其发布契约走（VERSION/CHANGELOG/framework-releases.json 三向一致 + CI + tag），与 tokenizer 部署无关

## 测试计划

新增：
- `tests/contract/canonical-json.contract.test.ts`：向量逐字节（重点用例：中文字符不转义、嵌套 scope 键序、undefined 剔除、`{}`/`[]` 边界）
- `tests/contract/sign-verify.contract.test.ts`：Node 签发 → bash/Python/openssl 验签 E2E（valid 通过 + 篡改一字节后必拒）
- `tests/contract/fixture-ingest.contract.test.ts`：valid fixture 全收、invalid 全拒、`verifyDecision` 对金标签名（test-console.pub 就位时）验真/对篡改验假
- 模板仓 `tests/test-contract-fixtures.py`：fixtures 清单完整性、schema 快照一致性、向量复算、金标验签

修改：
- `tests/shared/framework-version.test.ts`、`tests/shared/mode-badges.test.ts`（F003 动态化，用例语义不减——四态 latest/behind/ahead/unknown 与前导零回归保护全保留）

既有回归网：`tests/server/harness-sign.test.ts`（跨语言 canonical 契约）与 `.claude/console/test-{pending-gate,mode-intent}.py`（framework sync 后仍须过，作为 F002 sync 的回归证据）。

## 依赖与前置

- **批内顺序**：F001（上游先行，产出 v1.8.0 + fixtures）→ F002 依赖 F001（sync 目标版本与 fixtures 均来自它）；F003 独立但**必须进入 tokenizer 侧第一次 push**；F004/F005 无技术依赖，与 F002/F003 同 push
- **前置批次**：BL-FW-RELEASE-CONTRACT（发布清单契约与 CI，F001 的扩展基座，已完成）；战略分析独立任务（裁决来源，已完成未入 git——由 F004 后的 docs push 一并入库）
- **被依赖**：roadmap 中期 BL-DEVICE-DECOUPLE / BL-REPO-ADR 项——本批次 F005 即提前完成 roadmap 表中 BL-REPO-ADR 的 ADR 部分；未来 hybrid「契约制品」包以 F001 的 fixtures 为演进起点；后续每次框架升级批次的测试税由 F003 一次性消除
- **交接事项（用户手动）**：
  1. 删除 harness-console-demo（本地 `/Users/yixingzhou/project/harness-console-demo` 实存；是否有远端仓未核）——契约 CI 取代其演练职能后执行
  2. 模板仓 push tag：**本地 clone 无 `v1.7.1` tag（`git tag` 至 `v1.7.0` 截止，远端未核）**，F001 打 `v1.8.0` 时顺手补齐
  3. 若 `github.com/tripplemay/harness-template` 为私有仓（公开与否未核），需在 tokenizer 仓 Actions secrets 配只读 PAT 供 contract-conformance job clone
  4. 本批次执行形态注意：`harness.json` 当前 staged 的 mode intent（2026-08-09 签发，08-16 过期）绑定 generator=codex/local-cli、evaluator=kimi/local-cli（heterogeneous）——`/plan` 边界按 v2 绑定派发时，外部 generator 需在 dispatch 四道锁下工作，改 `.github/workflows/**` 这类敏感文件的 diff 须过 spec-lock critic 稽核

## 风险与对策

| 风险 | 对策 |
|---|---|
| **main 当前 CI 红、部署管道冻结**（7 测试红，任何产品 push 被 verify 拦） | F003 列为 tokenizer 侧第一优先；首次 push 必含 F003；push 前本地 `npm run test` 全绿再推 |
| 改 `.github/workflows/*.yml` 触发生产部署副作用 | 单 push 打包（F002-F005），全批次恰一次部署；改动无运行时行为变化，部署后照常盯 `/api/health` |
| paths-ignore 扩 `docs/**` 误吞未来运行时资产 | 已核 `src/`、`app/` 零 docs/ 运行时读取；ADR/CLAUDE.md 明文记录「docs 不得被运行时读取」作为该豁免的成立前提 |
| 测试私钥入模板仓被误用为生产密钥 | 路径与文件头显著标注 TEST-ONLY；`validate-contract-fixtures.py` 校验 fixtures 公钥 ≠ 消费仓惯用 `console.pub` 文件名约定处的键（fixtures README 声明生成方式，可随时轮换重生成金标） |
| conformance job 对模板仓的网络依赖（clone 失败 / 私有仓 / 短 sha） | 独立 workflow 不进 deploy 关键路径（deploy 只 needs verify）；clone 后 `git checkout` 短 sha；私有仓走 PAT（交接项 3）；本地始终可用 `CONTRACT_FIXTURES_DIR` 指向本地 clone 复现 |
| sync v1.8.0 带来 `.claude/**` 机件变化引入回归 | F002 acceptance 含 `harness.sh verify` 对账 + console 自带 py 测试重跑；codex.json 定制文件走 resolve 保留（有既往先例 `e59c822`） |
| Python↔Node canonical 在非 ASCII 上的隐性分歧 | 向量强制含中文用例；两侧都以 `ensure_ascii=False` 为契约钉死（`harness-sign.test.ts:56-61` 已有先例，fixture 化后上游同样受 CI 保护） |
| ubuntu-latest openssl 能力 | ubuntu-latest 的 OpenSSL 3 原生支持 Ed25519；本机 macOS LibreSSL 问题已有 `findOpenSsl` 多路径探测先例可复用（`validate-pending-gate.sh:140-142` 同型） |

## 规模估计

**M** · 5 features（4 个 tokenizer 侧 + 1 个跨仓上游侧）+ 3 项用户交接 · 主要涉及文件约 22 个（tokenizer：新增 4 + 修改 6 + sync 产物若干；模板仓：新增约 8 + 修改 4）。无 DB、无协议、无 UI 改动；复杂度集中在 F001/F002 的双向契约测试设计与跨仓发布编排，F003/F004/F005 均为薄改动但 F003 具最高紧迫性（解除部署冻结）。