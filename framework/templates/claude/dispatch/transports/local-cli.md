# Transport: local-cli —— 本地异构 CLI 适配规范

> 编排者把一个阶段的活派给**本机另一个厂商的 CLI 子进程**（Codex / Kimi / …），
> 在机件 #7 沙箱内执行，凭产物取回结论。规范主文见 `harness/dispatch-mode.md`。
>
> **定位：** 这条 transport 提供的是**模型异构**，不是**地理异构**。跨机器、真异步、断线重订阅
> 属于 `transports/a2a.md`（已实装）——两者共用同一份信封与回执表，由 `dispatch-run.sh` 路由。

---

## 1. 一次派活的完整时序

```
编排者
 ├ 1. 解析 descriptor（.agents-registry.json）→ 确认 transport=local-cli、roles 含目标角色
 ├ 2. 组装信封 → validate-dispatch.sh envelope（字段白名单校验）
 ├ 3. sandbox-profile.sh --agent <id> --envelope <f>
 │     ├ repo.url top-level == invocation top-level（创建目录前 fail closed）
 │     ├ 只读角色：worktree add --detach；Generator：独立 clone --shared
 │     ├ env -i <白名单>                    没凭据就花不了钱
 │     ├ GIT_CONFIG pushurl=DISABLED       禁 push（env 级覆盖，不污染主仓 config）
 │     └ process-timeout.py <effective>    绝对 wall-clock + 完整进程组封顶
 │       → 项目 .harness-dispatch/run-meta-<task>.json 耐久落盘
 ├ 4. validate-dispatch.sh receipt run-meta.json    → 回执推断（§4）
 ├ 5. COMPLETED → 产物过 deliverable.schema → 机械回写状态机（铁律 12 原样）
 │   WAITING     → 硬停交人类
 │   FAILED/CANCELED → 凭 task_id 幂等重派，上限 1 次
 └ 6. generator 类：handoff/diff 精确对账 → spec-lock critic → sandbox L1 → Coordinator 受控回流（§6）
```

`dispatch-run.sh --state <dir>` 对两种 transport 语义相同：都把 run-meta 写进该目录，默认为
当前项目的 `.harness-dispatch/`。local-cli 的一次性 clone/worktree 与 `run-<task>.log`
仍放在 `--workroot` 下；取证清理 workroot 不会再把 run-meta 一起删掉，也没有新增任何日志上传。

对于 active v2 non-fast 批次，进入 `sandbox-profile.sh` 前还必须匹配 active resolution 的
`execution_provenance_sha256`。它把本次 target、verified adapter 的执行契约、sandbox 与 timeout 等实际
执行语义固定为 checkpoint；同一 `{tool, invocation}` 在这些语义改变后不会继续运行。用户签名仍只覆盖
`{tool, invocation}`，因此该 hash 是运行时漂移 guard，不是对 registry 或 adapter 文件的防篡改签名。
旧五字段 active v2 checkpoint 必须重新 `/plan`/consume，不能降级执行。

## 2. 信封投递（`envelope_delivery`）

| 值 | 做法 | 适用 |
|---|---|---|
| `stdin` | 信封 JSON 从标准输入喂给 CLI | 支持读 stdin 当 prompt 的 CLI（Codex 默认） |
| `argv` | 信封**路径**渲染进 `{{envelope}}`，或信封**内容**渲染进 `{{envelope_json}}` | 只接受 `-p <text>` / `-f <file>` 类参数、不读 stdin 的 CLI（Kimi 走 `{{envelope_json}}`） |
| `env` | 仅靠 `HARNESS_ENVELOPE` 环境变量传路径 | CLI 有自己的 prompt 组装逻辑时 |

三种方式下 `HARNESS_ENVELOPE` / `HARNESS_ARTIFACT` / `HARNESS_BATCH` / `HARNESS_TASK_ID`
都会注入环境，适配器可任选其一读取。

## 3. 产物约定

对方**唯一**的交付义务是：在 sandbox checkout 内把产物写到 `deliverable.artifact` 路径，且满足
`deliverable.schema`。**不要求它读仓内任何指令文件**——契约随信封的 `contract` 字段走。

产物里的 `waiting` 字段是中断态的降维表达（一次性进程无法「挂起等你」）：

| `waiting` | 含义 | 编排者动作 |
|---|---|---|
| `null` / 缺省 | 活干完了 | 继续状态机 |
| `"auth"` | 撞 L2 边界（真实外部服务 / 计费 / 生产写入）而 `l2_authorized=false` | **硬停**，等用户授权 |
| `"adjudication"` | 规格歧义 / acceptance 无法客观判定 | **硬停**，转 pre-impl 审计 |

