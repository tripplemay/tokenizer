# BL-NATIVE-SUBAGENT-BRIDGES · 对抗复核（证伪）报告

- **任务性质：** 对两份非 PASS 复验报告的核心论断做**证伪尝试**；推翻不了才算 confirmed
- **锁定 SHA：** `172ed42b5c4d910c7f194a6fab835c8ac74f19e7`（已核对 HEAD 一致）
- **日期（UTC）：** 2026-08-04
- **执行者：** fresh-context evaluator subagent（隔离上下文，自行从磁盘取证）
- **待证伪对象：** `…-reverify-F005-2026-08-04.md`（FAIL）、`…-reverify-F003-2026-08-04.md`（PARTIAL）
- **结论：** **论断 1 confirmed · 论断 2 confirmed**（两条均未能推翻）

> 本报告不采信任何一份复验报告的叙述。下列每条结论都由我自己发起的命令产生；
> 凡与原报告结论一致者，均为独立复现而非转述。
> **未修改任何产品代码**；新增产物仅 `tests/evaluator/adv_review_lifecycle_safety.py` 与本报告。

---

## 1. 论断 1：external vm-v1 bridge launch 路径确定性失败

**待证伪表述：** launch 时以 `/usr/bin/python3 -I` 重解析 target，isolated mode 使
`tool-catalog.py` 的 `from dispatch_common import …` 必然 ModuleNotFoundError →
`bridge target cannot be re-resolved`；已发布的 bridge 不可启动，且**不存在其他合法启动路径**可绕过。

### 判定：**confirmed**（6 条证伪尝试全部失败）

### 1.1 我的证伪尝试与结果

| # | 证伪假设（若成立即推翻论断） | 实测结果 | 是否推翻 |
|---|---|---|---|
| A | 失败其实由**凭据过期**引起，非 `-I` | 失败瞬间 `doctor` 返回 `available=true`（attestation `expires_at=03:31:29Z`），**同一 target 在数秒前解析成功** | ❌ |
| B | `-I` 未必移除脚本目录（版本/平台差异） | 合成同级模块对照：3.9.6 与 3.11.15 **均** ModuleNotFoundError | ❌ |
| C | `dispatch_common` 可从系统 site-packages 导入 | `/usr/bin/python3 -I -c "import dispatch_common"` → ModuleNotFoundError | ❌ |
| D | 运维可用 `PYTHONPATH` 绕开 | `-I` 隐含 `-E`：带 `PYTHONPATH` 仍 ModuleNotFoundError | ❌ |
| E | 可改用**项目内** provider 副本启动 | 被信任边界拒绝：`VM provider was not launched from the installed app bundle` | ❌ |
| F | 存在**其他已发布 bridge 路由**（host-native 等）可达成同一验收 | 唯一 manifest 为 `kimi-acp-native-agent`（same-session/vm-v1）；`host-native` 是 Coordinator 自有 Claude 路径，`dispatch-run.sh:293-294` 明确 die；`sandbox-profile.sh` 对**所有** subagent transport fail-closed | ❌ |

### 1.2 关键实测（比原报告更紧的对照）

两臂**同一凭据窗口内相隔数秒**执行，彻底消除 TTL 混淆：

```
[A] env -i … /usr/bin/python3 -I  <bundle>/tool-catalog.py target … --target-id subagent--kimi--evaluator
    → line 34, in <module>  from dispatch_common import (
      ModuleNotFoundError: No module named 'dispatch_common'      EXIT=1

[B] env -i … /usr/bin/python3     <bundle>/tool-catalog.py target … （其余完全相同）
    → EXIT=0，execution_provenance_sha256 = b806e950653e0b05…
```

**真实 launch（生产 argv，L2 已授权）：**

```
/usr/bin/python3 -I ~/.tokenizer/app/framework/templates/claude/dispatch/transports/vm-bridge-provider.py \
  launch --agent subagent--kimi--evaluator --envelope … --expected-provenance b806e950…
→ [vm-bridge-provider] bridge target cannot be re-resolved      LAUNCH_EXIT=2
```

**4/4 次**（1 次 + 3 次连续）结果一致。同一时刻 `doctor` 为 `available=true`。

### 1.3 代码层结构性核实（"无其他合法路径"这一半）

- `vm-bridge-provider.py` 仅 3 个子命令：`catalog-attest` / `doctor` / `launch`（:2113-2115）；
- `launch()` **无条件**调用 `_resolve_launch_target`（:1893），`--expected-provenance` 为 required（:2122）——不存在跳过重解析的分支；
- 重解析 argv 硬编码 `-I`，env 为字面量 `{PATH, LANG, LC_ALL}`，无 `PYTHONPATH`（:1799-1818）；
- `catalog = app_root / "framework/templates/claude/dispatch" / "tool-catalog.py"`，`_trusted_app_bundle_root()` 要求 provider 自身即安装包内文件（:1721-1730）；
- `tool-catalog.py:34` 为模块级同级导入，其上（:19-41）**无任何 `sys.path` 引导**；
- **无漂移：** bundle 与项目内 `tool-catalog.py`（`eb236f2491c437e4…`）、`vm-bridge-provider.py`（`1b43b91bd2645b20…`）sha256 逐字节相同。

