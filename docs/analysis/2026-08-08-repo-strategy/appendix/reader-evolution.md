# tokenizer 项目演进史与双仓协同现状报告

数据来源：`git log`（全仓 321 commits，`git rev-list --count HEAD`）、`docs/specs/`（14 份 spec）、`progress.json` / `features.json` / `backlog.json`、`harness.json` / `harness.lock`、`framework/` 与 `/Users/yixingzhou/project/harness-template` 实际 diff 与逐文件 sha256 对账。

---

## 1) 演进时间线：从用量统计到编排控制台

### 阶段 A · 用量统计 MVP（`fbfc670` 起）
- `fbfc670 feat: initialize tokenizer token usage tracker` → 采集器（`3b42906` OpenCode SQLite、`15e0e4d` Claude）、设备感知 ingestion（`83fe404`）、VPS 部署工作流（`4411150`）、客户端 enrollment agent（`256d143`）、去重修复（`4ffc8c2`）。

### 阶段 B · UI 换皮与国际化
- Next 15 + React 19 升级（`5f25a7e`）、Horizon UI 分四阶段 vendor + 换皮（`103b450`→`0be062a` PR#1），next-intl i18n（`4d67adc`）。

### 阶段 C · 计量语义与观测深化
- billable/compute token 语义重定义（`d5d2f63`、`6e47f4b`）、成本估算与全局 range（`2a47e7c`、`bbd3f1e`）、设备下钻 + 心跳诊断（`e03add1`、`d31acc9`）、Aider 第四数据源（`2b9191d`）、代理自愈网络（`8a9afdb`）。

### 阶段 D · 多租户与登录
- multi-tenant 1a–1e（`959aa62`→`f61f7cc`）、跨租户泄漏修复（`442de39`）、onboarding 信息图与登录美化（spec 见 `7b12ced`、`d74c1c0`）。

### 阶段 E · 时区、enrichment、配额与升级提醒
- 用户时区全链路（spec `4c538f2`）、openusage parity：Claude JSONL enrichment + Codex 订阅配额（spec `a4d61f2`/`9283dcc`、实现 `ee8894a`→`a0447db`）、客户端升级提醒（spec `c40f489`，整数化 `90450db`）、Kimi Code 采集器（`6a61f9f`）、Windows 原生支持（`2218c49`→`da15148`）、迁移 deploysvr（`5d8f3ca`）。

### 阶段 F · v1.3 转折：成为 harness 编排控制台（无 BL 编号的奠基三连）
- `3614fcb feat(harness): 接入 harness 编排控制台（项目进度 + 人闸门）` → `780e06f`（agent 侧上报 + 签名闸门中继）→ `5e11c16`（端到端演练）→ `41dfd6e`（P1 模式画像）→ `3fd4b77 feat(harness): tokenizer 自己装上 harness——控制台成为被它管理的项目`（自举点，`harness.json` 由此产生）。

### 阶段 G · BL 批次流水线（spec 均在 `docs/specs/`）
| 批次 | 内容 | 关键 commit |
|---|---|---|
| BL-FWDRIFT | 控制台显示框架落后 N 版 + 升级指引；首次异厂商 fan-out 验收（Kimi/Codex 结论冲突举 debias_conflict 闸门） | `08d4694`、`5a884a0`、`b43310c` |
| BL-MODESCMD | `harness --modes` 子命令；**首次验证外部 CLI（Codex）当 generator** | `09b6225`、`7bdd03c` |
| BL-HARNESS-DETAIL-MODEINTENT | 项目下钻 + 签名 mode intent（控制台只签意图，本机验签暂存到 `harness.json.project.mode_defaults`） | `b4c24b4`→`660f0e8` |
| BL-DISPATCH-LIFECYCLE | dispatch deadline/生命周期收束（Generator=Codex local-cli、Evaluator=Kimi A2A） | `cc4cc55`→`9483208` |
| BL-HARNESS-SYNC-HEALTH | agent 每 60s harness 上报链路的健康可观测（此前故障只能翻 `agent.log`） | `93e452a`→`3e0240a` |
| BL-HARNESS-REPORT-COMPAT | 上报身份兼容：`local:<绝对路径>` 与 `/v1/...` 误判为敏感路径 | `d106eab`→`68e024d` |
| BL-FW-RELEASE-CONTRACT | **跨仓混合批次**：发布清单 `framework-releases.json` 成为唯一机器事实源 | `383f0a5`→`de72f3e` |
| BL-AGENT-REPORT-COMPAT | 旧 Agent 面对 `tool-integrations/1` 被 `invalid_tool_catalog` 拒绝的兼容修复 | `71b3595`→`f9e6a46` |
| BL-NATIVE-SUBAGENT-BRIDGES | Kimi vm-v1 严格 provider 桥接 + Codex local-cli 策略；3 轮 fix（FIX1/FIX2 两份裁决文档） | `a3acac5`→`125c5a6` |
| BL-AGENT-RELEASE-ACCEPTANCE | **Evaluator-only 批次**：补 Agent 1.2.0/1.2.1 先上线后验收的独立验收 | `f3ee2c0`→`2645083` |
| BL-TOKENIZER-ADOPT-V170 | 采纳框架 v1.7.0（见 §4） | `60f85b0`→`8959a96` |
| BL-CODEX-USAGE-DEDUP | 回到统计本业：Codex 累计快照去重 + 历史幂等迁移（旧逻辑膨胀约 9.26x） | `231bf2e`→`20f204b` |
| （最新） | v1.7.0→v1.7.1 升级 + dispatch-mode.md 对齐 | `7eda92e`、`afa0297` |

