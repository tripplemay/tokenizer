# AGENTS.md

本仓库的**唯一真源是 [CLAUDE.md](./CLAUDE.md)** —— 角色、状态机、命令、硬约束都在那里，
本文件只做外部 CLI（Codex / Kimi 等）入口的指路牌，不重复内容以免两份漂移。

## 开工前必读

1. `harness-rules.md` —— 状态机、角色、独立性铁则、机制化守门
2. `CLAUDE.md` —— 本项目的技术栈、命令、硬约束（尤其「push main = 部署生产」）
3. 当前状态：`progress.json.status` 决定你该进哪个角色入口

## 对外部 agent 的额外约束

- **你不得推送任何分支**，产物留在自己的 worktree 里，由编排者回流（`framework/harness/dispatch-mode.md` §6）
- **你不得写 `pending_gate.decision`** —— 人闸门归人，机器侧 hook 会当场拒
- 结论必须落成产物文件（verdict.json / diff），不靠对话传递（铁律 12）
