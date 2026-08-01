# Console Mode —— 自托管多项目控制台（观测面 + 人闸门）

> **状态：P1/P2 已实装。** 服务在 `console/`（自托管，不随 bootstrap 铺进项目）；
> 项目侧机件在 `.claude/console/`（闸门契约 + 校验器 + 人类批准 CLI，随 bootstrap 铺入）。
> 决策回传有**两条通道**（§2）：git（控制台持 push 权限）或 device agent 中继（控制台零 git 权限，需 §3.2 验签模式）。
> **P3（agent 实时日志上报）/ P4（云端跨机调度）已设计未实装**，见 §7。
>
> **加载层级：T2（按需）。** 仅在部署/运维控制台时加载。
>
> **来源：** 用户三项裁决——数据边界=全量日志（自托管前提下）· 部署=自托管小服务 · 优先级=人闸门优先。

---

## 0. 前提：控制台是辅助工具，不是依赖

**没有控制台，harness 照常跑。** 状态机、闸门、批准、验收全部在机器上完成：闸门由
`.claude/console/` 的三个机件（schema / guard / `approve-gate.sh`）自洽守门，人类持私钥
即可在本机批准（§3.3）。控制台只做两件锦上添花的事——把多个项目的进度**看**在一处，
以及让你**不在这台机器前**时也能批准。它挂了，影响的只是这两件事。

任何让「控制台在线」成为开发或批准前提的设计，都违反本文件的红线（§8）。

## 1. 一条决定形态的红线：控制台不是编排者

harness 是 **hub 形态、状态机唯一持有者、git 是唯一真相源**。
`dispatch-mode.md` L4 与 `orchestration-patterns.md` §8 都钉死「引擎永不自己按阶段推进键」。
控制台若变成 hub，就会撞上 A2A 研究里那句判断——「点对点委托无全局工作流概念，
链式转委托无人持有全局真相、崩了无法对账」。

> **控制台 = 观测面 + 人闸门 UI + （P4）注册中心。编排者仍在某台机器上，git 仍是真相源。**
> 云端改配置不是「下发指令」，而是**生成一个人类签名的 commit**，机器侧 pull 到才生效。

这与 `/dashboard` 一脉相承——它已经写着「看板是只读镜像，不是真相源」。
控制台是它的多项目、可交互版本，不是另起炉灶。

## 2. 传输：两条通道，同一个真相源

**通道 A —— git（原生，`console/server.py` 走这条）：** 控制台在自己所在机器维护各项目的
**本地克隆**，定时 `git pull` 读状态；批准时写 `pending_gate.decision` 并 `commit + push`。
**不依赖 GitHub API**（任何 remote 都能用），**不引入第二个真相源**，
且和其他所有参与方（编排者、a2a runner、外部 CLI）用的是同一条总线。
**代价：控制台必须持有各项目的 push 权限**——它是唯一持有该凭据的组件（见 §5）。

**通道 B —— device agent 中继（推荐；需 §3.2 验签模式）：** 控制台只**签发**一条带签名的
决策，由机器上已有的**出站轮询** agent 拉走、验签后写进本机 `progress.json` 并 commit。

```
控制台（持私钥，签发）  →  device 通道（agent 主动出站拉取）  →  机器（验签后落盘 + commit）
```

三处好处，每一处都对应通道 A 的一个代价：控制台**不需要任何项目的 git 写权限**；
不需要能连到机器（**天然穿 NAT**，不必给内网机器开入站）；不需要为每个项目维护本地克隆。
**真相源没有变**——决策照样落成 git 里的一个 commit，只是搬运工从控制台换成了机器自己。

两条通道的守门是同一个 `validate-pending-gate.sh guard`：通道 A 靠「比对 HEAD」（信任在
**传输路径**），通道 B 靠「验签」（信任在**内容本身**）。**通道 B 没有验签模式就不成立**——
见 §3.2。

## 3. 闸门契约（P2 的地基）

在此之前闸门只以散文记在 `session_notes`，`autonomy.last_halt` 只是**事后记录**——
没有「人类回写批准、机器再消费」的槽位，控制台既无从展示也无从批准。故新增 `progress.json.pending_gate`：