当前状态：`progress.json` status=`done`，sprint=`BL-CODEX-USAGE-DEDUP`（3/3 完成，已部署生产，commit `826ef25`）。

---

## 2) framework/ 与上游模板的同步机制与漂移现状

**机制**（`framework/harness/framework-versioning.md` §2–4）：不用 submodule/npm，走「物化镜像 + 账本」。`harness.json` 记来源（`https://github.com/tripplemay/harness-template.git`，version 1.7.1，commit `78756ab`，`installed_from: /Users/yixingzhou/project/harness-template`）；`harness.lock` 记 **224 个 managed 文件 + 13 个 seeded 文件**，managed 每文件双 sha256（`sha256`=上次对齐内容，`upstream`=当时上游原文；两者不等=有意本地定制）。命令：`bash .claude/harness.sh status|verify|sync|resolve --from <源树>`。

**逐文件对账结果（实测脚本，非印象）：**
- **managed 224 个文件磁盘 hash 与 lock 基线 100% 一致，零未记录漂移。**
- **唯一有意定制（lock 内 `sha256 != upstream` 仅 1 处）：`.claude/dispatch/transports/adapters/codex.json`** —— commit `e59c822` 补回自定义 model provider（本机 `~/.codex/config.toml` 指向中转，模板的 `--ignore-user-config` 会丢弃 provider 段导致直连 api.openai.com 认证必败；与 newkolmatrix `af8ca20` 同一补丁）。注意其模板镜像 `framework/templates/claude/dispatch/transports/adapters/codex.json` 仍与上游一致——同一文件的「模板副本」干净、「安装副本」定制。
- **seeded 13 个文件**（`CLAUDE.md`、`AGENTS.md`、`progress.json`、`.auto-memory/**`、`framework/proposed-learnings.md` 等）只在 init 铺一次、永不同步，之后归项目所有——`framework/proposed-learnings.md` 现与上游内容分叉（磁盘 `d451e365...` vs 上游 `39e2af4e...`），属设计内。
- **目录级 diff**（`diff -rq framework/ harness-template/`）：除 proposed-learnings 外**内容全同**；上游多出 `.github`、`archive/`、`scripts/`、`tests/`、`INIT.md`（发布基建与归档，不下发到镜像）。
- 本项目特有内容**不放在** `framework/` 里，而在 `docs/specs/`、`docs/test-reports/`、`src/`；`framework/` 是纯上游镜像。

---

## 3) backlog 与 proposed-learnings 概况

**backlog.json — 3 条待办**（全部源自 BL-NATIVE-SUBAGENT-BRIDGES 复验发现，2026-08-04 用户裁决登记）：
1. `BL-REGISTRY-LAZY-FIELD-CLEANUP`（low）：清理 kimi integration 中 bridge 路径不引用的惰性 `sandbox.env_set` 字段
2. `BL-BRIDGE-GUEST-FAILURE-TAXONOMY`（medium）：provider 以白名单枚举回传 guest 失败类别（现在偶发失败烧 2400s wall-clock 无法定位）
3. `BL-BRIDGE-D8-D9-OVERWRITE-ALIGNMENT`（low）：terminal-message 通道 O_EXCL 与 D9 覆盖语义对齐

**framework/proposed-learnings.md — 待确认提案：**
- 2 条新提案（2026-08-04，BL-NATIVE-SUBAGENT-BRIDGES 复盘）：① persona 维度可用性不得由单一角色成功外推（planner persona 曾 4/4 确定性失败）；② spawn 子进程信任边界至少配一条真实 argv 执行用例（全 mock 让五连缺陷逃逸）。
- 更早的 harness-fit 分析（2026-07-12）P0-1/P0-2 部分落地、P0-3 与 P1-1~P1-3、P2-1~P2-5 仍标「待确认」。

---

## 4) 双仓协同实际工作流：一次框架升级的两仓分工

以 **BL-TOKENIZER-ADOPT-V170**（tokenizer 侧）与 **BL-FW-RELEASE-CONTRACT**（跨仓）还原：

