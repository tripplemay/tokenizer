# harness-template 消费者生态调查报告

## 1) 消费者项目清单

发现命令 `for d in /Users/yixingzhou/project/*/; do [ -f "$d/harness.json" ] && echo "$d"; done` 命中 **9 个**项目。全部 9 个 `harness.json` 的 `framework.source_url` 均为 `https://github.com/tripplemay/harness-template.git`。

| 项目路径 | 框架版本（harness.json / harness.lock） | 当前状态（progress.json） | 活跃度（最后 commit / progress mtime） | 备注 |
|---|---|---|---|---|
| `/Users/yixingzhou/project/newkolmatrix` | **1.7.1 @78756ab**（最新） | `reverifying`，M5.1b-TENANT-INJECTION 7/8，fix_rounds=1 | 2026-08-08 / 08-08 | **最活跃**。唯一带签名 `mode_defaults`（intent 由 tripplezhou@gmail.com 2026-08-07 经控制台签发）；有 `tool-integrations/1` 版 `.agents-registry.json`（claude/codex/kimi 三家，Evaluator 异构） |
| `/Users/yixingzhou/project/trade` | unknown @b9f5dfd（= v1.4.0 基线 adopt） | `done`，B113 3/3 已签收 | 2026-08-08 / 08-08 | 活跃；无 registry |
| `/Users/yixingzhou/project/aigcgateway` | unknown @b9f5dfd | `verifying`，BL-BILLING-ZERO-PRICE-BACKFILL 2/2 待验收 | 2026-08-07 / 08-07 | 活跃；无 registry |
| `/Users/yixingzhou/project/tokenizer` | **1.7.1 @78756ab**，且是唯一记录 `"installed_from": "/Users/yixingzhou/project/harness-template"` 的项目 | `done`，BL-CODEX-USAGE-DEDUP 3/3 | 2026-08-08 / 08-06 | 本报告委托方；有含 `a2a_targets` 的最全 registry |
| `/Users/yixingzhou/project/joyce` | 1.0.3 @unknown | `building`，BL-HORIZON-FE-PILOT 4/6 **中途搁置** | commit 2026-07-26 / progress mtime **07-13** | remote 是 `tripplemay/kolmatrix.git`（旧版 KOLMatrix）；半停滞 |
| `/Users/yixingzhou/project/grandtianfu` | 1.0.3 @unknown | `done`，render-mask-b1 5/5 | 2026-07-26 / 07-26 | 休眠（最后一笔是闸门机件铺装） |
| `/Users/yixingzhou/project/harness-console-demo` | unknown @b9f5dfd | `verifying`（PROD-E2E，演练残留态） | 2026-07-26 / 07-25 | **无 git remote，本地一次性演练仓**，详见 §2 |
| `/Users/yixingzhou/project/minigame` | unknown @b9f5dfd | `done`，P2 美术集成 5/5 | commit 07-26 / progress mtime **2026-05-14** | 休眠 |
| `/Users/yixingzhou/project/wearwhat` | unknown @b9f5dfd | `reviewing`（**前 v1 词表**，现行状态机无此状态） | commit 07-26 / progress mtime **2026-03-28** | 最老消费者，无 remote，休眠 |

版本考证：`git -C harness-template show -s b9f5dfd` = `2026-07-25 feat(v1.4.0) 框架版本化`——5 个 "unknown" 项目是 v1.4.0 时补账（adopt）的存量项目。上游 HEAD = `78756ab`（v1.7.1，`VERSION` 文件确认），**只有 tokenizer 与 newkolmatrix 在最新版**；其余 7 个落后 4~13 个 tag。7 个 2026-07-26 的 `chore(harness): 闸门机件 + 控制台公钥` commit 表明当天全量铺装过一次控制台闸门机件。

**控制台上报配置的位置**：各消费者项目内**没有任何 console URL/token 配置**——项目里只有下行验签机件 `.claude/console/{console.pub, approve-gate.sh, validate-pending-gate.sh, pending-gate.schema.json}`（8 个非 tokenizer 消费者全有，newkolmatrix 另有 mode-intent 全套）。上报是**机器级**的：`~/.tokenizer/config.json` 写着 `"serverUrl": "https://token.vpanel.cc"`、`"projectRoots": ["/Users/yixingzhou/project"]`；tokenizer agent 按 `src/cli/harness.ts:144-166` 的判据（**同时存在 `progress.json` + `harness-rules.md`**）扫 projectRoots 一层子目录自动发现——上述 9 个项目全部命中，自动被上报，无需逐项目配置。