```jsonc
{ "pending_gate": {
    "id": "BL-042-verifying-done-w7",     // 幂等键；decision 必须引用它
    "kind": "phase_advance",              // l2_auth / adjudication / debias_conflict / scope_drift / budget / spec_lock
    "raised_at": "...", "raised_by": "autodriver",
    "batch": "BL-042", "from_status": "verifying", "to_status": "done",
    "detail": "全 acceptance PASS + L1 绿 + signoff 已写，等人类批准跨 Class B 闸门",
    "evidence": ["docs/test-reports/BL-042-verdict.json"],   // 只放路径，不内联正文
    "decision": null } }
```

| 谁写 | 写什么 |
|---|---|
| 机器（autodrive / verify / build） | 举起闸门；消费完把整个 `pending_gate` 置 `null` |
| **只有人类 / 控制台** | `decision` |

### 3.1 🔴 为什么 `decision` 必须机械守门

它是「人类批准」在 git 里的**唯一表示**。agent 若能写它，「阶段推进键归人」「L2 需授权」
就全部退化成自觉——写一条 approve 即可跨过任何闸门。

工具层拦不住（`progress.json` 必须允许 agent 写 status），所以在**内容层**拦：
`validate-pending-gate.sh guard` 比对工作区与 HEAD，`decision` 若是本地新增/修改即拒。

**两条合法路径：**
- 人类跑 `approve-gate.sh`（走 Bash，不触发 PostToolUse hook）→ 写入并立即 commit
- 控制台提交 → 机器侧 `git pull` → decision 随 HEAD 到达 → guard 放行

**被拒的：** agent 用 Write/Edit 直接写 decision · 举新闸门时顺手带 decision · 篡改已有 decision（如把 `once` 改成永久）。
**允许的：** 消费完批准后清空整个 `pending_gate`（正常收尾，不是盖章）。

**陈旧批准防护：** `decision.gate_id` 必须等于 `pending_gate.id`——一张批准只对它自己那个闸门有效。

### 3.2 验签模式（推荐；中继通道的前提）

上面的「比对 HEAD」把信任放在**传输路径**上（decision 必须经 git 到达）。这条路要求
控制台持有各项目的 push 权限，且无法支持「控制台 → device agent → 本机落盘」这种中继。

配了 `.claude/console/console.pub` 后切换到**验签模式**：信任转移到**内容本身**。

```
控制台服务端持 Ed25519 私钥（环境变量注入，绝不入仓库）
   sign(canonical(decision 除 sig 外的全部字段))
        ↓ 经已认证的 device 通道下发
device agent 把 decision + sig 写进本机 progress.json
        ↓
validate-pending-gate.sh guard 用仓库里的 console.pub 验签
```

写代码的 agent 读得到公钥、**伪造不了签名**，于是「本地写入」不再可疑——
中继通道由此成立，且控制台不再需要任何项目的 git 写权限。

**🔴 必须签全字段。** 载荷 = `decision` 里除 `sig` 外的**全部**字段（键排序、紧凑分隔符、UTF-8）。
只签 `{action, at, by, gate_id}` 会留下缺口：`scope` 未被签名，agent 可以把
`once: true` 改成永久授权而签名依然有效——**实测踩到过**。

**跨语言一致性已验证：** Node（tokenizer 服务端）与 openssl（校验器）对同一载荷产生
**逐字节相同**的签名（Ed25519 是确定性签名），互相可验。
验签器在 macOS 上会跳过不支持 Ed25519 的系统 LibreSSL，依次尝试
`HARNESS_OPENSSL`、PATH 和 Homebrew OpenSSL 3 标准路径；无可用实现时报运行时缺失，
不冒充为「签名无效」。

密钥生成：`bash .claude/console/gen-console-key.sh <outdir>`。
两种模式各自 fail-closed：配了公钥 → 无签名/签名无效一律拒；未配公钥 → 回退比对 HEAD。

> **若用户让 agent 代为批准：** 拒绝，并请用户自己用 `!` 前缀执行
> `! bash .claude/console/approve-gate.sh --approve --by <你>`。
> 「人闸门归人」的意思就是这一步不能由 agent 完成，无论谁要求。

### 3.3 🔴 本机批准不依赖控制台