**上游 harness-template 侧：**
1. 功能开发 + 真机验证（如 `32df1e0 feat(v1.7.0)`、`d632cc9` 真机 smoke 修 6 个潜伏 launch bug）
2. 发布三件套：bump `VERSION` + 追加 `CHANGELOG.md` + 追加 `harness/framework-releases.json` 清单条目（v1.5.3 起由 CI 机械校验三者一致，spec D1）
3. push GitHub + 打 tag（ADOPT-V170 spec 前置条件写明「e91fbbc，含全部 tag」）

**tokenizer 侧（消费仓）：**
1. `/plan` 立批次 + spec（`60f85b0`，`docs/specs/BL-TOKENIZER-ADOPT-V170-spec.md`）
2. `bash .claude/harness.sh sync --from /Users/yixingzhou/project/harness-template` → 更新 `framework/` 镜像 + `.claude/` 机件 + `harness.json`/`harness.lock`（F001，`f5afaf1`）
3. **修版本耦合的产品测试**：`src/shared/framework-version.ts` 构建期 import 镜像里的 `framework-releases.json`，升版即改变控制台 framework-standing 显示 → 10 个测试要跟着改（F002，`110a225`）
4. 隔离验收 + 人闸门（`275b6b1` 验收、`c50c615` 控制台中继闸门、`2fb4b15` 消费闸门收 done）
5. **git 之外的本机 rollout**：迁移机器契约 `~/.tokenizer/harness/vm-v1/provider.json` + bundle manifest（`image_location`/`kimi_identity`），只记入报告不入 git（`8959a96`）

小版本走轻量路径：单 commit `chore(harness): 升级框架 v1.7.0 → v1.7.1（78756ab）`（`7eda92e`）。BL-FW-RELEASE-CONTRACT 本身即「跨仓混合批次」范式：先在上游完成并验证 v1.5.3（上游 `1408dae`/`0c27c01`），tokenizer 记录源仓完成（`3f9e47d`）→ sync（`e299cfb`）→ 同批消费 manifest 的 consumer 改动（`0da19ab`）→ A2A signoff 闸门（`777e7e4`）。

---

## 5) 双仓模式当前摩擦点（具体证据）

1. **发布记录曾三处手工维护、屡次漏同步**：commit `548a51f`「同步框架 v1.4.4 + 发布清单补 1.4.2/1.4.3/1.4.4」是补账实锤；BL-FW-RELEASE-CONTRACT spec §1 记录 v1.5.0–1.5.2 更新了 VERSION/CHANGELOG 却没同步 tokenizer 的版本数组，控制台错显「ahead」。manifest 化后收敛，但上游 VERSION/CHANGELOG/manifest 三份仍需 CI 护着。
2. **同一 bug 在多个消费仓重复打补丁**：codex adapter provider 坑在 newkolmatrix（`af8ca20`）、tokenizer（`e59c822`）各修一次，上游再独立修一次（harness-template `78756ab`）；tokenizer 的安装副本从此永久带「有意定制」标记（lock 双 sha 不等），每次 sync 都要走 resolve 语义。
3. **消费仓的版本耦合测试税**：ADOPT-V170 spec 开篇——「src 测试与 1.6.2 硬耦合——直接升会破坏 10 个测试」；每次框架发版，tokenizer 必须同批改 `framework-version` / `mode-badges` / `harness-tool-catalog` 测试（`110a225`）。
4. **同步点之间的文档漂移需人工对齐**：`afa0297`「dispatch-mode.md 与上游 v1.7.1 对齐（撤下陈旧的 bridge 未发布叙述）」——镜像文档在两次 sync 之间陈旧，靠人发现。
5. **learnings 双向回流是纯手工闭环**：tokenizer 的 seeded `framework/proposed-learnings.md` 积累项目侧提案（现 2 条待确认），须经用户确认后由人搬进上游 `framework-template` 对应文件再随下次发版回流——两仓该文件天然分叉（hash `d451e365` vs `39e2af4e`）。
6. **git 载不动的机器态**：vm-v1 provider 的机器契约迁移（ADOPT-V170「本机安装步骤，记入验收报告与 project-status，不入 git」）与 `.auto-memory/project-status.md:18`「本机 agents-registry.example.json 是用户本地定制，必须保留且不得提交」——每台机器每个消费仓都要手工 rollout。
7. **多消费仓扇出成本**：`.auto-memory/project-status.md:10`——同一 v1.7.0 升级，newkolmatrix 仓「42 文件待用户在该仓提交」；每多一个消费仓，sync+测试修复+commit+rollout 全套重复一遍。
8. **仓内双份镜像**：224 个 managed 文件中 `framework/templates/claude/**` 与安装到 `.claude/**` 的机件互为副本（如 codex.json 两处、dispatch 测试脚本两处），lock 里成对出现，体积与对账条目翻倍。