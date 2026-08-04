# BL-NATIVE-SUBAGENT-BRIDGES Fix 2 · Planner persona 结构性冲突裁决请求

> **发起者：** main context（Coordinator/Planner）
> **日期：** 2026-08-04
> **触发：** 第 2 轮复验 F003=PARTIAL（planner persona 4/4 确定性失败）；F005 PASS 但留下两条需裁决的 observation。按 pre-implementation audit → 裁决 → 用户确认流程处理。
> **状态：** 已裁决（2026-08-04，用户短格式 `#1:A #2:A #3:同意 #4:同意`）；实现以本文件与更新后的 batch spec 为准。

## 1. 背景

第 2 轮修复（abf7a6e）后,launch 基础设施已被两个 fresh-context evaluator 用真实端到端 launch 证实可用:evaluator/`explore` 合并 3/3 成功、generator/`coder` 1/1 成功(RETURNED / completed / nonce-bound child receipt / source_changes=[])。

唯一剩余阻断:**planner persona(`native_agent_type=plan`)合并 4/4 确定性失败**,对照实验已排除任务复杂度、环境退化、凭据过期、签发漂移(证据:reverify2-F003 §8、reverify2-F005 §7 OBS-1)。

**根因是厂商能力与 bridge 协议的结构性冲突,不是代码 bug:**

- Kimi 0.31.0 的 `plan` 原生子代理是**只读 profile**:工具集只有 Read/Glob/Grep/WebSearch/FetchURL(无 Write/Edit/Bash),角色提示词明令 *"do not attempt to run commands or modify files. Your deliverable is the plan itself, returned as your final message."*
- 而 Harness bridge 协议**强制每个角色把交付物落盘**(`session-bridge.py` "bridge completed without the commissioned artifact")。

plan 子代理永远无法写文件 → 该路由在协议层面**不可能成功**。

## 2. 决议请求

### 决议点 1(核心):planner persona 交付通道

| 方案 | 内容 | 代价/风险 |
|---|---|---|
| **A(建议)** | bridge manifest 为每角色新增声明式交付通道字段(`deliverable_channel: file \| terminal-message`)。plan 声明 `terminal-message`:driver 观察到合格 child 完成事件后,把子代理**最终消息**物化为受托 artifact 落盘,内容 sha256 照常绑定进 receipt;file 通道行为不变。 | 改动面:subagent-bridge schema、session-bridge driver、worker/provider 归约、聚焦测试。保留厂商 persona 只读语义与角色保真;符合本批"声明式、可探测 bridge"的目标;receipt 证据链完整(消息内容哈希绑定)。 |
| B | Kimi bridge 只发布 generator/evaluator 两角色,F001/F003/F004 验收范围收缩。 | 与用户"Kimi 承担三角色"的原始要求直接冲突,需用户明确放弃该目标。 |
| C | planner 绑定 `coder` persona。 | 角色保真破坏:给规划角色发放写工具,违背 restricted planner 原则与 manifest 诚实映射。不建议。 |

### 决议点 2:evaluator 交付路径与 baseline 冲突(F005 OBS-2)

`validate-dispatch.sh` 把 evaluator 交付物锁死为 `docs/test-reports/<batch>-verdict.json`,而 provider 归约在"受托工件已存在于 baseline"时拒收——本批次该路径已被 tracked,经 bridge 派发本批 evaluator 会跑完整轮后在 copy-out 才失败(确定性复现:`scripts/test/f005r2_artifact_baseline_collision.py`)。

| 方案 | 内容 |
|---|---|
| **A(建议)** | provider 归约允许**受托 artifact 路径**覆盖 baseline 已有文件(仍计入 source_changes、哈希绑定进 receipt)。受托路径本来就是签发时声明的合法写入点。 |
| B | validate-dispatch 改为按轮次生成唯一 verdict 路径(需同步 console/自治模式对固定路径的假设,改动面更大)。 |

### 决议点 3:test-lifecycle 两条严格 bridge 用例过时 skip(F005 OBS-3)

skip 理由仍是"无 provider 可用",而 vm-v1 已存在。**建议直接修**:更新条件与理由,使"contained bridge 不写主 checkout / 收割 ACP child 树"两条属性获得自动化覆盖(可用受控 mock provider 环境)。

### 决议点 4:registry 惰性字段(F003 §9.4)

kimi integration 的 `sandbox.env_set.KIMI_CODE_HOME` 对 bridge 路径无效且易误读。**建议入 backlog** 下批清理,本批不动 registry。

## 3. 用户裁决

**短格式:** `#1:A #2:A #3:同意 #4:同意`(2026-08-04)

### 同步文档更新

- batch spec 增补硬约束:bridge manifest 的 `deliverable_channels` 为声明式按角色交付通道;`terminal-message` 通道由 driver 物化子代理最终消息为受托 artifact,内容 sha256 照常绑定 receipt;受托 artifact 路径为合法覆盖点,覆盖计入 source_changes。
- 决议点 3:test-lifecycle 两条旧架构用例删除,其守护属性映射到 driver/provider 层现有自动化用例(见代码内注释)。
- 决议点 4:registry 惰性字段清理已入 backlog `BL-REGISTRY-LAZY-FIELD-CLEANUP`。