## 2) harness-console-demo 是什么

一个**可随时删除的一次性生产演练仓**。它自己的 `harness-rules.md` 全文（230 字节）自述：「这个仓库存在的唯一目的：验证『控制台签发 → device agent 中继 → 本机验签落盘』这条通道在生产环境下真的通。可随时删除。」

与 tokenizer 的关系：**它是 tokenizer 控制台闸门通道（v1.3 能力）的 E2E 测试夹具**，不是产品。证据：

- git log 全部 15 个 commit 都是闸门生命周期演练：`raise gate` → `approve/reject ... by yixing` → `consume`，含 `ff35d33 chore(gate): relay PROD-E2E-verifying-done-w1 from console`——正是 `tokenizer/src/cli/harness.ts:524-597` 中继逻辑（验签后只 add/commit `progress.json` 单文件）留下的机械痕迹。
- `progress.json.pending_gate.decision` 里留着控制台签名的 reject 决定（`"by": "yixing"`, `sig` base64，`autonomy.last_halt.detail` 记录 tripplezhou@gmail.com 2026-07-26 在控制台批准）。
- 它的 `harness.lock` 只管理 4 个文件，全是 `templates/claude/console/*`——即它只 adopt 了框架的控制台闸门子集。
- 无 remote、无产品代码（除 `docs/test-reports/PROD-E2E-verdict.json` 外无其他产物）。演练结束后停在 `verifying` 未清场。

