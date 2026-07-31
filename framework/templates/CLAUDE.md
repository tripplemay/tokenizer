# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Harness 规则（最高优先级）
读取并严格遵守 @harness-rules.md 中的所有规则。

**每次会话启动必须执行：**
1. SessionStart hook 会自动注入当前状态机 status（`.claude/hooks/session-start.sh`）；据此进入对应角色入口
2. 读取 `.auto-memory/MEMORY.md`（项目记忆索引），按 T0/T1/T2 分层加载记忆文件
3. 阶段角色入口：`/plan`（new / planning / done）、`/build`（building / fixing）、`/verify`（verifying / reverifying，编排隔离 evaluator subagent）

**独立性铁则：** 验收必须在隔离上下文中进行（`.claude/agents/evaluator.md`），结论原样落盘。任何人不得评估自己的工作。

**分支规则：** 代码提交推 `main` 分支。部署由用户手动触发。

**记忆分层：** `.auto-memory/`（git-tracked）是跨实例共享记忆源。本机用户偏好存储在 `~/.claude/projects/.../memory/` 中，不入 git。

**规格文档分级：** 新功能批次须有 `docs/specs/` 下的规格文档（硬性）；Bug 修复批次可省略（软性）。

**编排：** 并行实现、fan-out 验收、后台 CI、/loop 场景见 `orchestration-patterns.md`（同会话快车道为默认；跨机器 / 独立实例走 git 总线慢车道）。

**工具派活（可选）：** 按 `tool-integrations/1` registry 把 Planner / Generator / Evaluator 路由到支持的 CLI
（详见 `framework/harness/dispatch-mode.md`）；旧 `dispatch/1` registry 仍兼容。Planner 首项可保持
Coordinator（`planner: null`），不可配置。无 registry 即 inert。⚠️ `settings.json` 的 deny-list 对外部 CLI
子进程无效，安全靠 `.claude/dispatch/sandbox-profile.sh` 的进程级四道锁；generator 与 evaluator 的
`model_family` 必须不同，A2A Generator 在 source-handoff 契约落地前拒绝。

**进度看板：** 阶段边界可 `/dashboard` 刷新图形化看板（Artifact 快照，URL 存 `progress.json.dashboard_url`）。

**自主模式（可选）：** 长时无人值守推进见 `framework/harness/autonomous-mode.md` 与 `/autodrive`；开启需人类建 `autonomy-policy.json` 并手动合入 deny-list，deploy/prod/spend 永留人类闸门。

---

## Project Overview

[项目名] — [一句话描述]

**Tech Stack:** [填写技术栈]

## Commands

```bash
# Development
[dev 命令]

# Build
[build 命令]

# Database（如有）
[migrate 命令]

# Lint & Type Check
[lint 命令]
[typecheck 命令]

# Test
[test 命令]
```

## Reference Documents（按需阅读）

涉及对应模块时再读，不需要每次启动都加载：

- **架构详情：** → `docs/dev/architecture.md`（系统架构、请求管道、认证、数据库等）
- **开发规则：** → `docs/dev/rules.md`（Migration 规则、[框架]开发规则、设计决策、CI/CD）
- **规格文档：** → `docs/specs/`（开发时优先查阅）
- **设计稿：** → `design-draft/`（UI 页面还原时参考）
- **技术域 pattern 库：** → `framework/patterns/README.md`（触发条件命中才读）

<!--
注意：主文件只放「每次必读」的内容（启动流程、Commands、核心约束索引）。
架构详情、规则细节、策略矩阵等放在 docs/dev/ 子文档中按需加载。
原则：agent 启动时加载量越少，信息焦点越清晰。
-->