**控制台不是批准权的来源，只是同一把私钥的另一个持有者。** 验签模式**不得**把「人类能否
批准」变成「控制台是否在线」——那等于把红线 §8.1（推进键在机器侧）交给一个可用性组件。

`approve-gate.sh` 在两种模式下都自足：

| 模式 | 脚本行为 | guard 判据 |
|---|---|---|
| 无 `console.pub` | 写明文 decision + commit | 比对 HEAD |
| 有 `console.pub` | **本机用私钥签名**（openssl，与控制台逐字节等价）后 commit | 验签 |

私钥按序探测：`--key <路径>` → `$HARNESS_CONSOLE_KEY` → `~/.harness-console/console.key`；
也支持 `--key keychain:<服务名>` 从 macOS 钥匙串取。**控制台挂了、网络断了、密钥没上云，
本机批准照常可用**；日常开发从不需要控制台在线。

**三条 fail-closed，都在写盘之前或提交之前拦住：**
- 验签模式下拿不到私钥 → **当场退出**，`progress.json` 一个字节都不改
  （若先写后查，留下的是一条永远过不了 guard 的 decision，而 fail-closed 的 hook 会把
  整个批次卡死到人工回滚为止——这正是 v1.3.2 时踩到的）
- 私钥与仓库里的 `console.pub` 不是一对（比如轮换后拿了旧的）→ 拒，不签
- 写完先自检：验签模式**提交前**跑 guard；比对 HEAD 模式的判据就是「随 HEAD 到达」，
  故**提交后**跑，不通过则给出确切的回退命令（不自动改写历史）

**⚠️ 私钥与 agent 同机时的残余风险：** 私钥放在本机文件里，跑在同一台机器上的 agent
原则上也读得到——「agent 伪造不了签名」这条保证就退化成文件权限加你对 agent 的约束。
要把它拿回来，把私钥放进钥匙串并要求每次确认（`-T ""`，见脚本文末「加固」）：
无人值守的 agent 过不了系统授权框，而你本人过得去。

### 3.4 签名模式意图（v1.6；只影响下一批次）

控制台可以签发人类 intent；tokenizer device agent 验签后只把它暂存在项目自己的
`harness.json.project.mode_defaults`。控制台不写 `progress.json`、角色分配或自治策略，当前 active batch
也绝不改变。历史 **v1** 的 agent-id 形状继续可读、可消费，供已签发 intent 和旧 device agent
平滑过渡：

```json
{
  "intent": {
    "intent_id": "intent-01",
    "repo_key": "github.com/acme/project",
    "expected_head_sha": "0123456789abcdef0123456789abcdef01234567",
    "desired": {
      "execution": {
        "profile": "slow",
        "role_assignments": {
          "generator": "builder-codex",
          "evaluator": "reviewer-kimi-a2a"
        }
      },
      "autonomy": {
        "enabled": true,
        "expires_at": "2026-07-28T18:00:00Z",
        "auto_cross": ["A", "B"],
        "budget": {
          "max_tokens": 50000,
          "max_cost_usd": 10,
          "max_wakes": 8,
          "max_fix_rounds": 2
        }
      }
    },
    "issued_by": "human@example.com",
    "issued_at": "2026-07-27T18:00:00Z",
    "intent_expires_at": "2026-07-28T00:00:00Z",
    "sig": "<base64 Ed25519>"
  },
  "staged_at": "2026-07-27T18:00:05Z"
}
```

新签发的 **v2** 不再把任何具体 agent id 放进人类签名内容。人类只选择 Harness 已支持的 CLI
工具及调用方式；设备在下一次 `/plan` 才从本地候选池解析实际 descriptor：

```json
{
  "intent": {
    "intent_id": "intent-tool-01",
    "repo_key": "github.com/acme/project",
    "expected_head_sha": "0123456789abcdef0123456789abcdef01234567",
    "desired": {
      "execution": {
        "profile": "heterogeneous",
        "role_bindings": {
          "planner": { "tool": "kimi", "invocation": "local-cli" },
          "generator": { "tool": "codex", "invocation": "local-cli" },
          "evaluator": { "tool": "claude-code", "invocation": "subagent" }
        }
      },
      "autonomy": { "enabled": false }
    },
    "issued_by": "human@example.com",
    "issued_at": "2026-07-31T18:00:00Z",
    "intent_expires_at": "2026-08-01T00:00:00Z",
    "sig": "<base64 Ed25519>"
  },
  "staged_at": "2026-07-31T18:00:05Z"
}
```