**不对称性成立（为何目录发布正常而启动必炸）：** `vm-bridge-provider.py` 的导入区（:15-40）**全为标准库**，故 `dispatch-run.sh:420` 对 provider 自身用 `-I` 无害；缺陷只在"以 `-I` 调用带同级导入的 `tool-catalog.py`"时触发。此解释我已逐行核对属实。

### 1.4 后果的独立佐证

`~/.tokenizer/harness/vm-v1/runs/` 内仅有 `.launch.lock` 与空的 `source-stages`，**无任何 run-meta** ——
本机从未产生过一次成功 launch，故"合格 parent-child provenance 为零"属实。
F005 acceptance 明文要求"**在 strict provider 中**执行真实 parent-child bridge probe"，
而 strict provider 正是唯一不可启动的那条路径 → 该验收项在本 SHA 上结构性不可达。

### 1.5 对原报告的一处修正（不影响结论）

F003 报告 §6.2 的对照命令用的是 `~/.tokenizer/app/.claude/dispatch/tool-catalog.py`，
而 provider 实际使用的是 `APP_BUNDLE_RELATIVE = framework/templates/claude/dispatch` 下的副本。
两文件确实存在且同尺寸，故其结论不受影响，但**该复现步骤本身并未走生产路径**。
F005 报告 §7 用的是正确路径。

---

## 2. 论断 2：`test-lifecycle.py` 的失败是过时断言，安全属性仍成立

**待证伪表述：** 该 1 项失败是过时断言（期望旧拒绝文案），其守护的安全属性
（fail-closed exit 2、不创建 workroot/state、不触达 Seatbelt 路径）在锁定 SHA 上仍成立，非安全回归。

### 判定：**confirmed**

### 2.1 "过时断言"这一半 —— git 溯源坐实

| 事实 | 证据 |
|---|---|
| 断言 `assertIn("target id is not registered")` 引入于 | `a3acac5`（fixing 轮**之前**） |
| 当前 die 文案 `external same-session bridge does not launch here` 引入于 | **`ff896dd`（本轮 fixing 提交）** |
| `test-lifecycle.py` 最后一次改动 | 仍是 `a3acac5` —— fixing 轮**未同步更新** |

`ff896dd` 对 `sandbox-profile.sh` 的全部改动 = **6 行注释 + 1 行 die 字符串**，
guard 位置与 `mkdir -p "$WORKROOT"` 的相对次序**未变**。即：行为边界没动，只有文案与拒绝点表述变了 → 断言过时成立。

### 2.2 "安全属性仍成立"这一半 —— 独立补齐测试从未执行的断言

失败发生在第 320 行。**第 319 行 `assertEqual(returncode, 2)` 是通过的**（fail-closed 由测试自身证实），
而第 321-322 行的 workroot/state 断言从未执行。我另写独立探针补齐，并**扩大到原测试未覆盖的场景**：

`tests/evaluator/adv_review_lifecycle_safety.py` — **5 tests, OK**

| 场景 | exit | workroot 创建 | state 创建 | 触达 Seatbelt |
|---|---|---|---|---|
| 原 fixture（registry 声明 subagent bridge） | 2 | 否 | 否 | 否 |
| 同上 ×3 连续 | 2 | 否 | 否 | 否 |
| registry **未**声明 subagent（旧文案场景） | 2 | 否 | 否 | 否 |
| 未知工具 `subagent--ghost--evaluator` | 2 | 否 | 否 | 否 |

**结构性证明（比实测更强）：** 历史 Seatbelt 脚手架（`sandbox-profile.sh:606`）与第 531 行的 die
**共用同一个 `[ "$D_TRANSPORT" = "subagent" ]` 条件**，且 die（:532）位于 `mkdir`（:536-537）之前 →
该脚手架对任何 subagent target 均**不可达**，代码注释本身也写明 "Historical, unreachable Seatbelt scaffold"。
这不止覆盖 stale kimi target，而是覆盖**全部** subagent transport。

### 2.3 一处对 F003 报告的证伪（副产品）

F003 报告 §7.4 称该断言"与凭据耦合、属脆弱用例"（凭据新鲜时 target 已注册才导致文案不同）。
**该论断被推翻：** 我在 Kimi 凭据**已过期**（`doctor: available=false`）时运行，
该测试仍 **3/3 确定性失败于第 320 行**；F005 则在凭据新鲜时观察到同样失败 → 失败与凭据状态无关。

