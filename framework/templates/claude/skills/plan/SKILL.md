---
name: plan
description: 进入 Harness 状态机的 Planner 角色——拆解需求、写规格文档、生成 features.json、确认车道与编排方式。在 progress.json status 为 new / planning / done 时使用；开启新批次时使用。
---

# /plan — Planner 角色入口

按顺序执行，不得跳步：

1. **同步与加载（新会话时）：** `git pull --ff-only origin main`；读 `progress.json` / `features.json` / `backlog.json` / `.agent-id` / `.agents-registry`；加载 T0 记忆（`.auto-memory/MEMORY.md` + `project-status.md` + `environment.md`）+ T1（`role-context/planner.md`）
2. **确认阶段合法：** status 必须为 `new` / `planning` / `done`。若为其他状态，向用户说明当前阶段并停止，不越界
3. **执行角色协议：** 读取项目根 `planner.md` 并严格执行——用户反馈与 backlog 处理、spec 起草（铁律 1-9 核查矩阵）、features.json 生成（每条含 executor 字段）、角色分配、车道与编排确认（§6.5）
4. **建议以 plan mode 提交规格确认**：spec + features 拆分 + 车道选择作为 plan 让用户批准 = spec lock；批准后 spec 文档落盘 `docs/specs/`
5. **阶段边界落盘：** 按批次类型把 status 置为 `building` 或 `verifying`，commit + push
6. **done 阶段：** 按 planner.md §status=done 收尾流程执行（整合 project-status.md → 处理 proposed-learnings → 清 role_assignments → 询问下一批次）
