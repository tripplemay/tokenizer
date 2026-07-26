# [批次名称] Signoff YYYY-MM-DD

> 状态：**待 Evaluator 验收**（progress.json status=verifying）
> 触发：[触发原因一句话]

---

## 变更背景

[描述本批次改动的背景和动机]

---

## 变更功能清单

### F-XXX-01：[功能标题]

**Executor：** generator / evaluator

**文件：**
- `path/to/file.ts`（新增 / 修改）

**改动：**
[描述具体改动内容]

**验收标准：**
- [可验证的标准1]
- [可验证的标准2]

---

<!-- 重复上面的块，每个功能一块 -->

## 未变更范围

| 事项 | 说明 |
|---|---|
| [未改动模块] | [为什么不改] |

---

## 预期影响

| 项目 | 改动前 | 改动后 |
|---|---|---|
| [指标] | [数值] | [数值] |

---

## 类型检查 / CI

```
[tsc / eslint 执行结果]
[gh run list --limit 1 --branch main 输出]
```

---

## L2 实测记录（v0.9.9 — BL-031 沉淀）

> 本节由 Evaluator 在签收时填写。staging 浏览器 / SSH 实测的具体行为证据，区别于 L1 静态走查。**有 staging 部署的批次必填**；纯文档 / 纯框架批次可写"无 staging 影响 — N/A"。

| 项 | 证据 |
|---|---|
| Staging git_sha == main HEAD | `curl https://staging.[domain]/api/health \| jq .git_sha` 输出 = `<sha>` |
| 端到端流验证 | [描述 Reviewer 走完的真实 UX 流：登录 → 操作 → 观察 / 收件箱 / DB 查询结果] |
| 关键 invariant | [如 send test 真发出 + Resend providerMessageId / FK 不撞 / count 验证等] |
| 浏览器手动验（如 UI 类）| [DevTools 截图 / 字段渲染 / 网络面板] |

> **RSC server action / 不可 curl-simulate 类 endpoint（v0.9.11 — BL-020-F005 沉淀）：** 走 `Content-Type: text/x-component` + CSRF + RSC payload 的 endpoint（如 login form / OAuth callback / mutation 提交）curl 不能简洁模拟。L2 实测时应明示该限制，退到「unit + integration testcontainer + health endpoint 联合背书 + prod 灰度浏览器手验」模式，物理验证作 Soft-watch 入项目状态由用户驱动，不阻塞 done。

---

## Ops 副作用记录（v0.9.9 — BL-030/BL-031 沉淀）

> 本节记录批次中**任何角色**（Generator / Evaluator / Planner）在 prod / staging 数据库执行的 SQL ops（包括用户授权的越界 ops）。**无 ops 操作时本节可写"本批次无数据库 ops"**。
> 来源：BL-030 Planner SQL ops 漏 dual-write 致 BL-031 暴露 FK orphan 后教训沉淀。

| Agent | 阶段 | 操作摘要 | 副作用对齐 | 用户授权 |
|---|---|---|---|---|
| [Planner/Reviewer/Generator] | [done/verifying/...] | 例：UPDATE asset SET content=... WHERE source='ai_generated' (15 行) | 同 SQL 跑 dualWriteOnUpdate 等价 UPDATE email_template (15 行) ✓ | 用户对话 [时间戳] 授权 |

**Planner done 阶段必查：** Ops 副作用记录中每条是否含"副作用对齐"列且非空？空 = 复查 mutation 函数所有副作用是否同步执行。

---

## Harness 说明

本批改动经 Harness 状态机完整流程（planning → building → verifying → reverifying → done）交付。
`progress.json` 已设为 `status: "done"`，signoff 路径已填入 `docs.signoff`。

---

## Soft-watch（不阻塞 done，需后续跟进）

> 本节由 Evaluator 在签收时填写。低-中风险或边界条件遗留事项列入此处，记录"非 bug 但要记账"的事实。每条声明 ID / 描述 / 风险等级 / 建议处置。
> 无 Soft-watch 项时本节可写"无"但不可删。

| ID | 描述 | 风险等级 | 建议处置 |
|---|---|---|---|
| S1 | [描述] | low / medium / high | [建议] |

---

## Framework Learnings

> 本节由 Evaluator 在签收时填写提案，Planner 在 done 阶段消化、与用户确认后写入 `framework/`，并在 `framework/CHANGELOG.md` 追加记录。
> 不紧急的提案应先追加到 `framework/proposed-learnings.md`，由 Planner 在 done 阶段集中处理。
> 无 learnings 时三小节可整体删，但保留本 H2 标题 + 一行"本批次无 framework learnings"。

### 新规律
- [描述：发现了什么新的规律或最佳实践]
  - 来源：[哪个 feature / 哪次故障]
  - 建议写入：`framework/README.md` §经验教训 / `framework/harness/evaluator.md`

### 新坑
- [描述：踩到了什么坑，下次怎么避免]
  - 来源：[哪个 feature / 哪次故障]
  - 建议写入：`framework/README.md` §经验教训

### 模板修订
- [描述：某个模板文件需要补充或修改]
  - 建议修改：`framework/templates/xxx.md` 第 N 行