对方写完 `waiting` 后**正常退出**（exit 0），不要靠非零退出码表达「我需要人」——
那会被回执推断判成 FAILED 并触发无意义重派。

## 4. 回执推断表（`validate-dispatch.sh receipt` 的实现）

| 子进程情况 | 判定 | 后续 |
|---|---|---|
| exit 0 + 产物合 schema + `waiting` 空 | `COMPLETED` | 机械回写 |
| exit 0 + `waiting: "auth"` | `AUTH_REQUIRED` | 硬停 |
| exit 0 + `waiting: "adjudication"` | `INPUT_REQUIRED` | 硬停 |
| **exit 0 但产物缺失** | **`FAILED`** | 重派上限 1 次 |
| exit 0 + 产物 JSON 非法 / 不合 schema | `ARTIFACT_INVALID` | 重派上限 1 次 |
| 非零退出 | `FAILED` | 重派上限 1 次 |
| helper 自身到期（status=`deadline`，exit 124） | `CANCELED` | 凭 `task_id` 幂等重派 |
| 外部 TERM/Cancel | `CANCELED` | 不伪装成 timeout |
| 子命令自行 exit 124 / 137 | `FAILED` | 普通非零退出 |

**加粗那行是这张表存在的理由。** 退出码 0 不等于活干完了——外部 CLI「礼貌地失败」
（打印一段说明然后正常退出）是常态。不写死这条，礼貌失败会被当成验收通过。

重派上限 1 次后仍不过 → `evaluator_cannot_verify` / `generator_cannot_deliver` 硬停 + 通知，
**绝不静默无限重跑**（沿用 autonomous-mode.md §9 的同类约束）。

## 5. 沙箱四道锁（机件 #7）

见 `sandbox-profile.sh`。摘要：

| 锁 | 实现 | 降低的风险 |
|---|---|---|
| env 白名单 | `env -i` + descriptor 显式列名 **+ 专用空 HOME（必填）** | 意外继承的环境变量与登录 shell 初始化 |
| 独立 sandbox checkout | 只读角色用 `git worktree add --detach <sha>`；Generator 用 `git clone --shared` | 正常流程中的工作区污染、并行互踩 |
| 禁 push | `GIT_CONFIG_*` env 级覆盖 `remote.origin.pushurl` | 合作型 CLI 的直接 push |
| wall-clock 封顶 | `process-timeout.py`：绝对 wall clock、独立 session/process group、TERM→有界 KILL、reap | 跑飞挂死与 suspend/resume 超期 |

`deadline_s` 与 descriptor `timeout_s` 都是 `60..86400` 的整数；boolean/float/string 拒绝。
有效值是两者最小值，信封缺 deadline 时保持 descriptor cap（缺省 3600）。helper 通过独立 status
区分自己到期、外部 signal 与普通退出，因此 child 自行返回 124 不会被运输层误判成 TIMEOUT。

adapter、timeout helper 等默认路径从 `sandbox-profile.sh` 自身目录解析；从其他 CWD 绝对调用入口
不会改成去目标仓找机件。`--adapters` 与 `--timeout-helper` 显式覆盖继续支持。

🔴 **子进程 CWD 一律固定为 sandbox checkout。** 这为合作型 `local-cli` 提供确定的相对路径语义，
不依赖各家 CLI 的 `--cd`/`-C` 是否存在；Kimi **根本没有工作根参数**。它不是文件系统隔离，
恶意同 UID 进程仍可能读取或访问其他宿主路径。（实测价值：Kimi 曾因 HOME 未展开而在 CWD 下造出字面量
`~/` 垃圾目录，CWD 锁定把该垃圾限制在一次性 checkout 内。）

🔴 **`sandbox.home_dir` 必填，且必须以 `/` 或 `~` 开头。** 外部 CLI 普遍用**登录 shell** 执行命令
（Codex 用 `/bin/zsh -lc`），它会 source `~/.zshenv` / `~/.zprofile`——其中任何 `export`
都会把 `env -i` 剥掉的变量原样还回子进程，静默击穿第一道锁。认证改用 `sandbox.env_set`
精确投喂（如 `CODEX_HOME=~/.codex`、`KIMI_CODE_HOME=~/.kimi-code`），不放行整个真实 HOME。
相对路径会被拒——它随编排者 CWD 漂移，且会让 dotfile 断言检查到一个不存在的路径而**静默通过**。

⚠️ **禁 push 绝不能用 `git remote set-url`** —— worktree 与主仓共享 `.git/config`，
那样会把主仓的 push 地址一起改掉。必须用 env 级 config 覆盖（只影响子进程，不落盘）。

