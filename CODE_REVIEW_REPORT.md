# Tokenizer 项目全量代码审核报告

**审核日期**: 2026-05-17
**审核范围**: 全量代码（21 个核心源文件 + 8 个测试文件）

## 项目概况

| 指标 | 数据 |
|------|------|
| 项目名称 | Tokenizer |
| 技术栈 | Next.js 15 + React 19 + Prisma + TypeScript + Tailwind CSS |
| 数据库 | PostgreSQL |
| 代码文件总数 | 21 个核心源文件 |
| 测试文件数 | 8 个 |
| 测试覆盖率 | 38% (8/21 模块有测试) |

---

## 一、问题汇总统计

| 模块 | 高危 | 中危 | 低危 | 合计 |
|------|------|------|------|------|
| API 路由 | 8 | 12 | 10 | **30** |
| CLI 代码 | 5 | 7 | 13 | **25** |
| 服务器端 | 4 | 11 | 6 | **21** |
| 解析器 | 3 | 7 | 8 | **18** |
| 测试代码 | 6 | 22 | 14 | **42** |
| **总计** | **26** | **59** | **51** | **136** |

---

## 二、高危问题清单 (P0 - 立即修复)

### 2.1 安全漏洞

| # | 文件 | 问题描述 |
|---|------|----------|
| 1 | `app/api/devices/route.ts:5-7` | 设备列表 API 完全没有认证保护 |
| 2 | `app/api/events/route.ts:6-13` | 事件列表 API 完全没有认证保护 |
| 3 | `app/api/projects/route.ts:5-7` | 项目列表 API 完全没有认证保护 |
| 4 | `app/api/summary/*.ts` | Summary 系列 4 个端点全部没有认证保护 |
| 5 | `app/api/admin/login/route.ts:8-22` | Admin Login 没有速率限制，可暴力破解 |
| 6 | `app/api/devices/enroll/route.ts:14-59` | 设备注册缺少速率限制 |
| 7 | `app/api/admin/login/route.ts:15` | 管理员令牌以明文存储在 Cookie 中 |
| 8 | `src/cli/service.ts:39,62,78` | service 模板存在 Shell 注入风险 |

### 2.2 性能问题

| # | 文件 | 问题描述 |
|---|------|----------|
| 9 | `src/server/ingest.ts:72-109` | 事件摄入循环中的 N+1 查询问题 |
| 10 | `app/api/usage/events/batch/route.ts:12-18` | 批量事件端点缺少输入数组大小限制 |

### 2.3 代码健壮性

| # | 文件 | 问题描述 |
|---|------|----------|
| 11 | `src/parsers/claude.ts:72-73` | 文件 I/O 未被 try-catch 保护，一个损坏文件导致全部解析中断 |
| 12 | `src/parsers/codex.ts:27-28` | 同上问题 |
| 13 | `src/cli/sync.ts:21-28` | fetch 请求无超时控制，可导致 agent 永久挂起 |
| 14 | `src/cli/config.ts:49,96,106,116` | JSON.parse 无防御，配置文件损坏导致崩溃 |
| 15 | `src/cli/agent.ts:97-112` | `process.exit(0)` 导致定时器清理代码不可达 |
| 16 | `src/cli/index.ts:64,68` | `--heartbeat-seconds` 和 `--sync-minutes` 未校验 NaN |

---

## 三、中危问题清单 (P1 - 尽快修复)

### 3.1 安全问题

| # | 文件 | 问题描述 |
|---|------|----------|
| 17 | `app/api/admin/logout/route.ts:6-9` | Logout 缺少 CSRF 保护 |
| 18 | `src/server/tokens.ts:15-19` | safeEqual 存在长度信息泄露 |
| 19 | `app/api/devices/enroll/route.ts:21-56` | 设备注册存在 TOCTOU 竞态条件 |
| 20 | `app/api/admin/enrollment-tokens/route.ts:31-33` | Enrollment Token 端点返回明文令牌并嵌入 curl 命令 |
| 21 | 所有 `request.json()` 调用 | 使用 `as` 类型断言绕过运行时验证，建议使用 zod |

### 3.2 数据库问题

| # | 文件 | 问题描述 |
|---|------|----------|
| 22 | `src/server/summaries.ts:71` | `getDeviceSummary()` 无限制加载全部设备 |
| 23 | `app/api/admin/cleanup-claude-legacy/route.ts:14-22` | 清理端点将全部匹配行加载到内存 |
| 24 | `app/api/admin/cleanup-claude-legacy/route.ts:46-54` | 清理事务操作数量不受限制 |
| 25 | `src/server/summaries.ts:21-32` | `getSummary()` 并行执行 10+ 个数据库查询 |

### 3.3 解析器问题

