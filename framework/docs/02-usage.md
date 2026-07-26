# 02 · 使用方法 — 一次完整批次详解

> 前提：项目已按 [03-quickstart.md](03-quickstart.md) 初始化完成。

## 快车道标准批次（日常默认，单会话跑完）

### 1. 开启批次（/plan，status: new → building）

对 Claude Code 说「根据 harness 规则，开发 [需求]」或直接 `/plan`：

- Planner 读 `docs/test-reports/user_report/`（用户反馈）+ `backlog.json`（需求池），与你确认本批次范围
- 写规格文档 `docs/specs/[批次名]-spec.md`（新功能批次硬性；spec 起草受 planner.md 铁律 1-9 核查矩阵约束）
- 生成 features.json（5-30 条，每条含 executor: generator/evaluator + acceptance）
- 确认车道与编排方式（是否并行 building / fan-out 验收）
- **建议以 plan mode 提交确认** —— 你批准即 spec lock
- status → `building`（全 evaluator 任务则直接 → `verifying`），commit + push

### 2. 实现（/build，status: building）

- Generator 逐条实现：读 spec → （命中触发条件先提 pre-impl 审计等 Planner 裁决）→ 实现 → 自测 → commit → push → 后台 CI watch
- 独立 feature ≥2 条且文件不重叠时并行 subagent + worktree（`orchestration-patterns.md` §3）
- **CI 红灯立即停止新功能**，修复优先
- 全部完成 → status → `verifying`

### 3. 验收（/verify，status: verifying）

- 主上下文启动**隔离 evaluator subagent**（fresh context，不接受实现叙述）
- Evaluator 自行读 spec / 代码 / 跑 L1（lint / tsc / test）+ L2（staging，需你授权）→ 逐条 PASS / PARTIAL / FAIL
- features ≥4 条时 fan-out：每 feature 一个验收 subagent → FAIL/PARTIAL 对抗复核（防环境误报）→ 机械汇总
- 结论原样写入 progress.json `evaluator_feedback`，报告落 `docs/test-reports/`
- 有问题 → `fixing`；全 PASS + signoff 已写 → `done`

### 4. 修复循环（status: fixing ⟷ reverifying）

- Generator 针对 evaluator_feedback 逐条修复，**critical/high 修复同 commit 补回归测试**（硬性）
- 修完 → `reverifying`（fix_rounds +1）→ 隔离复验 → 全 PASS → `done`

### 5. 收尾（/plan，status: done）

- 校验整合 `.auto-memory/project-status.md`（覆盖写 ≤30 行）
- 处理 `framework/proposed-learnings.md`（逐条向你确认沉淀）
- 清除 role_assignments → 询问下一批次

## 关键文件

| 文件 | 作用 | 谁写 |
|---|---|---|
| `progress.json` | 状态机核心：status / 进度 / evaluator_feedback / session_notes | 各角色在各自阶段 |
| `features.json` | 功能清单与逐条状态 | Planner 建，Generator/Evaluator 更新 status |
| `backlog.json` | 需求池（不打断当前批次） | 任意阶段追加，Planner 消费 |
| `docs/specs/` | 规格文档（Generator 的实现依据） | Planner |
| `docs/test-reports/` | 验收报告 + signoff（done 的前置硬条件） | Evaluator |
| `.auto-memory/` | T0/T1/T2 分层共享记忆 | 按 harness-rules.md 写入职责表 |

## 高级用法

- **慢车道 / 多机协作：** 各机器配 `.agent-id`，`role_assignments` 指派角色；每会话启动必 `git pull --ff-only`。独立 evaluator 实例读到 status=verifying 自行接手
- **独立任务（不入状态机）：** 「请审计 XXX」类任务直接执行，产物入 `docs/`，不动状态文件（harness-rules.md 第 1.5 步）
- **上线前 audit：** 按 `templates/prod-launch-audit-template.md` 跑旁路体检（四池子分类，文件:行级精度）
- **/loop 隔夜推进：** 批量迁移 / 盯 CI 等场景按 `orchestration-patterns.md` §6——每轮落盘状态；阶段切换不得无人值守自动完成
- **技术域 pattern：** `framework/patterns/README.md` 触发条件表——涉及部署 / DB / LLM 集成 / UI 还原 / i18n 时命中必读
