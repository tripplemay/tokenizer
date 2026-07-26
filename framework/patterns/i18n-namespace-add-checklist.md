# i18n 命名空间新增 Spec Checklist

> **Source:** v0.9.10 — KOLMatrix BL-033-F004 首推 CI 25321942649 红，i18n 双门同时触发（locale-coverage 行业词字面一致 + placeholders ICU plural shape parity）。BL-014/BL-025 因都已预处理过未触发，BL-033 首次踩双门。Generator session_notes 提案，Reviewer signoff §Framework Learnings 入框架。
>
> **触发时机：** Planner 起草批次 spec 涉及**新增 messages/{locale}.json 命名空间**或**已有命名空间扩展 ≥ 5 个 keys**时（含 sub-namespace 添加），spec 必含本 checklist。

---

## 1. CI 双门预查（spec 起草必走）

项目通常含两个 i18n CI 守门：

### 1.1 locale-coverage 守门 — 抓"行业惯用词在多语言中字面一致"

**机制：** CI 脚本扫描 `messages/zh.json` `messages/ja.json` `messages/ko.json` 中是否含与 `messages/en.json` 完全一致的字面字符串。意图：发现未翻译的 fallback。但行业惯用词（如 "KOL" / "AI" / "CPI" / "ROI" / "URL" / 品牌名）在所有语言中字面相同是合法的。

**常见 false-positive：**
- KOL（无中日韩本地化对应词，业内通用英文）
- AI（同上）
- CPI / ROI / GMV（财务指标缩写）
- 品牌名 / 产品名（如 "Pokemon Go" / "Stitch"）

**修法（推荐）：CI 脚本含 `KEEP_AS_EN_PATHS` allowlist** — 给"故意全语言一致"的 path 加白名单。

**Spec 起草 checklist：**
- [ ] 列出新命名空间内 ≥ 1 个英文行业惯用词的 path（如 `assets.sources.ai_generated` 含 "AI"）
- [ ] 把这些 path 写入 spec §"i18n CI allowlist 修订"段
- [ ] Generator 在 PR 中同步修订 CI 守门脚本的 `KEEP_AS_EN_PATHS`

**反面案例（BL-033 漏触发）：** spec §D4 schema 列了 `assets.sources.ai_generated="AI Generated"` 但未提示行业词处理 → Generator 5 语言原样填 "AI Generated" / "AI 生成内容" / "AI 生成のコンテンツ" → CI red → fix commit 25321942649 加 allowlist 才过。

### 1.2 placeholders 守门 — 抓 ICU plural shape parity

**机制：** CI 脚本扫描所有语言文件中含 `{count, plural, ...}` ICU shape 的 keys，要求所有语言**形状一致**：

```json
// en.json — has plural
"productAssetCount": "{count, plural, one {# asset} other {# assets}}"

// zh.json — must also be plural shape (CJK 不变形 one/other 同文本，但形状必填)
"productAssetCount": "{count, plural, one {# 个素材} other {# 个素材}}"

// 不允许：
"productAssetCount": "{count} 个素材"  // ❌ 形状不一致 → CI red
```

**修法（推荐）：** ja/ko/zh 等 CJK 语言**也用 ICU plural 包裹**（one/other 同文本，渲染显示一致），避免形状漂移。

**Spec 起草 checklist：**
- [ ] 所有含 `{count, plural, ...}` 的 key 在 spec §schema 段标注 "ICU plural shape required in all 5 languages"
- [ ] CJK 语言用 `{count, plural, one {...} other {...}}` 包裹（one/other 文本可相同）
- [ ] Generator 实装时不要在 CJK 语言里写 `{count} XXX` 简化形态

**反面案例（BL-033 漏触发）：** spec §D4 schema 列了 `assets.toasts.summary` 含计数但未明确 ICU plural 形态 → Generator zh.json 写 `{count} 个素材已选` → CI red → fix commit 25321942649 改为 `{count, plural, one {# 个素材已选} other {# 个素材已选}}`（CJK same text 但 ICU 包裹）。

---

## 2. 翻译质量分级标记（多语言项目硬要求）

项目 5 语言（en/zh/ja/ko/es）+ Generator 主语言（通常 en + zh）+ 其它语言 LLM 翻译时：

**Spec 起草 checklist：**
- [ ] 主语言（en + zh 等）手填地道翻译
- [ ] 非主语言 LLM 翻译产出，**文件顶部加注释**：
  ```jsonc
  // BL-XXX-FYYY machine-translated, 待 BL-014 人工审核
  ```
  或在 namespace 内加 `_machineTranslated: true` 标记
- [ ] BL-014 backlog 项（或等同人工审核 backlog）需更新引用，跟踪本批次新增机译

**反面案例：** 没标记 → 团队后续以为已审核 → 真客户上线前才发现质量差。

---

## 3. 命名空间命名规约

- **顶层 namespace** 与功能模块 1:1（如 `assets` / `outreach` / `knowledgeBase`）
- **sub-namespace** 用 camelCase（如 `wizard.step1` / `card.quickActions`）
- **error keys** 在 `errors` sub-namespace 下，key 与 server actions.ts 返回的 `result.code` 字段**完全一致**（如 `errors.asset_not_found`）— UI 端 `t(\`errors.\${result.code}\`)` 直查
- **toast keys** 在 `toasts` sub-namespace（如 `toasts.duplicated` / `toasts.archived`）

---

## 4. Spec 起草必含段（v0.9.10 模板）

涉及 i18n 命名空间新增的 spec **必含**以下段：

```markdown
### D-i18n: i18n 命名空间扩展计划

**新命名空间：** `<namespace>`

**Schema：**
- `<sub-namespace 1>`: ...
- `errors`: 12 keys 1:1 对应 actions.ts result.code

**翻译策略：**
- en + zh: 手填
- ja/ko/es: LLM 翻译 + `_machineTranslated` 标记 + BL-014 跟踪

**i18n CI 双门兼容：**
- 行业词 allowlist 新增 path：`<namespace>.<path>`（含 KOL/AI/CPI 等）
- ICU plural keys：`<namespace>.<key>`（5 语言全用 plural shape）
```

---

## 5. Reviewer L2 验收 checklist

- [ ] 浏览器切到 /zh/<feature> → 全 UI 中文（含 toast / placeholder / aria-label / 错误信息）
- [ ] 浏览器切到 /en/<feature> → 全 UI 英文
- [ ] 浏览器切到 /ja|/ko|/es/<feature> → 不显示 raw key 字符串（哪怕是机译质量问题）
- [ ] CI 25XXX 全 8 jobs success（含 i18n-locale-coverage / i18n-placeholders 两个 job）

---

## 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-05-04 | 初版（§1 双门 + §2 翻译质量标记 + §3 命名规约 + §4 spec 模板段） | KOLMatrix BL-033-F004 首踩双门 + Generator session_notes 提案 |
