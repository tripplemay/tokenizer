# UI Fidelity Guardrail

> **沉淀来源：** KOLMatrix BM1 批次签收后 UI fidelity 审计（2026-04-24）
> **触发：** 用户反馈 `/discovery` `/database` 实现与 Stitch 原型差异大；Generator 形成"看到装饰性 UI 就简化/删除"模式；BM2 F003/F005 已重演
> **适用场景：** 任何涉及 Stitch 原型参考的 UI 页面 feature

---

## 1. 问题定义

Generator 实现 UI 页面时常见 3 类偏离：

1. **装饰性删除** —— 主搜索区、Insights Panel、Quick Stats、Bulk Action Bar、AI CTA 等"非核心 CRUD 功能"被归类为"可删的装饰 UI"
2. **组件复用漏失** —— 抄 Stitch HTML 的 className 直接手写，忽视 `@/components/common/*` 的现有抽象
3. **幽灵控件** —— 保留 UI shell（如 checkbox）但未接功能（无 bulk action 反应），比完全删除更差 UX

根因：Generator prompt 中"对齐 Stitch xxx.html"被理解为"大体布局一致"，而非"逐元素还原"。

## 1.1 视觉参照物铁律（2026-04-24 发现 PNG 缩略图限制后新增）

**`design-draft/stitch-references/*.png` 全部是 512px 封顶的 Stitch preview 缩略图**（~240-512px × ~410-515px），仅作视觉索引（快速浏览找页面）用，**不是像素级参照物**。

**真实参照物是 HTML 文件**（`design-draft/stitch-references/*.html`）——用浏览器打开就是 Stitch 设计的真实 DOM 渲染（字号 / 颜色 / 间距 / icon / 动效全部精确到 CSS 值）。

### 所有角色的视觉参照规则

| 角色 | 读什么 | 怎么做 |
|---|---|---|
| **Planner 起草 spec** | HTML 源码（精确结构） + 浏览器打开 HTML（视觉） | `file:///.../kol-discovery.html` 在浏览器打开 + VS Code 看 className 源码，两者结合逐元素列"不得简化清单" |
| **Generator 实现** | HTML 浏览器渲染 + DevTools inspect | 浏览器开 HTML + 开发者工具看计算样式（比如 padding/margin 的 px 值），对照目标 Tailwind class 实现 |
| **Evaluator 签收** | HTML 浏览器并排 + staging screenshot | 两浏览器窗口并排（左 HTML 原型 / 右 staging 登录态同路由），同分辨率下肉眼逐 section 对 |

**禁止** 的做法：只看 PNG 缩略图做视觉判断——分辨率不够，细节全糊。

**过渡期**：`design-draft/stitch-references/renders/*.png`（~1920px 大 PNG，由未来 BL-010 script 自动从 HTML 渲染产出）出现前，只用 PNG 做"找页面"，像素对比仍用 HTML。

---

## 2. Spec 起草硬要求（Planner）

