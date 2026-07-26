# Patterns — 技术域经验库（按需加载）

> v1.0 目录分层：`harness/` 只保留状态机与角色协议（每批次必读），`patterns/` 存放从实战沉淀的技术域 pattern（**命中触发条件才读**，不占启动上下文）。
>
> 所有 pattern 均带来源批次与反面案例。新增 pattern 走 `proposed-learnings.md` → 用户确认流程。

| 文件 | 触发条件（何时读） | 主要读者 |
|---|---|---|
| [deploy-patterns.md](deploy-patterns.md) | spec / 实装涉及 PM2、进程管理、nginx、staging/prod 部署链、`.env` 变更、on-boot 任务、**换机/换部署模型的不可逆生产迁移、容器化(Docker compose)、Next.js standalone 部署** | Planner / Generator |
| [database-patterns.md](database-patterns.md) | spec / 实装涉及 DB schema、migration、RLS、跨 tenant 查询、Prisma JSON 列 | Planner / Generator |
| [ai-action-contract.md](ai-action-contract.md) | 集成 LLM 网关 / AI action（prompt template + variables → JSON 输出），涉及 timeout、max_tokens、prompt injection | Planner / Generator |
| [ui-fidelity-guardrail.md](ui-fidelity-guardrail.md) | 任何有设计稿原型参照的 UI 页面 feature（spec 4 段硬要求 + 还原度验收） | 三角色 |
| [i18n-namespace-add-checklist.md](i18n-namespace-add-checklist.md) | 新增 i18n 命名空间或已有命名空间扩展 ≥5 keys | Planner / Generator |
| [material-symbols-pattern.md](material-symbols-pattern.md) | 项目使用字体图标子集（Material Symbols 等自托管 woff2） | Generator / Evaluator |
| [web-runtime-patterns.md](web-runtime-patterns.md) | 引入 alpha/beta/rc 依赖；反向代理后构造对外绝对 URL | Generator |
| [testing-env-patterns.md](testing-env-patterns.md) | L1/L2 验收命中 Prisma / Node 版本 / jsdom / Playwright E2E / 字体子集 / RLS 查询 | Evaluator |

**加载纪律：** 这些文件不进 T0/T1 启动加载。Planner 起草 spec、Generator 开工、Evaluator 验收时按上表触发条件命中才读对应文件——与 `.auto-memory/` T2 层同一原则。
