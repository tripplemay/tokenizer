# 框架版本化（P4）—— 从「复制模板」到「有版本、可对账、可升级」

> **状态：v1.4 已实装。** CLI 在 `.claude/harness.sh`（随 bootstrap 铺入）；
> 账本是项目根的 `harness.json` + `harness.lock`。
>
> **加载层级：T2（按需）。** 只在初始化项目、升级框架、排查漂移时加载。
>
> **来源：** 用户裁决——控制台要能看到/切换模式、能新建项目，「尽量减少通过终端命令复制
> harness 规则」。版本化是那三件事的地基：没有版本号就无从谈升级、兼容与远程操作。

---

## 1. 为什么需要它

v1.3 及以前，`bootstrap.sh` 是**一次性复制**。后果三条，都在实测中被证实：

- **项目冻结在 bootstrap 当天的版本**，且没人知道是哪天——存量项目 minigame 实测缺 93 个
  机件（整个 `autonomous/` `dispatch/` `console/` 都没有），而项目自己不知道
- **升级 = 手工重铺**，重铺会**静默盖掉**你对框架文件的本地改动
- **控制台无从展示**「这个项目用的是哪个版本的框架」，更无从发起升级

## 2. 形态：物化文件 + 清单 + 校验和

**不能**把框架文件挪进 submodule / npm 包 / 软链——Claude Code 要在固定路径直接看见
`.claude/hooks/*.sh`、`.claude/skills/`、根目录的角色文件；hook 路径、Windows、
`@harness-rules.md` 引用都会因间接层而断。所以版本化落在**账本**上：

| 文件 | 内容 | 入 git |
|---|---|---|
| `harness.json` | 框架来源 URL、版本、commit、安装来源 | ✅ |
| `harness.lock` | 受管文件清单 + 每文件**双 sha256** | ✅ |
| `framework/harness/framework-releases.json` | 随 `harness/` 镜像物化的 v1 发布清单 | ✅ |

**🔴 双 sha 是这套设计的关键。** 每个受管文件记两个哈希：

- `sha256` —— 项目里这个文件**上次对齐时的内容**
- `upstream` —— 它当时对齐到的**上游原文**

两者不等 = **有意的本地定制**。只记一个 sha 会让冲突无法收场：人工合并之后，文件仍然
既异于基准线、又异于上游，`sync` 会永远判它冲突——**没有出口**（第一版实现踩到，
`resolve` 子命令与 `upstream` 字段就是为此而生）。

## 3. 两类文件

| 类别 | 含义 | 升级行为 |
|---|---|---|
| **managed** | 框架拥有：角色文件、`.claude/**`、`framework/**` 镜像 | 同步；本地改过则报冲突，**绝不静默覆盖** |
| **seeded** | 只在 init 铺一次，之后归项目：`CLAUDE.md` / `AGENTS.md` / `progress.json` / `.auto-memory/**` / `framework/proposed-learnings.md` | **永不触碰** |

项目骨架（`features.json` / `backlog.json` / `docs/` / `.gitignore`）只在缺失时创建，
不进 lock。

## 4. 命令

```bash
bash .claude/harness.sh status                      # 版本 + 漂移概览
bash .claude/harness.sh verify --from <框架源树>     # 逐文件对账（不给源树则只做本地对账）
bash .claude/harness.sh sync   --from <框架源树>     # 升级（--dry-run 预演）
bash .claude/harness.sh resolve --from <源树> <文件> # 冲突已人工合并，重新对齐
bash <源树>/templates/claude/harness.sh adopt --from <源树> --as <版本>   # 存量项目补建账本
```

`--from` 是本地源树（**离线可用是硬要求**，同 console-mode 红线 5 的精神）；
也可以省略 `--from` 改用 `--ref <tag|branch|sha>` 从 `harness.json.framework.source_url` 拉取。

## 5. 五种对账状态

| 状态 | 含义 | sync 行为 |
|---|---|---|
| `ok` | 与上次对齐一致，上游也没动 | 不动 |
| `modified` | 本地定制，上游没动 | **保留** |
| `outdated` | 本地没改，上游有更新 | 覆盖 |
| `conflict` | 本地定制 **且** 上游也改了 | 🔴 拒绝，见下 |
| `missing` | 文件被删了 | 补回 |

## 6. 🔴 冲突时整次升级不执行

有一个文件冲突，`sync` 就**一个文件都不改**，只把新版原文放到 `<file>.harness-new` 供你比对。

理由是半升级状态最难排查：一半文件是新版语义、一半是旧版，而 lock 会声称升级成功。
逐个 `resolve` 之后重跑即可继续。

另一条同源的克制：**新版已移除的受管文件，只从 lock 摘除，不删项目里的文件**——
万一它已被项目引用，静默删除比留一个孤儿文件危险得多，`sync` 会把它列出来让你确认。

## 7. 存量项目怎么迁

```bash
cd <项目>
bash <框架源树>/templates/claude/harness.sh adopt --from <框架源树> --as <你当时的版本>
bash <框架源树>/templates/claude/harness.sh verify --from <框架源树>   # 看差多少
bash .claude/harness.sh sync --from <框架源树>                        # 确认后再升
```

`adopt` **只记录、不改动任何文件**。它把 `sha256` 取为项目现状、`upstream` 取为参考版本
原文——两者不等的文件就被如实标成本地定制，下次 `sync` 不会当成「落后」而覆盖它们。
（首次 adopt 要用源树里的 `harness.sh`，因为项目里还没有这个文件；adopt 后 `sync` 会铺入。）

## 8. 与控制台的接口（P1/P2 的地基）

`harness.json` 与 `harness.lock` 是机器可读的：device agent 上报 `framework.version` 与
漂移摘要，控制台就能显示「这个项目跑的是哪版框架、有几处本地定制、落后几个版本」，
并据此发起「升级到 vX」的**签名意图**——执行仍在机器上，git 仍是唯一真相源。

发布历史也不能由控制台或项目各自抄写：源仓的
`harness/framework-releases.json` 是 v1 正式版本历史的唯一机器事实源，镜像后位于
`framework/harness/framework-releases.json`。其末项必须等于源仓根 `VERSION`，全部 v1
changelog 标题的版本与日期必须逐项一致；CI 会在发布前拒绝任何漂移。v0.x 不在这个有序清单中，
以保留旧项目「可识别但不能按 v1 发布次数计数」的兼容语义。

`adopt` 保持只记录既有项目状态、绝不补写文件的语义；尚未拥有该清单的存量项目会在随后一次
`sync --from <源树>` 中把它作为新版新增的受管文件铺入并记入 lock。

## 9. 红线

1. `.claude/**` 与角色文件必须是**真实物化文件**，不得用软链/submodule 间接化
2. `sync` 不得静默覆盖本地改动；冲突一律 fail-closed，整次不执行
3. `seeded` 文件（项目自有内容与记忆）任何时候都不被框架同步触碰
4. 离线可用：`--from <本地源树>` 必须始终是一条完整可用的路径，不得只支持联网升级

---

## 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-07-26 | 初版（v1.4）：`harness.json` / `harness.lock` 双 sha 账本 + `harness.sh` init/status/verify/sync/resolve/adopt；`bootstrap.sh` 降为薄封装 | 用户裁决「先做 P4（框架版本化）」；存量项目 minigame 实测缺 93 个机件 |