合并评估中它的权重≈0：可删。但它是「templates/claude/console/* 与 tokenizer 服务端契约必须同步演进」的活证据。

## 3) tokenizer 的双重身份

**身份 A：框架消费者**（与其他 8 个平级）
- `harness.json` v1.7.1 + `harness.lock` 受管清单 + `framework/` 镜像（含 `harness/`、`templates/`、`console/` 等完整源树）+ `.claude/` 机件 + 自己的 `progress.json` 状态机（刚跑完 BL-CODEX-USAGE-DEDUP）。
- 因为它有 `progress.json` + `harness-rules.md`，**它被自己装的 agent 发现并向自己部署的控制台上报自己**。

**身份 B：控制台服务端 + device agent 的发行方**
- 服务端：`app/` + `src/server/`，生产在 `token.vpanel.cc`（`docs/VPS-deployment.md:62-72`）；上/下通道见 `src/cli/harness.ts:40-41` 注释——上报 `POST /api/harness/report`，中继 `GET /api/harness/decisions` 验签后写回各消费者 `progress.json`。
- agent：`src/cli/`（harness.ts / harness-mode-intents.ts / harness-dispatch.ts 等），经 launchd 常驻，是所有 9 个消费者与控制台之间的唯一运输层；`harness-mode-intents.ts:339-398` 还会把控制台签发的 mode intent **写进消费者的 `harness.json`（`project.mode_defaults`）并单文件 commit**——newkolmatrix 的 `harness.json` 里那段带 `sig` 的 intent 就是它写的。
- 耦合的具体表现：`.github/workflows/deploy-vps.yml` 的 `paths-ignore` 专门把 `framework/**`、`harness.json`、`harness.lock`、`.claude/**`、`progress.json` 等**框架状态写流量从生产部署触发里挖掉**——身份 A 的日常写盘不能触发身份 B 的生产部署，这条隔离今天已经存在且是合并可行性的关键前提。
- 注意：`grep -rn "harness-template" src/ app/` **零命中**——服务端代码不引用模板仓，两个身份目前只在「templates/claude/console/* 的闸门契约 ↔ 服务端 API」这一层隐性耦合。

## 4) 双仓合并（harness-template → tokenizer 仓）对其他消费者的影响

**先说不受影响的**：日常上报/闸门中继完全无感——agent 发现判据（progress.json + harness-rules.md）与上报路径不含模板仓概念；`harness.lock` 对账只存 sha256 不存 URL；已装机件继续照常工作。**影响全部集中在升级路径与初始化路径**。

**a. `sync --ref`（远程升级）会立即断裂。** 消费者本地已装的 `.claude/harness.sh` 按 `harness.json.framework.source_url` 做 `git clone --depth 1 --branch <ref>`（harness.sh:85-90），随后硬校验 `[ -d "$SNAPSHOT/harness" ] && [ -d "$SNAPSHOT/templates" ]`（harness.sh:92-93）。合并后 clone 到的是 tokenizer 产品仓，根目录没有 `harness/`+`templates/`（会在 `framework/` 之类的子目录下）→ 直接 die「源树不像框架仓库」。修复需要**两件事同时做**：新版 harness.sh 支持子目录布局，且 9 个消费者的 `harness.json.source_url` 全部改写。而消费者跑的是**各自项目内的旧拷贝**（5 个停在 v1.4.0 基线、2 个在 1.0.3），它们不认识任何子目录逻辑——每个项目都需要一次 `sync --from <本地源树>` 的过渡升级来换血 harness.sh 与 harness.json（sync 是否会自动重写 source_url 未核，需要实测或在过渡版本里显式处理）。

**b. 本机 `sync --from`（实际主流路径）代价最小。** tokenizer 的 `harness.json.installed_from` 表明本机升级走的是本地路径 `--from /Users/yixingzhou/project/harness-template`。合并后改为 `--from /Users/yixingzhou/project/tokenizer/framework` 即可——`resolve_source` 只查快照根下有无 `harness/`+`templates/`，而 `ls tokenizer/framework/` 确认两者俱在（还含 `bootstrap.sh`、`console/`）。tokenizer 自己从自己的 `framework/` 升级属于既有 nested 布局的自噬防护范围（harness.sh 快照后再操作，见 73-75 行注释）。**风险**：tokenizer 的 `framework/` 目前是「受管镜像」（被 harness.lock 记账的下游拷贝），合并后要翻转为「上游源本体」，账本语义需要重定义，否则 tokenizer 自己 verify 会把上游编辑报成漂移。

**c. 新项目 bootstrap 流程必须改写。** 现行流程是 degit 模板仓（flat 布局）后 `bash bootstrap.sh`；bootstrap.sh:36-40 的 flat 检测（根目录 `harness/`+`templates/`）在「degit 整个 tokenizer 仓」下不成立，且 degit 整仓会把控制台产品代码当项目底座带下来——不可行。可行替代是 `degit tripplemay/tokenizer/framework`（该子目录含 bootstrap.sh，结构上接近 flat），但 INIT.md/README 指引和 harness.sh:267、484 两处**写死的 source_url 默认值**都要改，未实测。

**d. tag/版本命名空间合流。** `sync --ref` 靠 git tag 定位版本，模板仓已有 v0.9.1→v1.7.x 的 tag 序列；tokenizer 仓 `git tag` 当前为**空**。合并后框架 tag 打在产品仓 commit 上：框架版本流与产品发布流共用一条历史，`--ref` 拉取会下载整个产品仓（depth 1 缓解体积，语义混杂无解）。

**e. 部署触发面要预先扩挖。** `framework/**` 已在 deploy-vps.yml 的 paths-ignore，框架源如果**全部**落在 `framework/` 下则框架 commit 不会触发生产部署；但模板仓还有 `tests/`、`scripts/`、`console/`、`archive/` 等顶级目录——任何一个落到 `framework/` 之外，每次框架修复都会**部署一次生产控制台**。CI 噪声同理反向存在（框架改动跑产品测试）。

**f. 唯一的实质收益**：闸门/mode-intent 契约的两侧（服务端 `app/api/harness/*` ↔ 分发给消费者的 `templates/claude/console/*`）从跨仓隐性耦合变为同仓同 commit 演进——harness-console-demo 那种专门验证两侧对齐的演练仓的存在本身，就是这个耦合今天没有机械保障的证明。

**量化影响面**：需要过渡动作的存量消费者 8 个（除 tokenizer），其中活跃且近期会升级的 3 个（newkolmatrix、trade、aigcgateway）是必须打通过渡路径的对象；joyce/grandtianfu/minigame/wearwhat 休眠，可等下次唤醒时顺带过渡；harness-console-demo 可删除。