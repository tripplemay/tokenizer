# Prod Launch Audit Template

> **Source:** v0.9.10 — KOLMatrix `docs/reviews/prod-mvp-readiness-audit-2026-05-04.md`（Claude CLI 独立任务模式 168 行报告，4 池子 18 项阻塞分类 + 文件:行级精度，accept by 用户 2026-05-04 → backlog 19 → 21 + 2 mini-batch 排期细化）
>
> **触发时机：** 满足以下任一即跑（Planner 旁路任务，**不入状态机批次**）：
> - MVP 邀请第一批种子用户前
> - 真客户对外发布前
> - 1+ sprint 没做安全 / 完整性审计 + 连续工作日 ≥ 5
> - 用户主动请求

---

## 标题与元数据

```markdown
# [Project] Prod 上线前体检 — YYYY-MM-DD

> **作者：** Claude CLI（独立任务模式，不修改状态机）
> **审计基线：** prod `<sha>` / staging `<sha>` / main `<sha>`
> **数据来源：** `progress.json` / `features.json` / `backlog.json` / [N 个 signoff] / `docs/product/[相关 audit/PRD]` / 全代码 grep（disabled + ghost-control + 安全点位）/ 实测 prod & staging /api/health
```

---

## §0 TL;DR — 一句话结论

格式：`[Project N 步业务流] 在 prod 全部跑得通，[关键模块清单] 全部到位。但对外 [触发场景] 前还有 [N] 项必须闭环，分四个池子`

| 池子 | 数量 | 严重度 | 阻塞性 |
|---|---|---|---|
| **A. in-flight 修复**（已 plan 未上线）| N 项 | 高 | 内部已被用户连报 |
| **B. 安全 mini-batch**（high backlog）| N 项 | Critical / High | 对外前必修 |
| **C. ghost controls / 半成品功能**| N 项 | Medium | UI 已展示但未实装 |
| **D. PRD spec 偏差残留**| N 项 | Medium-Low | 不破 DoD 但与 PRD 不一致 |

**当前 prod 落后 main N commit。** 三个 mini-batch（[BL-XXX 列表]）按推荐顺序执行可在 ~N 工作日清掉。

---

## §1 部署版本对位

| 环境 | git_sha | 与 main 差距 | 健康 |
|---|---|---|---|
| **Prod** | `<sha>` | 落后 N commit（[列出哪些批次]）| ✅ healthy / DB latency Nms |
| **Staging** | `<sha>` | 落后 N commit | ✅ healthy / DB latency Nms |
| **main** | `<sha>` | — | [当前批次 status, X/Y features done] |

---

## §2 池子 A — in-flight 修复（N 项）

**当前状态：** progress.json status / `X/Y` done。

| ID | 严重度 | 用户感知 | 代码确认未修 |
|---|---|---|---|
| F00X | Critical/High/Medium | [症状描述] | `<file:line>` 仍含 `<问题模式>` |

**建议：** [完成当前批次 → Reviewer 验收 → prod redeploy]。

---

## §3 池子 B — 安全 mini-batch（N 项，全部未修）

### 3.1 Critical / High 安全

| 编号 | 描述 | 文件确认仍未修 |
|---|---|---|
| **CR-N** [项标题] | `<file:line>` [具体未修证据] |
| **H-SN** [项标题] | `<file:line>` [具体未修证据] |

### 3.2 顺手修 UI

| 编号 | 描述 | 确认 |
|---|---|---|
| **UI-N** [项标题] | `<file:line>` [证据] |

**建议：** [当前批次 done → 立即起 BL-XXX mini-batch（~工时估算 + 1 周观察期等条件）]。

---

## §4 池子 C — ghost controls / 半成品功能（N 项）

| 位置 | 文件 / 行号 | 当前状态 | 优先级 |
|---|---|---|---|
| **A. [模块]** | `<file:line>` 'disabled' button + tooltip "Coming soon" | 高 ROI / 必做 |
| **B. [模块]** | ... | 中 ROI |
| **C. [模块]** | ... | 中 ROI |
| **D. [模块]** | ... | 工时高，启动时再裁 |
| **E. [模块]** | ... | 低，deferred |

