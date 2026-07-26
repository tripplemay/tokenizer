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

**异厂商派活（可选）：** 把某阶段派给外部 CLI（Codex 等）见 `framework/harness/dispatch-mode.md`；无 `.agents-registry.json` 即 inert。⚠️ `settings.json` 的 deny-list 对外部 CLI 子进程无效，安全靠 `.claude/dispatch/sandbox-profile.sh` 的进程级四道锁；generator 与 evaluator 的 `model_family` 必须不同。

**进度看板：** 阶段边界可 `/dashboard` 刷新图形化看板（Artifact 快照，URL 存 `progress.json.dashboard_url`）。

**自主模式（可选）：** 长时无人值守推进见 `framework/harness/autonomous-mode.md` 与 `/autodrive`；开启需人类建 `autonomy-policy.json` 并手动合入 deny-list，deploy/prod/spend 永留人类闸门。

---

## Project Overview

**tokenizer** — 统计各家 AI 编程 CLI 的 token 用量与花费；v1.3 起同时是 **harness 编排控制台**（多项目进度镜像 + 人闸门 + 模式画像）。

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Prisma + PostgreSQL · Chakra/Tailwind · next-intl · Auth.js v5 · vitest · Docker Compose 部署到 VPS（GitHub Actions）

**两个面：** 服务端（`app/` + `src/server/`）与**本机 agent**（`src/cli/`，采集用量 + harness 上报/闸门中继，经 `install.sh` 装成 launchd 常驻）。

## Commands

```bash
# Development
npm run dev                      # Next dev（需 DATABASE_URL；本地库用 docker compose up -d postgres）
npm run cli -- <子命令>           # 直接跑 agent CLI（status / collect / harness / agent …）

# Build
npm run build                    # prisma generate + next build

# Database
npx prisma migrate dev           # 开发期建迁移
npx prisma migrate deploy        # 应用既有迁移（部署路径用这条）

# Lint & Type Check
npm run lint
npm run verify                   # prisma generate + tsc --noEmit（CI 用这条）

# Test
npm run test                     # vitest run（全量）
npx vitest run tests/cli/harness.test.ts   # 单文件
```

## 本项目特有的硬约束

- **push `main` = 部署生产**（`.github/workflows/deploy-vps.yml`）。harness 的状态类改动
  （`progress.json` / `features.json` / `.auto-memory/**` / `framework/**` / `.claude/**` /
  `harness.json` / `harness.lock` / `*.md`）已列入 `paths-ignore`，不会触发部署；**其余任何改动都会**。
- **时间戳全链路 UTC**：客户端 `occurredAt` 必须是 UTC ISO 8601；服务端、容器、Postgres 会话都跑 UTC。
- **agent 能力版本**：`src/shared/agent-feature-version.ts` 的两个常量同步 bump 才会提示用户升级；
  纯 bug 修复不动它。
- **闸门私钥**：`HARNESS_CONSOLE_SIGNING_KEY` 存 **PEM 的 base64**（`.env` 放不下多行 PEM）；
  未配置时批准接口 fail-closed 返回 503。

## Reference Documents（按需阅读）

- **VPS 部署与升级：** → `docs/VPS-deployment.md`
- **规格文档：** → `docs/specs/`（开发时优先查阅）
- **控制台设计：** → `framework/harness/console-mode.md`（闸门契约、两条通道、红线）
- **框架版本化：** → `framework/harness/framework-versioning.md`（`harness.sh` 与账本）
- **技术域 pattern 库：** → `framework/patterns/README.md`（触发条件命中才读）