> **⚠️ 严格强制 — Planner spec 起草自检 checklist + Reviewer L1 受理前 checklist**
>
> Planner 起草 UI 类 feature spec 必须自检 4 段全含（见 `planner.md` §UI 类 spec 起草前 mandatory self-check checklist）；Reviewer L1 受理前必须 grep spec 确认 4 段都在，缺任一段 → 拒收 spec 退回 Planner 补全（不是 FAIL feature，是规格本身不合规）。
>
> 反面案例：BL-025 spec v1 仅含 §2.1，§2.2/2.3/2.4 全缺，靠用户 challenge 才补 → 来源 v0.9.6 [#5]。

**所有 UI 类 feature 的 acceptance 段必须包含以下 4 个子段：**

### 2.1 Stitch 原型参考路径（必须）

```markdown
**原型参考：** `design-draft/stitch-references/<page>.html`（用浏览器打开作为主视觉参照；同目录 .png 仅是 512px 缩略图索引，不够像素级对比）
```

### 2.2 必用公共组件清单（必须）

Generator 开工前对照清单，明确列出用 `@/components/common/*` 或 `@/components/ui/*` 哪些组件。例：

```markdown
**必用公共组件：**
- `GlassPanel` for 所有半透明容器
- `SectionHeader` for 每个 section 顶
- `GhostButton` / `SecondaryButton` / gradient CTA 用 `@/components/ui/Button` variants
- `StatCard` for KPI 卡片（如 dashboard F007 实现）
- `Dialog` for modal（若不存在需先抽取）
- `<TableRow> <TableCell>` for 表格（若不存在需先抽取）
```

### 2.3 不得简化的元素清单（必须）

Planner 起草 spec 时**逐条对照 Stitch 原型**，列出**看起来可删但不得删**的元素：

```markdown
**不得简化的元素**（Generator 若认为应简化须主动发 pre-impl 审计请求，不得自行删）：
- [ ] 主搜索区（platform selector + search + AI chips 轮转）
- [ ] AI Smart Match gradient CTA 按钮（右上角）
- [ ] Insights Panel（右侧窄列 320px 固定）
- [ ] Quick Stats 4 KPI strip（顶部）
- [ ] Bulk Action Bar（表格选中后底部浮动）
- [ ] Active Filter chips（可视化 + 可清除）
- [ ] Grid/List 视图切换 toggle
- [ ] ...
```

### 2.4 Visual regression baseline 硬性要求（必须）

```markdown
**Visual baseline：**
- 路径 `tests/screenshots/baseline/en-<page>.png` 必须入 git
- `git ls-files tests/screenshots/baseline/en-<page>.png` 返回非空才算 feature 完成
- Playwright scaffold 存在但 PNG 未生成 → 该 feature 判 PARTIAL 不算 PASS
```

---

## 3. Generator 开工硬要求

**UI 页面 feature 的 pre-impl 审计是强制的**（不是可选），含至少以下 3 条决议点：

### 3.1 "装饰性元素"每条明确处理

对 Stitch 原型中每个"看起来非 CRUD 核心"的元素（KPI 卡 / Insights / AI CTA / Quick Stats / Bulk Action 等），Generator 必须在 audit 里列：
- 方案 A：照原型实现（MVP 必须有）
- 方案 B：简化/删除（必须给出充分理由，Planner 裁决）
- 方案 C：占位 placeholder（如"Coming in BM2"按钮 disabled）

不得自行选 B 开工。

### 3.2 公共组件复用清单

Generator 在 audit 里列 5-8 条"本页将用哪些 `@/components/*` 组件"。缺失抽象时列"需要 Planner 批准新建 `XXXComponent`"。

### 3.3 幽灵控件检查

若原型有某控件（checkbox / toggle / dropdown）但 MVP 暂不接功能，Generator 有两个选择：
- **隐藏**：完全不渲染该控件
- **disabled + tooltip**："Coming soon"（disabled + opacity-50 + tooltip）

**不得保留 active 但无反应的幽灵控件**。

---

## 4. Evaluator 签收硬要求

### 4.1 Visual baseline 查

签收 PASS 前必须 `ssh vps 'cd /opt/kolmatrix && git ls-files tests/screenshots/baseline/*.png'` 返回非空。

**Scaffold 存在 + PNG 未生成 = PARTIAL**，不是 PASS。

### 4.2 Stitch 还原度评估段

签收报告模板加一节：

```markdown
## Stitch 还原度评估
- 原型参考：<html-path>（浏览器打开；**不用 PNG**，PNG 是 512px 缩略图，看不清细节）
- Reviewer 并排打开两浏览器窗口（左 Stitch HTML 原型 / 右 staging 登录态同路由），同分辨率下逐 section 对比
- 缺失/简化元素清单（以 spec §2.3 "不得简化" 为 baseline）
  - [ ] ...
- 总体评级：🟢 pixel-perfect / 🟡 有中度差异可接受 / 🔴 重大缺失必须回 fixing
```

### 4.3 公共组件复用核查

`grep -rn "className=\".*glass-panel\|className=\".*gradient-cta\|className=\".*rounded-" src/app/[locale]/\(app\)/<page>/ | wc -l` 超过阈值（经验：>20 行 hardcoded className 在单文件）→ 提示 Planner 考虑抽取组件（不判 FAIL 但留记录）。

---

## 5. Anti-patterns（不得出现）

### 5.1 Generator 自行"MVP 化"

**错误：** Generator 看到原型有 Insights Panel 就想"这是 BM2 可做的，BM1 先不做"
**正确：** 查 spec §2.3 "不得简化" 清单；不在里面 → 问 Planner 而不是自删

### 5.2 Planner 写 spec 时只给"对齐 Stitch"一句话

**错误：** acceptance 只说 "src/app/... 对齐 Stitch xxx.html"
**正确：** 列 §2.1-2.4 四个子段，特别是 §2.3 "不得简化"清单逐条

### 5.3 Evaluator 只验功能不验视觉

**错误：** 功能 E2E 全绿就签 PASS，不核 visual baseline
**正确：** §4.1 baseline 入库 + §4.2 还原度评估两项都签

### 5.4 反复"幽灵控件"

**错误：** checkbox 保留但点了没反应 / dropdown 显示但 onChange 无 handler
**正确：** 隐藏 or disabled + tooltip 二选一

---

## 6. 启动检查清单（Planner 新 UI feature 起草前）

- [ ] spec acceptance 含 §2.1-2.4 四个子段
- [ ] §2.3 不得简化清单对照 Stitch HTML 原文逐项核（不是凭印象）
- [ ] §2.2 必用公共组件清单具体到组件名，不是"沿用设计系统"
- [ ] pre-impl 审计模板里提醒 Generator 本 guardrail 的 §3 要求

## 7. 与其他 harness 机制的关系

| 机制 | 关系 |
|---|---|
| `pre-impl-adjudication.md` | UI feature 的 pre-impl 审计是 §3 硬要求，不是可选 |
| `role-context/evaluator.md` | §4 签收条款须入 evaluator.md |
| `deploy-patterns.md` §2 | VPS artifact in-git 原则同理用于 baseline PNG |
| 铁律 6 | Generator 不得执行 codex 任务 — guardrail 由 Planner 写 spec + Evaluator 审，非 Generator 自检 |

---

## 8. 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-04-24 | 初版沉淀 | KOLMatrix BM1 签收后 UI fidelity 审计 + BM2 F003/F005 重演确认 |