## 6. generator 类产物的回流（v1.1 放开外部 generator 后新增）

外部 generator 的 `constraints.push` 恒为 `false`，交付是沙箱里的未提交 diff + handoff 清单。回流四步：

1. **diff 与 handoff 对账**：实际改动必须落在 `files_touched` 与 spec scope，超出即拒收
2. **spec-lock critic 稽核**：跑机件 #2（`.claude/agents/spec-lock-critic.md`）比对 diff 与 scope，
   稽核时机从「writeback 前」前移到「拉回主仓前」
3. **L1 全绿**：`lint / tsc / test` 是外部 generator 唯一的硬证据——代码 diff 比 verdict 更好机械核验
4. 通过后由编排者按 feature 归属提交并统一 push

### 6.1 手动 `/build` 的固定入口

当 `/plan` 已把 `progress.role_assignments.generator` 解析为 `transport=local-cli` 时，Coordinator
必须使用 `dispatch-generator-handoff.sh`，而不是自己实现 feature：

```bash
bash .claude/dispatch/dispatch-generator-handoff.sh --task-id <fresh-safe-task-id>
```

入口从当前 `progress.json` / `features.json` 读取**顺序中的第一个** pending Generator feature（可用
`--feature F001` 显式指定），构造固定 `generator-handoff` envelope，运行 transport receipt，并把
handoff 对 envelope 的 batch、feature scope、UTC timestamp 和安全相对路径做机械校验。stdout 中的 `handoff_path`、
`run_meta_path`、`envelope_path` 和 `source_ref` 是**待回流证据**；它不会复制 diff、更新状态或创建 commit。

Coordinator 先完成 spec-lock critic，再为当前项目给出严格的 `harness-l1/1` 命令文档（只含
`lint`、`typecheck`、`test` 三个 argv 数组）。接着先运行
`accept-generator-handoff.sh --handoff <...> --envelope <...> --run-meta <...> --l1-commands <...>`；
只有返回 `READY_TO_APPLY`，才可加 `--apply`。接收工具要求主仓 clean 且仍在 `source_ref`、diff 与
`files_touched` 精确一致、L1 在 sandbox snapshot 全绿；随后才会应用该单 feature diff 并创建
`feat(<batch>-<feature>): accept external generator handoff`。任一前提失效即拒收、保留 sandbox 取证。

`transport=subagent` 有两条严格分开的路径：历史 `dispatch/1` descriptor 的 host-native 路径由
Coordinator 按 descriptor 的 `agent_type` 启动；`tool-integrations/1` 的旧 `subagent: true` 只保留为
Coordinator 兼容信息，不生成可签发的 CLI candidate。`subagent: {"bridge":"..."}` 是协议声明，不是
授权。当前 release 已发布 `vm-v1` strict provider；Kimi ACP external route 只能由该 provider 在 installed
app 与项目镜像的受管 dispatch runtime 关键文件逐字节一致、当前主机给出新鲜 attestation 后公开并 launch。`sandbox-profile.sh` 的直跑
`subagent` 入口仍会拒绝，Codex 继续仅可用 `local-cli`。未来 provider 仍必须满足
[`external-bridge-provider.md`](external-bridge-provider.md) 的独立 principal、copy-in/copy-out、brokered
credential/egress 与 provider-owned lifecycle 契约，才可公开相应 bridge。没有 assignment 的 fast 路径保持旧本机流程。`transport=a2a`
的 Generator source-handoff protocol 尚未实现，手动入口明确 fail closed，不能退化到本机或 local-cli。

## 7. 新增一家 CLI 的核对清单

`adapters/<name>.json` 填完即可接入，但**开车前必须逐条实测核对**，把 `_verified` 置 `true` 并记录 CLI 版本：

| # | 核对项 | 为什么 |
|---|---|---|
| 1 | `argv` 在当前 CLI 版本下语法正确（flag 名、工作根语义、免交互开关） | flag 会随版本变；错一个字沙箱就跑空 |
| 2 | 该 CLI 在 `env -i` + 专用空 HOME 下能正常启动（认证不依赖白名单外的变量） | 认证挂了会表现为「礼貌失败」，比崩溃更难发现 |
| 3 | **它用什么 shell 执行命令**（`ps`/日志里看是否 `-l` 登录 shell） | 决定 dotfile 还原风险；登录 shell ⇒ 专用空 HOME 必须干净 |
| 4 | **它自己的沙箱/审批参数是否被显式传入**（而非读用户 config） | 用户 config 可能把它调成 full-access，静默削弱我们的沙箱 |
| 5 | 非交互模式确实不会卡在 TTY 等待输入 | 否则只能靠 timeout 兜底，浪费一个封顶周期 |
| 6 | 它写产物的路径与 `artifact_relpath` 一致 | 不一致 ⇒ 回执恒为 `ARTIFACT_MISSING` |
| 7 | 它撞 L2 时写 `waiting` 而非非零退出 | 非零退出会被判 FAILED 并触发无意义重派 |

