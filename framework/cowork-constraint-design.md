# Cowork 行为约束设计

> **历史文档（2026-04-04）：** 本文基于早期使用 Cowork（Claude Desktop）作为 Planner 工具时编写。项目后续已统一使用 Claude CLI 承担 Planner + Generator 角色，Cowork 不再参与。本文作为设计决策记录保留，约束原则（角色分离、禁止越界改代码）仍适用于所有 Planner 角色的 agent。

## 问题背景

在项目实施过程中，Cowork（Claude Desktop）曾直接修改产品代码（绕过 Harness 流程），事后才补录进 progress.json。这说明 Cowork 缺乏等价于 Claude Code CLI 的硬性约束机制。

---

## Cowork vs Claude Code CLI 约束机制对比

| 维度 | Claude Code CLI | Cowork |
|---|---|---|
| 约束文件 | `CLAUDE.md`（强制加载） | 无专属文件 |
| 加载时机 | 每次启动自动读取 | 依赖主动读取 |
| 约束强度 | 硬性（文件存在即生效） | 软性（依赖自觉） |
| 覆盖范围 | 项目级编码规范 | 系统提示 + 记忆 |

**根本差异：** Claude Code CLI 启动时强制扫描项目目录并注入 `CLAUDE.md`，没有选择权。Cowork 没有等价的启动时强制读取机制——即使创建了规则文件，仍需主动去读。

---

## 约束失效的根本原因

Cowork 同时是规则的制定者和执行者，没有外部约束方：

- Codex 的边界写在 `AGENTS.md` 里，由系统提示约束，是外部强制
- Cowork 的边界写在 `harness-rules.md` 里，由 Cowork 自己遵守，是自我约束

这是循环——单靠在文件里写"禁止"，约束力依赖 Cowork 的自我判断。

---

## 可行的约束方案

### 方案一：系统提示（最强，但不可控）

把规则写进 Cowork 的系统提示（Anthropic 层面），这是最高优先级，无法绕过。但需要 Anthropic 修改产品，用户无法自行配置。

### 方案二：`.auto-memory/MEMORY.md` 索引（当前可行的最强方案）

`MEMORY.md` 在每次会话开始时被注入到 Cowork 的上下文，等价于"强制读取"。

**做法：**
1. 创建 `.auto-memory/cowork-constraints.md`，写明 Cowork 的行为边界
2. 在 `MEMORY.md` 里加一条索引指向它
3. 每次会话开始时，Cowork 读取 MEMORY.md → 自动感知约束规则

这是目前用户能控制的、最接近硬性约束的方案。

### 方案三：harness-rules.md 写禁令（当前已实现，但强度最弱）

在 `harness-rules.md` 里明确写：

> Cowork 禁止直接修改产品代码（`src/` 目录）。只能操作：`docs/`、`framework/`、`.auto-memory/`、`progress.json`、`features.json` 及角色文件。

问题：Cowork 需要主动读这个文件才能感知规则，不是强制加载。

---

## 建议落地方案

结合方案二 + 方案三：

```
.auto-memory/
├── MEMORY.md          ← 索引中加入 cowork-constraints.md 条目
└── cowork-constraints.md  ← 新建：Cowork 行为边界，每次会话自动加载
```

`cowork-constraints.md` 内容要点：
- **禁止修改 `src/` 目录**下的任何文件
- 产品代码修改必须交由 Claude CLI（Generator）执行
- 可操作范围：`docs/`、`framework/`、`.auto-memory/`、`progress.json`、`features.json`、角色文件（`planner.md` / `harness-rules.md` 等）
- 发现需要改产品代码时：在对话中提出，由用户决定是否交给 Claude CLI

---

## 结论

| 方案 | 约束强度 | 可控性 |
|---|---|---|
| 系统提示 | ★★★★★ | 不可控（需 Anthropic） |
| MEMORY.md 索引 | ★★★★☆ | 可控 |
| harness-rules.md 禁令 | ★★☆☆☆ | 可控 |

**推荐：** 在 `MEMORY.md` 中加入 `cowork-constraints.md` 索引，配合 `harness-rules.md` 禁令双重覆盖，是当前环境下最有效的约束组合。

即便如此，Cowork 的约束本质上仍是"知情自律"而非"技术强制"。真正的硬性约束需要系统提示层面的支持。