实测决定文案的真正变量是 **fixture registry 是否声明 subagent bridge**（二者皆 exit 2 / 不建目录）：

```
声明   → [sandbox] ⛔ external same-session bridge does not launch here…
未声明 → [sandbox] ⛔ 内部执行目标不可用：[tool-catalog] error: target id is not registered
```

而 fixture 恒定声明该 bridge，故失败是确定性的。**F005 报告的"确定性失败"表述准确，F003 报告的"凭据耦合"表述不准确**（此点不改变 F003 的 PARTIAL 结论）。

---

## 3. 附带发现（供编排者裁量，非本次论断范围）

1. **状态不一致：** `features.json` 中 F003 仍为 `status: completed`，但其复验结论为 PARTIAL。
   按 harness 规则，FAIL/PARTIAL 的 feature 应回落 `pending`。
2. **回归缺口属实：** `test-vm-bridge-provider.py` 全为 mock，无一用例以生产 argv 走真实 launch 重解析，
   故该确定性缺陷可以完整逃逸至验收——两份报告对此的判断一致且经我核实。
3. **凭据可见性抖动可复现：** 观测窗口内 catalog 从"三角色发布 kimi subagent"翻转为"无 subagent 候选"
   （OAuth token TTL ≈ 15 分钟 / attestation TTL = 5 分钟），行为符合 fail-closed 设计。

---

## 4. 复现步骤

```bash
git rev-parse HEAD   # 172ed42b5c4d910c7f194a6fab835c8ac74f19e7

# 论断 1
python3 .claude/dispatch/transports/vm-bridge-provider.py doctor            # available=true 窗口内进行
APP=~/.tokenizer/app/framework/templates/claude/dispatch/tool-catalog.py
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3 -I "$APP" target \
  --registry .agents-registry.json --adapters .claude/dispatch/transports/adapters \
  --target-id subagent--kimi--evaluator      # exit 1 ModuleNotFoundError
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 /usr/bin/python3    "$APP" target … # exit 0
PYTHONPATH=$PWD/.claude/dispatch /usr/bin/python3 -I "$APP" target …       # 仍失败（-I 隐含 -E）
/usr/bin/python3 -I .claude/dispatch/transports/vm-bridge-provider.py launch …  # 非安装包 → 拒绝
/usr/bin/python3 -I ~/.tokenizer/app/framework/templates/claude/dispatch/transports/vm-bridge-provider.py \
  launch --agent subagent--kimi--evaluator --envelope /tmp/adv-review-probe/envelope.json \
  --registry "$PWD/.agents-registry.json" --adapters "$PWD/.claude/dispatch/transports/adapters" \
  --project-root "$PWD" --state /tmp/adv-review-probe/state \
  --expected-provenance b806e950653e0b0509029fcfa8969bc37fddb189bdccd768a441a708db9faf2a   # exit 2

# 论断 2
git log -S "target id is not registered" --oneline -- .claude/dispatch/test-lifecycle.py    # a3acac5
git log -S "does not launch here" --oneline -- .claude/dispatch/sandbox-profile.sh          # ff896dd
python3 .claude/dispatch/test-lifecycle.py DeadlineAndPreflightTests.test_sandbox_rejects_external_same_session_target_before_creating_runtime
python3 tests/evaluator/adv_review_lifecycle_safety.py    # 5 tests OK
```

---

## 5. L2 与证据处置

- L2 已获用户授权；本次实际发起了**真实 launch 尝试**（4 次），全部在触达 Kimi ACP 之前失败；
- **未**读取或复制用户 Kimi wire / session / 凭据文件；**未**刷新或消费 Kimi token（全程使用既有凭据状态）；
- 探针 envelope 与 state 全部位于 `/tmp/adv-review-probe`，未写入仓库；
- 本报告不含 prompt 原文、ACP wire 数据或任何凭据材料；
- 未修改任何产品代码（`src/` `prisma/` `.claude/dispatch/**` `framework/**` 均未改动）。

---

## 6. 结论

| 论断 | 判定 | 一句话理由 |
|---|---|---|
| 1. external vm-v1 bridge launch 确定性失败且无其他合法路径 | **confirmed** | 生产 argv 4/4 失败于 `available=true` 窗口内；6 条绕行假设（凭据 / 版本 / site-packages / PYTHONPATH / 项目副本 / 其他路由）逐一实测排除 |
| 2. lifecycle 失败为过时断言，安全属性仍成立 | **confirmed** | git 溯源显示文案改于 `ff896dd` 而测试停留在 `a3acac5`；独立探针在 4 类场景下实证 exit 2 / 不建 workroot / 不建 state / 不触达 Seatbelt，且脚手架与 die 共用同一 guard 故结构性不可达 |

两份复验报告的核心论断**均未被推翻**。