Planner 下拉框的第一项是不可配置的 **Coordinator**，对应签名值 `planner: null`。这表示当前主会话负责
规划；它不生成内部 target，也不进入 `progress.role_assignments`。如果用户选择 CLI Planner，才填写
`{ "tool": "...", "invocation": "..." }`，并在下一次 `/plan` 走受限 proposal 路径。

`fast` 的 v2 `role_bindings` 必须为 null，保留本机默认路径。非 fast 的 v2 bindings 必须含
Planner、Generator、Evaluator 三个键，其中 Planner 可以是 `null`；其余解析出的 agent id 只记录在 `progress.role_assignments` 和
`progress.mode_intent.resolution` 中，绝不可回写进签名 intent。消费者还必须把**完整原始 signed
intent（含 `sig`）**写入 `progress.mode_intent.signed_intent`：它是 active batch 的 checkpoint；随后可为
下一批替换的 `harness.json.project.mode_defaults` 绝不能改变本批执行者。运行路径从 checkpoint 重验后取得
六字段 active record（含 `execution_provenance_sha256`）；该摘要同时固定 target、adapter、sandbox、timeout、
bridge/A2A 等执行语义。`role_assignments` 与 `resolution` 只保留审计用途。用户签名仍只覆盖
`{tool, invocation}`，摘要用于运行时 drift guard，不是项目文件的加密防篡改证明；旧五字段 active v2 checkpoint
升级后必须重新 `/plan` 并 consume。

设备在**可信端**解析 `tool-integrations/1` registry 与已验证 adapter 的 data-only `tool-catalog/1` 契约，生成按角色分组、
只含 `{tool, label, invocation, agent_count, model_families, capabilities}` 的能力目录。目录不含 agent id；
新的 CLI 只需在 `integrations` 中声明工具，并为 `local_cli` 提供已验证 adapter；框架会自动派生三角色的
候选，`a2a_targets` 自动派生 Planner/Evaluator 目标，无需修改控制台 schema 或 UI。目录不可生成或安全
校验失败时，控制台必须禁用 v2 签发，而不是猜测工具名。

**Coordinator 是固定控制面。** 当前主会话负责验签、解析、派发、校验 proposal/handoff/verdict、展示
需要人类确认的内容并在确认后落盘。它不在上述三个 selector 中，不可配置，也不得替代已经绑定的执行角色。

**签名载荷是 `intent` 中除 `sig` 外的全部字段**：递归键排序、紧凑 JSON separators
`(',', ':')`、UTF-8、`ensure_ascii=false`。`staged_at` 是 device agent 写下的本机接收元数据，不在签名内；
mode defaults 不接受其他字段。`.claude/console/validate-mode-intent.sh` 使用项目内
`.claude/console/console.pub`，并拒绝签名篡改、过期、repo 身份不符或任何白名单外字段。

profile 语义是机械护栏：v1 的 `fast` 要求 `role_assignments=null`；v2 的 `fast` 要求
`role_bindings=null`。v2 的 `heterogeneous` 要求所有已配置外部角色均非 a2a 且至少一方为 local-cli；`slow`
要求所有已配置角色中至少一方为 a2a。Generator / Evaluator 必须能解析出不同 model family；Planner 可以
为 Coordinator 或与任一方同 family。v1 仍按其原有的 Generator/Evaluator agent-id 规则验证，兼容既有签名。

自治关闭必须严格为 `{ "enabled": false }`，没有预算或其他 policy 字段；下一次 `/plan` 会保持手动模式并
删除旧批次遗留的 `autonomy-policy.json`。自治开启才需要独立的绝对未来 `expires_at`、唯一 A/B
`auto_cross`、四项有上下界的 budget，以及可选 intervals/notifications。

**HEAD phase rule：** `expected_head_sha` 是 device agent 的一次性 staging 前置条件。device agent 只在原子写入
并提交 `harness.json` 的前一刻比较真实 HEAD；这个 staging commit 随即改变 HEAD，之后状态机提交还会继续改变。
因此 `/plan` 只复验签名、shape、期限、repo identity、Agent 和安全语义，绝不再要求当前 HEAD 相等。

