# 03 · 开箱即用手册 — 现在就跑起来

## 前置条件

- Claude Code（CLI 或桌面端）
- git + GitHub CLI（`gh`，CI 检查用）
- python3（状态 JSON 校验 hook 用）

## 3 步初始化

### 第 1 步：拉取骨架

```bash
npx degit tripplemay/harness-template my-new-project
cd my-new-project
```

### 第 2 步：运行 bootstrap

```bash
bash bootstrap.sh
```

脚本铺好：harness 角色文件、`orchestration-patterns.md`、`.claude/`（hooks 守门 + evaluator subagent + `/plan` `/build` `/verify` 技能）、`progress.json` / `features.json` / `backlog.json`、`.auto-memory/` 分层记忆、docs 目录骨架；源模板归整到 `framework/`（含 `patterns/` 技术域经验库，供沉淀回流）。

### 第 3 步：让 Claude Code 填占位符

在项目目录打开 Claude Code，说：

> 按 INIT.md 初始化项目

Claude 会问 6 个问题（项目名 / 技术栈命令 / 环境 / 实例身份 / 用户偏好 / 生产测试策略），展示填充计划等你确认，然后填好所有占位符、创建 `.agent-id`、首次 commit、删除 INIT.md。

## 第一个批次实战

```
你：/plan 开发用户登录功能（邮箱 + 密码，带失败限流）
```

1. Planner 问清需求 → 写 spec → 生成 features.json → plan mode 让你确认 → status=building
2. `/build`（或让它继续）：逐条实现 + push + CI 绿
3. `/verify`：隔离 evaluator subagent 验收 → 全 PASS 写 signoff → done；有问题自动进 fixing 循环
4. done 阶段确认沉淀与下一批次

**UI 项目注意：第一个批次必须是设计系统**（颜色 token、排版、基础组件、布局框架），不是第一个业务页面——这是框架用 3 个返工批次换来的教训。

## FAQ

**Q: 一定要用状态机吗？改一行文案也要走批次？**
不。独立小任务（分析、审查、一次性小修）直接对话执行（harness-rules.md 第 1.5 步）。状态机服务于"多功能批次 + 需要验收纪律"的工作。

**Q: 会话中断 / 上下文被压缩了怎么办？**
状态都在 progress.json / features.json / `.auto-memory/`（每个阶段边界强制落盘）。新会话启动 hook 会自动注入当前 status，按提示进对应角色即可续接。

**Q: 没有第二台机器 / 不用 Codex，「无自评」还成立吗？**
成立。快车道下 Evaluator 是 fresh context 的隔离 subagent（`.claude/agents/evaluator.md`），不继承实现上下文、只认实物证据、结论原样落盘。要更强隔离可在正式批次用独立会话（慢车道）。

**Q: L2 测试什么时候跑？**
涉及真实外部服务 / 计费 / 生产写入的验收项标 [L2]，需要你明确授权才执行；L1 本地失败不代表产品 bug（见 `patterns/testing-env-patterns.md` 环境误报清单）。

**Q: 框架文件能直接改吗？**
`proposed-learnings.md` 随时可追加；其他框架文件必须经你确认才能改（沉淀闭环纪律）。