**建议：** [BL-XXX done → 起 BL-YYY mini-batch（A/B/C 必做 ~工时；D 启动时再裁；E deferred）]。

---

## §5 池子 D — PRD spec 偏差残留（N 项，DoD 不阻塞）

| 编号 | 来源 | 现状 | 建议 |
|---|---|---|---|
| **D1** [PRD § 引用] | `<file:line>` [当前状态] | [修法概要] |
| **D2** ... | ... | ... |

---

## §6 其他未实装功能 / 长尾 backlog（参考，非阻塞）

| ID | 内容 | 优先级 | 触发条件 |
|---|---|---|---|
| BL-XXX | [描述] | medium / low / deferred | [触发条件] |

**Prod DB seed 状态：** [说明 seed 是否跑过 + 是否含业务数据 + 与 environment.md 描述一致性]

---

## §7 [项目] DoD N 步 Journey 终态

| # | 步骤 | 状态 | 阻塞 |
|---|---|---|---|
| 1 | [步骤名] | ✅ / ⚠️ | [关联池子项] |
| ... | ... | ... | ... |

**结论：** N 步 Journey 全部跑得通，**严格 DoD 不被阻塞**；但池子 A+B+C 直接影响"对外客户接触"的产品成熟度感知。

---

## §8 推荐执行顺序

| 阶段 | 内容 | 估时 | 触发条件 |
|---|---|---|---|
| **N+0** | 完成当前 in-flight 批次（池子 A）| ~0.5 day | 当前 building 中 |
| **N+1** | 安全 mini-batch（池子 B）| ~0.5-1 day + N 周观察期 | N+0 done 立即起 |
| **N+2** | ghost controls 必做项（池子 C 的 A+B+C）| ~工时 + Reviewer | N+1 done 起 |
| **N+3** | PRD 关键偏差（池子 D 的 D1+D2）| ~0.5 day | N+2 done 起 |
| **N+4** | Prod redeploy + 邀请种子用户 | — | N+3 done |

---

## §9 风险提示

1. **[当前 prod sha vs main 差距]：** [描述 + 优先级]
2. **[关键安全风险（如 SQL 注入兜底单点 / rate-limit 缺失）]：** [现状 + 修法 + 紧急度]
3. **[数据隔离风险（如 demo 数据暴露）]：** [现状 + 修法]
4. **[prod DB 状态不明]：** [seed 是否跑 + 业务数据情况]

---

## 元结论

格式：`审计完毕。N 项明确阻塞 / 偏差全部锁文件 + 行号；M 个 mini-batch（[BL-XXX 列表]）已 plan 在 backlog，按推荐顺序执行可在 ~N 工作日全部清掉。`

---

## 模板使用说明

**填写顺序（Claude CLI 跑独立 audit task 时）：**

1. 先核对 §1（live curl /api/health + git log + git diff main）→ 锁住 sha
2. 跑 §2 池子 A（读 progress.json + features.json + spec → 列 in-flight features 实证未修）
3. 跑 §3 池子 B（读 backlog.json BL-020 / 上次 frontend-audit / 全 src grep `dangerouslySetInnerHTML` `executeRawUnsafe` `ratelimit` 等）→ 文件:行级
4. 跑 §4 池子 C（grep `disabled` + `Coming soon` + `comingB4` + 注释 `Import disabled` 等模式）→ 文件:行级
5. 跑 §5 池子 D（读 PRD + 上次 MVP-gap-audit + spec 漂移 grep）
6. 写 §7 DoD 终态对照（一行一步骤，关联到池子项）
7. §8 §9 总结
8. **必须跑：** /api/health 实测两次（prod + staging），DB latency 数字写入

**报告归档：** `docs/reviews/prod-mvp-readiness-audit-YYYY-MM-DD.md`

**用户接收后 Planner 后续动作：**
- backlog.json 增补 audit 文件:行明细（BL-XXX descriptions 加详尽段）
- 新增 BL-NNN 条目（D1/D2 等不在 backlog 的 PRD 偏差）
- environment.md 更正（如 prod DB 状态描述漂移）
- proposed-learnings.md 加候选（audit 模板修订 / 新规律）
- 不动当前 in-flight 批次（不打断 Generator）
