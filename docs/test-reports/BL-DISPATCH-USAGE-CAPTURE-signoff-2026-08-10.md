# BL-DISPATCH-USAGE-CAPTURE Signoff 2026-08-10

> 状态：**签收（reverifying → done）**
> 触发：fix_round=1 定向复验（F004 round-0 PARTIAL 成因消除确认）
> 署名：evaluator-subagent（隔离复验，fresh context，@HEAD 5c016fc + 修复 commit dc9fb3c）

---

## 变更背景

派发沙箱（deny-default 写限制）使 Codex 派发用量无法落盘任何可采集路径，唯一存留处是 dispatch run 日志。
本批把派发用量变成一等公民：run 日志机械提取 usage → run-meta → `report.dispatchRuns` 上行 →
服务端 `HarnessDispatchRun` 用量列 + 幂等物化 UsageEvent（带 batch/feature/role 归因），并回填
BL-REPO-MECH 丢失的 Codex 用量。spec：`docs/specs/BL-DISPATCH-USAGE-CAPTURE-spec.md`。

---

## 五份验收结论汇总

| # | Feature | 轮次 | 结论 | 出处 |
|---|---|---|---|---|
| 1 | F001 框架侧 run-meta usage 契约 + 提取机件（v1.9.0） | round 0（fan-out 4 隔离 evaluator @e58b363） | **PASS** | progress.json evaluator_feedback（round 0） |
| 2 | F002 agent 侧 dispatch 扫描携带 usage 上行 + release 1.3.0 | round 0（同上；evaluator 补写敌意解析用例 8d69343） | **PASS** | 同上 |
| 3 | F003 服务端用量列 + 幂等物化 + Activity tokens 列 | round 0（同上；14 条探针归档于 dc9fb3c） | **PASS** | 同上 |
| 4 | F004 历史回填与端到端实证 | round 0 | **PARTIAL** | progress.json evaluator_feedback.issues（round 0 原文见下） |
| 5 | F004 同上 | round 1（本次定向复验） | **PASS** | 本报告 §复验证据 |

**主链路（数值 / 幂等 / 防双重计费）round 0 已 PASS，round 1 抽查回归无退化。**
回填实证报告：`docs/test-reports/BL-DISPATCH-USAGE-CAPTURE-backfill-2026-08-10.md`
（4×codex 合计 input 9,538,301 / output 81,488 / reasoning 32,056；kimi attribution_only 零物化；
用户 2026-08-09T18:05:58Z 目视确认 /events 4 条 source=codex 事件）。

---

## Round 0 PARTIAL 原文与修复轨迹

**Round 0 判定原文（progress.json evaluator_feedback.issues）：**

> F004：报告终局段「adapter argv 未钉 -c model=」为假（本机 codex.json 定制自 e59c822 起含
> -c model=gpt-5.6-sol，早于四次派发）；「模型不可知」不成立——真实原因是 extract-run-usage.py
> 未实现 spec 决策3 的 adapter argv 兜底档；错误前提已传染 backlog BL-DISPATCH-MODEL-PIN。
> 次要：注册表迁移日期写 08-05，git 史实为 5bd8c52（07-31）。

**修复 commit：** dc9fb3c（fix_round=1）——改写 backfill 报告终局段、重立 backlog 条目、
修正 src/tests 注释日期、补 spec §5 裁决注记、归档 F003 探针测试。

---

## 复验证据（fix_round=1，全部机械核对）

### 1. 报告终局段错误陈述已按事实改写 — PASS

- `python3` 加载 `.claude/dispatch/transports/adapters/codex.json`：argv 实含 `"-c", "model=gpt-5.6-sol"`；
- `git show e59c822 -- .claude/dispatch/transports/adapters/codex.json`：`+ "model=gpt-5.6-sol",` 正是该
  commit（2026-08-07 03:39:13 -0400）加入；`git log --follow` 全史一致；
- 四次 codex 派发 run-meta（`.harness-dispatch/run-meta-build-*.json`）时间戳均为 2026-08-09T05:18–06:52Z，
  **晚于 e59c822** —— 报告新表述「早于四次派发」成立；run-meta input_tokens 四值
  （2,150,425 / 1,634,158 / 4,017,045 / 1,736,673）与报告表格逐一吻合；
- `grep` 报告 / backlog / spec / src / tests：无「argv 未钉」「不可知」残留断言（backlog decisions 中
  一处为对被证伪陈述的转述引用，非残留）；
