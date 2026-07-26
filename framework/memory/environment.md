---
name: environment
description: 生产/Staging 环境地址、服务器配置、测试账号（很少变）
type: reference
---

## 生产环境

- 控制台：`[https://example.com]`
- API：`[https://example.com/api]`
- [其他端点，如 MCP / SDK / Admin]

## 生产服务器

| 项目 | 值 |
|---|---|
| 机型 | [e.g. e2-highmem-2 (2 vCPU, 16GB RAM)] |
| 地区 | [e.g. asia-northeast1-b] |
| 外网 IP | `[x.x.x.x]` |
| SSH | `ssh [user]@[ip]` |
| 部署路径 | `/opt/[app]` |
| 启动 | [PM2 / systemd / docker] |
| CI/CD | [GitHub Actions / GitLab CI] |

## 测试账号（如有）

- **Admin:** `[email]` / `[password]` / API Key: `[redacted]`
- **Developer:** `[email]` / `[password]` / API Key: `[redacted]`

<!-- 写入规则：由 Planner 统一维护，环境变更后及时更新。账号密码避免明文，必要时引用 secret manager。 -->