激活步骤见 `planner.md` §0c：仅 `status=new` 或完成态开始新批次时消费，并记录
`progress.mode_intent={intent_id,applied_batch,applied_at,signed_intent,resolution,adapter_dir?}`（`signed_intent`/
`resolution` 只用于 v2 non-fast；`adapter_dir` 只在消费命令显式传入项目内 `--adapters` 时出现）。该目录不是
人类可选角色或签名字段，active 命令只可恢复同一路径，不能用另一个 adapter 目录覆盖。没有 mode intent 时仍走完整本机手工流程。

## 4. 组件

| 组件 | 位置 | 随 bootstrap 铺入 | 状态 |
|---|---|---|---|
| 闸门 schema | `.claude/console/pending-gate.schema.json` | ✅ | 已装 |
| 闸门校验器（schema/guard/hook） | `.claude/console/validate-pending-gate.sh` | ✅ | 已装 ✅ 实测 |
| 人类批准 CLI（两模式自足，含本机签名） | `.claude/console/approve-gate.sh` | ✅ | 已装 ✅ 实测 |
| 模式意图 schema + `/plan` 验签器 | `.claude/console/mode-intent.schema.json` + `validate-mode-intent.sh` | ✅ | 已装 ✅ fixtures |
| PostToolUse 接线 | `.claude/settings.json` | ✅ | 已接 |
| 控制台服务（通道 A） | `console/server.py` + `ui.html` | ❌ 自托管，单独部署 | 已装 ✅ 实测 |
| 密钥生成（验签模式） | `.claude/console/gen-console-key.sh` | ✅ | 已装 ✅ 实测 |
| 公钥（验签模式的开关） | `.claude/console/console.pub` | ❌ 各项目自行放入 | 按需；放了就切验签模式 |
| 中继实现（通道 B） | 另一工程（tokenizer）：服务端签发 + device agent 验签落盘 | ❌ 不属于本框架 | 已实装 ✅ 生产往返实测 |

**通道 B 的实现不在本仓库**——它借的是一个已有 device agent 的工程（tokenizer：设备注册 +
per-device 凭据 + 出站轮询）。框架这边只规定**契约**：签名载荷的规范化方式（§3.2）、
`decision` 的字段白名单（schema）、以及机器侧的验签守门。任何持有出站 agent 的系统都能按
这份契约接上，不必是那一个工程。

## 5. 部署

```bash
# 在 VPS 上：把各项目克隆到一处
git clone <repo> /srv/repos/kolmatrix
cp console/console.config.example.json console/console.config.json   # 填 projects

export HARNESS_CONSOLE_TOKEN=<token>          # 绑非 loopback 时必需，否则拒绝启动
python3 console/server.py --config console/console.config.json --host 0.0.0.0 --port 41300
```

访问 `http://<host>:41300/?token=<token>`。**建议放在反代 + TLS 之后**——当前只有 Bearer，无 TLS 终结。

**走通道 A 时，控制台需要各项目的 push 权限**（写 decision）。它是**唯一持有该凭据的组件**——
机器上的 agent 没有控制台凭据，控制台也没有 agent 的执行能力。这个分离本身就是护栏。

**走通道 B 时这条凭据就不存在了**：控制台只持 Ed25519 私钥（环境变量注入，绝不入仓库），
不持任何项目的 git 权限。少一份长期凭据，且私钥泄露的后果比 push 权限泄露**更容易收敛**——
换一对密钥、把新 `console.pub` 提交进各项目即可，不必去每个 remote 上吊销权限。
两条通道可以并存：配了 `console.pub` 的项目走验签，没配的仍按比对 HEAD 走 git。

## 6. 安全模型