### 7.1 Codex 核对记录（codex-cli 0.145.0 · 2026-07-25 · 通过）

| # | 结论 |
|---|---|
| 1 | `codex exec --json --ephemeral -C <wt> -s workspace-write -` ✅。`exec` 省略 PROMPT 或写 `-` 时从 stdin 读指令 |
| 2 | ✅ 认证在 `$CODEX_HOME/auth.json`；`sandbox.env_set = {"CODEX_HOME": "~/.codex"}` 即可，无需放行真实 HOME |
| 3 | 🔴 **用 `/bin/zsh -lc`（登录 shell）** —— 本条正是 `home_dir` 升为必填的直接原因 |
| 4 | 🔴 `-s/--sandbox` 不显式传会读 `~/.codex/config.toml`；适配器显式传 `workspace-write` 覆盖。**不得使用 `--dangerously-bypass-approvals-and-sandbox`** |
| 5 | ✅ `exec` 全自动，未观察到 TTY 阻塞 |
| 6 | ✅ 按信封 `deliverable.artifact` 写到 `docs/test-reports/<batch>-verdict.json` |
| 7 | ⚠️ **未覆盖** —— 演练用的是 L1-only 场景，`waiting` 路径未经真实 Codex 触发验证（回执侧已单测） |

**演练结论：** 植入一处真实缺陷（slugify 未剥离首尾连字符）后派活，Codex 自行编写测试、
运行、精确命中该缺陷并判 `PARTIAL`，证据含实际值 `-hi-` 与期望值 `hi`。全程 267s，
四道锁全部守住（凭据零泄漏、主仓零改动、`src/` 未被动、无 push 尝试）。
—— 这条演练同时验证了它**不是橡皮图章**：全 PASS 的结果无法区分「真验了」与「没验」。

### 7.2 Kimi 核对记录（kimi-code 0.26.0 · 2026-07-25 · 通过）

| # | 结论 |
|---|---|
| 1 | `kimi -p <envelope_json> --output-format stream-json` ✅。prompt 走 **argv 字面文本**（不读 stdin）→ 用 `{{envelope_json}}` 内联 |
| 2 | ✅ 数据目录由 `KIMI_CODE_HOME` 决定（回落 `~/.kimi-code`）；`sandbox.env_set` 投喂即可 |
| 3 | ⚠️ 未观测到（`stream-json` 事件未暴露执行 shell）。按最坏情况处理：专用空 HOME 照样必填 |
| 4 | 🔴 **prompt 模式拒绝一切权限旗标**——`--auto` 与 `--yolo` 均报 `Cannot combine --prompt with ...`；而 `-p` 单独运行**已隐式自动批准工具使用**（实测无旗标即创建文件、跑命令）。**厂商侧零约束** |
| 5 | ✅ `-p` 全自动，未观察到 TTY 阻塞 |
| 6 | ✅ 按信封 `deliverable.artifact` 写到 `docs/test-reports/<batch>-verdict.json` |
| 7 | ⚠️ **未覆盖** —— 同 Codex，演练为 L1-only 场景 |
| 附 | 🔴 **无 `-C`/`--cd` 工作根参数** → 依赖沙箱的 CWD 锁定 |

**安全姿态与 Codex 的差异（重要）：** Codex 有 `-s workspace-write` 这一厂商自带的沙箱级别作为第二道防线，
显式传参还能覆盖用户 config 的削弱；**Kimi 在非交互模式下没有任何可配的权限层**。
因此派 Kimi 时，机件 #7 的进程级四道锁 + CWD 锁定是**唯一防线**，没有兜底。

**演练结论：** 同一植入缺陷场景（`slugify` 未剥离首尾连字符），Kimi 自写测试、运行、判 `PARTIAL`，
证据不仅给出实际值 `-hi-` vs 期望 `hi`，还定位到 `src/slugify.js:3` 并解释了成因。169s，四道锁全守。

### 7.3 未纳入模板的适配器

未在本机实测核对的适配器**不写进模板**——一个 `_verified: false` 的机件被误用，
比没有这个机件更危险。Gemini 适配器因本机未安装 gemini CLI 而暂缺；
去偏轮换池当前为 `claude` × `codex` × `kimi` 三个 family。