| # | 文件 | 问题描述 |
|---|------|----------|
| 26 | `src/parsers/codex.ts:63` | `sourceEventId` 中包含绝对文件路径，不稳定 |
| 27 | `src/parsers/opencode.ts:80` | 使用 `process.cwd()` 而非 config 中的路径 |
| 28 | `src/parsers/codex.ts:28` | 未处理空字节（null bytes） |

### 3.4 测试覆盖

| # | 缺失测试的模块 |
|---|----------------|
| 29 | `src/cli/config.ts` - 配置读写基础模块 |
| 30 | `src/cli/collect.ts` - 数据收集核心流程 |
| 31 | `src/server/ingest.ts` - 数据入库逻辑 |
| 32 | `src/server/auth.ts` - 认证逻辑 |
| 33 | `src/server/tokens.ts` - 安全相关函数 |
| 34 | `src/cli/project.ts` - 被所有 parser 依赖 |

---

## 四、低危问题清单 (P2 - 计划修复)

### 4.1 代码质量

| # | 文件 | 问题描述 |
|---|------|----------|
| 35 | `app/api/health/route.ts:25` | 健康检查端点泄露错误详情 |
| 36 | `app/api/health/route.ts:17` | 暴露 Git Commit Hash |
| 37 | `app/api/summary/daily/route.ts:7` | `days` 参数缺少范围限制 |
| 38 | 所有路由 | 缺少统一的错误处理中间件 |
| 39 | `src/cli/service.ts:96,101,110` | 大量空 catch 块吞噬错误 |
| 40 | `src/cli/config.ts:109-112` | 凭证文件权限存在 TOCTOU 竞态窗口 |
| 41 | `src/cli/git.ts:12` | git 缓存永不清理，长时间运行可能内存泄漏 |
| 42 | `src/parsers/*.ts` | 大量使用 `as any` 绕过类型安全 |

### 4.2 测试问题

| # | 问题描述 |
|---|----------|
| 43 | `vitest` 未列入 `devDependencies` |
| 44 | 缺少 malformed JSON 数据的测试 |
| 45 | 缺少边界情况测试（BOM、空字节、极大值等） |
| 46 | 部分测试违反单一职责原则 |

---

## 五、优先修复建议

### P0 - 立即修复（安全相关）

```typescript
// 1. 为所有 GET 端点添加认证
// app/api/devices/route.ts, events/route.ts, projects/route.ts, summary/*.ts
export async function GET(request: NextRequest) {
  if (!isAdminAuthorizedFromCookie(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ...
}

// 2. 为 Admin Login 添加速率限制
// 使用 rate-limiter-flexible 或类似库

// 3. 为批量摄入添加大小限制
if (body.events.length > 500) {
  return Response.json({ error: "Too many events" }, { status: 400 });
}

// 4. 将 admin token 存储为 hash
import { createHash } from "crypto";
const tokenHash = createHash("sha256").update(body.token).digest("hex");
store.set(ADMIN_COOKIE, tokenHash, { ... });
```

### P1 - 尽快修复（性能和健壮性）

```typescript
// 1. 重构 ingestUsageEvents 使用批量操作
const projects = await prisma.project.findMany({
  where: { name: { in: uniqueProjectNames } }
});
await prisma.usageEvent.createMany({ data: events });

// 2. 为解析器添加 try-catch
for (const file of walkJsonl(projectsDir)) {
  try {
    const lines = readFileSync(file, "utf8")...;
    // ...
  } catch (error) {
    warnings.push(`Failed to read ${file}: ${error}`);
  }
}

// 3. 为 fetch 添加超时
const response = await fetch(url, {
  signal: AbortSignal.timeout(30_000),
  // ...
});

// 4. 为 CLI 参数添加验证
if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds <= 0) {
  throw new Error("heartbeat-seconds must be a positive number");
}
```

### P2 - 计划修复（测试和代码质量）

1. 将 `vitest` 加入 `devDependencies`
2. 为核心模块添加单元测试：`config.ts`, `project.ts`, `tokens.ts`, `auth.ts`
3. 为解析器添加 malformed 数据测试
4. 实现统一的 API 错误处理中间件
5. 使用 zod 进行运行时输入验证

---

## 六、总结

本项目存在 **26 个高危问题**，主要集中在：

1. **认证缺失**：6 个 GET 端点完全没有认证保护，暴露敏感业务数据
2. **注入风险**：CLI service 模板存在 shell 注入风险
3. **性能瓶颈**：N+1 查询、无大小限制的批量操作
4. **健壮性不足**：文件 I/O 无保护、fetch 无超时、JSON 解析无防御

**建议优先级**：
- **第一周**：修复所有认证缺失问题（H-1 ~ H-4）和速率限制（H-5, H-6）
- **第二周**：修复 N+1 查询（H-9）和批量大小限制（H-10）
- **第三周**：修复解析器文件 I/O 保护（H-11, H-12）和 CLI 健壮性（H-13 ~ H-16）
- **持续**：补充测试覆盖率，目标从 38% 提升到 70%+