| 面 | 处置 |
|---|---|
| 绑定 | 非 loopback 必须有 token，否则拒启（fail-closed，同 a2a-runner） |
| 取证读取 | 只允许仓库内 `docs/` 下的文件，路径穿越与 `docs/` 外文件一律拒；>512KB 拒 |
| 写权限 | 控制台**只写 `pending_gate.decision` 一个字段**，不碰 status / features / policy |
| 归属 | 每条 decision 带 `by` + `at`，并落成一个独立 commit（`chore(gate): ...`），审计轨迹在 git 里 |
| 越权批准 | 提交前跑项目自己的 `validate-pending-gate.sh schema`；不通过则回滚，不绕过项目守门 |
| 并发 | 批准前先 `git pull --ff-only`；闸门 id 不匹配或已有 decision 一律拒（409） |

**🔴 P3 开启后的额外义务：** 全量日志上报会把命令输出、代码片段、**报错正文里的凭据片段**
持久化到控制台所在机器。那台机器从此必须按「持有密钥的系统」对待：磁盘加密、访问控制、
明确的日志留存期。这是选择「全量日志 + 自托管」这一组合时接受的代价——
自托管让数据不出自己的边界，但边界内的这台机器责任变重了。

## 7. 未实装（设计已定）

- **P3 agent 实时日志上报：** a2a-runner 已有事件流（jsonl + 单调 seq + SSE）。
  缺 `--report-to <console>` 出站上报。**默认关闭**，开启前先读 §6 最后一段。
- **P4 云端跨机调度：** 需要机器注册 + 心跳 + 任务路由，以及一个**架构反转**——
  runner 现在是 server（要求云端能连它），而真实跨机器时机器多在 NAT 后。
  现实做法是把 runner 改成主动连云端拉任务；`taskId` / 幂等 / 事件序号语义可整套保留。
  **通道 B 已经把这个反转跑通了一遍**（出站轮询 + per-device 凭据 + 幂等下发 + 回执消费），
  P4 可以照搬这条形状——差别只在于载荷从「一条决策」变成「一批活」，且多出「派活前断言
  目标机器机件在位」这一条（见下）。
  另需 per-machine 凭据（现在是共享 Bearer），以及**派活前断言目标机器机件在位**——
  Agent Card 的 `x-harness.sandboxed` 是声明不是证明，跨机器需要更硬的东西（如机件文件哈希）。
- 多操作员与权限分级（现在是单 token 单 operator）
- TLS 终结（现在依赖外部反代）

## 8. 红线

1. 控制台不得写 `status` / `features` / `autonomy-policy.json`——推进键仍在机器侧。唯一新增能力是
   签发 §3.4 的下一批次 intent；device agent 暂存、Planner 在新批次边界物化
2. 控制台是只读镜像，渲染出错不影响状态机；真相永远在 `progress.json` / `features.json`
3. `pending_gate.decision` 只有人类/控制台可写，agent 侧机械拒绝（§3.1）
4. 沙箱（机件 #7）永远在执行机器上生效；控制台不执行任何批次工作
5. **开发与批准都不得依赖控制台在线**（§0 / §3.3）——控制台只是同一把私钥的另一个持有者，
   不是批准权的来源。任何把「控制台可达」变成前提的改动，先改这条红线再说

---

## 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-07-25 | 初版（v1.3）：闸门契约 `pending_gate` + 自我盖章 guard + 人类批准 CLI + 自托管控制台（观测面 + 人闸门 UI） | 用户三项裁决；P3/P4 设计已定未实装 |
| 2026-07-25 | v1.3.1：`decision` Ed25519 验签模式（§3.2）——信任从传输路径移到内容本身，中继通道的前提 | 实测 6 项；跨语言（Node × openssl）一致性已验 |
| 2026-07-25 | v1.3.2：通道 B 实装 —— §2 改写为两条通道；§4 补中继行与契约边界；§5 说明 push 权限只在通道 A 需要 | tokenizer 工程按本契约接入；本机整栈 + 生产各跑通一次完整往返 |
| 2026-07-25 | v1.3.3：`approve-gate.sh` 支持本机签名（`--key` / 钥匙串），新增 §0 与 §3.3、红线第 5 条 —— 本机批准与开发一律不依赖控制台 | 用户裁决：控制台只是辅助工具；修掉 v1.3.2 记录的验签模式缺陷 |
| 2026-07-27 | v1.5：签名 `project.mode_defaults` 只在下一批次边界生效；HEAD 只在 device staging 前比较 | BL-HARNESS-DETAIL-MODEINTENT F001 |