- 「真实原因＝提取器缺 argv 兜底档」独立核实：`.claude/dispatch/extract-run-usage.py` 只收
  `--log/--adapter/--into`，model 仅取自日志行 `entry.get("model")`，无 adapter argv 读取路径。

### 2. backlog BL-DISPATCH-MODEL-PIN 前提已修正 — PASS

现行条目：前提改为「argv 已钉（e59c822 起）」；剩余工作＝①提取器实现 spec 决策 3 的 adapter argv
兜底档（含钩子递 adapter 路径）＋②已物化 4 条 model=null 事件一次性补写。与复验裁定一致。

### 3. src / tests 注释日期已改 5bd8c52（2026-07-31） — PASS

- `src/cli/harness-dispatch.ts` 与 `tests/cli/harness-dispatch.test.ts` 注释现为「5bd8c52，2026-07-31」；
- git 独立核实：`git log -1 5bd8c52` = 2026-07-31 12:38:52 -0700，`git show 5bd8c52 -- .agents-registry.json`
  确认 `dispatch/1 → tool-integrations/1` 版本迁移即发生于该 commit；
- `grep "08-05"` 于上述文件零命中。

### 4. spec §5 裁决注记在场且一致 — PASS

`docs/specs/BL-DISPATCH-USAGE-CAPTURE-spec.md` §5：argv 兜底档顺延 BL-DISPATCH-MODEL-PIN 的裁决明文
（连同已物化事件 model 补写）；本批 model=null 语义如实；迁移日期修正注记。与报告 / backlog 三处互证一致。

### 5. 回归抽查 — PASS

```
npx vitest run tests/cli/harness-dispatch.test.ts tests/server/harness-dispatch-usage.test.ts \
  tests/server/harness-dispatch-usage-evaluator-probes.test.ts
→ Test Files 3 passed (3) · Tests 47 passed (47)   [23 + 10 + 14]

npm run verify → exit=0（prisma generate + tsc --noEmit 零 error）
```

---

## 类型检查 / CI（机械核实）

| 项 | 证据 |
|---|---|
| CI @e58b363（origin/main） | Deploy VPS run 31328159042 job 级：**Verify (Linux) success · Deploy success**；Verify (Windows) failure＝既知存量红（BL-AGENT-SUPPLY-CHAIN F006 在案）；Contract Conformance success |
| 生产 health | `curl https://token.vpanel.cc/api/health` → **200** `{"ok":true,"commit":"e58b3633d…"}`（2026-08-09T18:23Z 实测） |
| 本地 HEAD vs origin/main | HEAD=5c016fc 领先 origin/main=e58b363 三个 commit（8d69343 tests / dc9fb3c 叙述修正+src 注释 / 5c016fc 状态）。dc9fb3c 的 src 改动经 `git show` 核实为**单行注释**，行为零变化（47 用例 + verify 双背书）。**推送将触发 Deploy**（src/tests 不在 paths-ignore），由主上下文/用户在 done 边界执行 |

## L2 实测记录

本轮为叙述修正复验，无新增 staging/prod 行为面；生产实测仅只读 GET /api/health（200，见上）。
端到端行为证据见 round 0：backfill 报告（用户目视确认 /events 4 条 codex 事件 + kimi「仅归因」+ 二次上报零重复）。

## Ops 副作用记录

本批次无数据库 ops（回填走 agent 上行通道，未直写 DB——spec 决策 4 设计如此，backfill 报告佐证）。

---

## Soft-watch（不阻塞 done，需后续跟进）

| ID | 描述 | 风险等级 | 建议处置 |
|---|---|---|---|
| S1 | 派发用量事件 model=null（unpriced）：提取器 argv 兜底档 + 已物化 4 事件 model 补写 | low | 已明文兜底：backlog `BL-DISPATCH-MODEL-PIN`（前提已修正重立） |
| S2 | progress.json `session_notes.planning` 仍含修复前叙述（「argv 未钉」）——属会话叙事快照，非交付叙述，且按规则会被覆盖写 | low | done 收尾覆盖写 session_notes 时自然消除；不阻塞 |
| S3 | origin/main 落后本地 3 commit；推送将触发生产 Deploy | low | 主上下文/用户在 done 边界推送（人类知情下触发） |

---

## Harness 说明

本批经完整流程 planning → building → verifying（fan-out 4 隔离 evaluator）→ fixing（fix_round=1）→
reverifying（本定向复验）→ done。`progress.json` status=done，signoff 路径已填入 `docs.signoff`。

## Framework Learnings

本批次无新增 framework learnings（round 0 已按铁律 13 执行「交付叙述机械核对」并生效——本轮即其闭环）。
