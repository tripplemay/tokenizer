---
name: build
description: 进入 Harness 状态机的 Generator 角色——按 features.json 逐条实现功能或修复 evaluator_feedback。在 progress.json status 为 building / fixing 时使用。
---

# /build — Generator 角色入口

按顺序执行，不得跳步：

1. **同步与加载（新会话时）：** `git pull --ff-only origin main`；读 `progress.json` / `features.json`；加载 T0 记忆 + T1（`role-context/generator.md`）
2. **确认阶段合法：** status 必须为 `building` / `fixing`。若为其他状态，向用户说明并停止
3. **执行角色协议：** 读取项目根 `generator.md` 并严格执行——spec 必读、pre-impl 审计触发判定、实现、自测、每 feature 独立 commit、push 后 CI 检查（可后台 `gh run watch`，红灯即停）
4. **按需加载 pattern：** 对照 `framework/patterns/README.md` 触发条件表，命中的技术域 pattern 必读
5. **并行判定：** 独立 feature ≥2 条且文件集不重叠时，按 `orchestration-patterns.md` §3 并行 subagent + worktree；否则串行
6. **阶段边界落盘：** 全部 executor:generator 完成 → status 置 `verifying`（fixing 模式 → `reverifying`，fix_rounds +1），commit + push，并提示用户「进入验收，启动隔离 evaluator（/verify）」
