# Onboarding Overview Infographic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single self-contained HTML infographic at `docs/onboarding-overview.html` that introduces Tokenizer to new users in 7 sections, styled to match the existing brand-purple dashboard.

**Architecture:** One static HTML file, all CSS inlined in a single `<style>` block, all icons inlined as SVG, no JavaScript, no external network requests (no Tailwind CDN, no Google Fonts). Layout uses CSS Grid + Flexbox; responsive via one `@media (max-width: 768px)` breakpoint. Color palette and visual language mirror `tailwind.config.js` (`brand`, `navy`, `horizon*`) and the hero banner pattern from `app/page.tsx`.

**Tech Stack:** Plain HTML5 + CSS3 (custom properties for palette). No build, no deps.

**Spec:** `docs/superpowers/specs/2026-05-18-onboarding-overview-infographic-design.md`

---

### Task 1: Scaffold the file with shell, design tokens, and hero

**Files:**
- Create: `docs/onboarding-overview.html`

This task lands a working file you can open in a browser and see the hero section render. Everything else builds on the same `<style>` block and section pattern.

- [ ] **Step 1: Create the HTML skeleton with `<meta charset>`, viewport, `lang="zh-CN"`, page title, and empty `<style>` + `<body>` placeholders**

Use this exact shell so later tasks can append into `<style>` and `<main>` without restructuring:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tokenizer · 新用户总览</title>
  <style>
    /* design tokens + base layout go here in Step 2 */
  </style>
</head>
<body>
  <main class="page">
    <!-- sections appended in subsequent tasks -->
  </main>
</body>
</html>
```

- [ ] **Step 2: Add CSS design tokens and base layout inside `<style>`**

Define one set of custom properties matching `tailwind.config.js` colors. This is the single source of truth for the palette — later sections only reference `var(--...)`.

```css
:root {
  --brand-50:#E9E3FF; --brand-400:#7551FF; --brand-500:#422AFB; --brand-600:#3311DB;
  --navy-700:#1B254B; --navy-800:#111c44;
  --gray-100:#EEF0F6; --gray-200:#DADEEC; --gray-500:#B5BED9; --gray-700:#707EAE;
  --bg:#F4F7FE; --card:#FFFFFF;
  --horizon-green:#01B574; --horizon-orange:#FFB547; --horizon-blue:#3965FF; --horizon-purple:#7551FF;
  --radius-card:24px; --radius-chip:9999px;
  --shadow-card:0 10px 30px -12px rgba(112,144,176,0.18);
  --font-display:system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-display);
  background: var(--bg);
  color: var(--navy-700);
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
}
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 48px 24px 64px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.card {
  background: var(--card);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 28px;
}
.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-500);
}
.section-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--navy-700);
  margin: 0 0 4px;
}
.section-sub {
  color: var(--gray-700);
  font-size: 14px;
  margin: 0 0 20px;
}
code, .mono { font-family: var(--font-mono); }
@media (max-width: 768px) {
  .page { padding: 28px 16px 40px; gap: 24px; }
  .card { padding: 20px; }
}
```

- [ ] **Step 3: Append the Hero section (Section 1) into `<main>`**

The hero replicates the dashboard's hero banner pattern: gradient background + two blurred purple blooms + title/sub/chips. Markup:

```html
<header class="hero">
  <div class="bloom bloom-tr"></div>
  <div class="bloom bloom-bl"></div>
  <div class="hero-inner">
    <p class="eyebrow">Tokenizer · 新用户总览</p>
    <h1 class="hero-title">把每一次 AI 编码的 token 用量<br/>看得清清楚楚</h1>
    <p class="hero-sub">一份面向独立开发者与小团队的 AI 编码用量分析工具 —— 跨工具、多设备、多项目聚合，本地采集，集中分析。</p>
    <div class="chip-row">
      <span class="chip">🛠 多工具</span>
      <span class="chip">💻 多设备</span>
      <span class="chip">📁 多项目</span>
    </div>
  </div>
</header>
```

And append these styles to `<style>`:

```css
.hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-card);
  border: 1px solid var(--gray-200);
  background: linear-gradient(135deg, rgba(66,42,251,0.10) 0%, #ffffff 45%, rgba(66,42,251,0.05) 100%);
  padding: 40px 36px;
}
.bloom {
  position: absolute;
  border-radius: 9999px;
  background: rgba(66,42,251,0.18);
  filter: blur(60px);
  pointer-events: none;
}
.bloom-tr { top: -64px; right: -64px; width: 224px; height: 224px; }
.bloom-bl { bottom: -80px; left: -48px; width: 192px; height: 192px; background: rgba(117,81,255,0.18); }
.hero-inner { position: relative; }
.hero-title {
  font-size: 36px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--navy-700);
  margin: 12px 0 12px;
}
.hero-sub {
  color: var(--gray-700);
  font-size: 15px;
  max-width: 640px;
  margin: 0 0 20px;
}
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-chip);
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid rgba(66,42,251,0.15);
}
@media (max-width: 768px) {
  .hero { padding: 28px 22px; }
  .hero-title { font-size: 26px; }
}
```

- [ ] **Step 4: Verify in a browser**

Open `docs/onboarding-overview.html` in a browser (double-click or `xdg-open`/`open` it). Expected:
- White page with one card-style hero showing purple-tinted gradient and two soft blurred blooms.
- Title "把每一次 AI 编码的 token 用量 / 看得清清楚楚" rendered in dark navy.
- Three chips (多工具 / 多设备 / 多项目) in brand purple.
- DevTools → Network: zero requests (other than the HTML file itself).

- [ ] **Step 5: Commit**

```bash
git add docs/onboarding-overview.html
git commit -m "docs(onboarding): scaffold infographic + hero section"
```

---

### Task 2: Sections 2 + 3 — Data sources & architecture flow

**Files:**
- Modify: `docs/onboarding-overview.html`

- [ ] **Step 1: Append Section 2 (三大数据源) markup into `<main>`**

```html
<section class="card">
  <p class="eyebrow">数据源</p>
  <h2 class="section-title">三个本地源，零侵入采集</h2>
  <p class="section-sub">CLI 直接读你机器上的日志/数据库文件；不需要改你的工作流，不需要装插件。</p>
  <div class="grid-3">
    <article class="source-card source-claude">
      <div class="source-head">
        <span class="source-dot"></span>
        <h3>Claude Code</h3>
      </div>
      <p class="source-path mono">~/.claude/usage-data/session-meta/*.json</p>
      <p class="source-note">逐 session 解析 input / output / cached / cost</p>
    </article>
    <article class="source-card source-codex">
      <div class="source-head">
        <span class="source-dot"></span>
        <h3>Codex</h3>
      </div>
      <p class="source-path mono">~/.codex/sessions/**/rollout-*.jsonl</p>
      <p class="source-note">逐 rollout 事件解析模型与 token</p>
    </article>
    <article class="source-card source-opencode">
      <div class="source-head">
        <span class="source-dot"></span>
        <h3>OpenCode</h3>
      </div>
      <p class="source-path mono">~/.local/share/opencode/opencode.db</p>
      <p class="source-note">读本地 SQLite，按 assistant 消息一条一记</p>
    </article>
  </div>
</section>
```

- [ ] **Step 2: Append styles for Section 2 into `<style>`**

```css
.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.source-card {
  border: 1px solid var(--gray-200);
  border-radius: 18px;
  padding: 20px;
  background: linear-gradient(180deg, #ffffff 0%, #FAFBFF 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform .2s ease, box-shadow .2s ease;
}
.source-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-card); }
.source-head { display: flex; align-items: center; gap: 10px; }
.source-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: var(--navy-700); }
.source-dot { width: 10px; height: 10px; border-radius: 9999px; }
.source-claude .source-dot { background: var(--horizon-purple); box-shadow: 0 0 0 4px rgba(117,81,255,0.15); }
.source-codex  .source-dot { background: var(--horizon-green);  box-shadow: 0 0 0 4px rgba(1,181,116,0.15); }
.source-opencode .source-dot { background: var(--horizon-orange); box-shadow: 0 0 0 4px rgba(255,181,71,0.15); }
.source-path {
  margin: 0;
  font-size: 12px;
  color: var(--brand-600);
  background: var(--brand-50);
  padding: 6px 10px;
  border-radius: 8px;
  word-break: break-all;
}
.source-note { margin: 0; font-size: 13px; color: var(--gray-700); }
@media (max-width: 768px) {
  .grid-3 { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Append Section 3 (数据流转架构) markup into `<main>`**

Four steps with inline SVG arrows between them. On mobile they stack with a downward arrow.

```html
<section class="card">
  <p class="eyebrow">数据流转</p>
  <h2 class="section-title">从你的硬盘到仪表盘，四步走</h2>
  <p class="section-sub">本地解析、增量去重、HTTPS 上传，全程对原始日志只读。</p>
  <ol class="flow">
    <li class="flow-step">
      <div class="flow-num">1</div>
      <h4>本地读取</h4>
      <p>CLI 扫描三个源的日志/数据库文件</p>
    </li>
    <li class="flow-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12h12m0 0l-5-5m5 5l-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </li>
    <li class="flow-step">
      <div class="flow-num">2</div>
      <h4>增量去重</h4>
      <p><span class="mono">unique(source, sourceEventId)</span> 保证幂等</p>
    </li>
    <li class="flow-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12h12m0 0l-5-5m5 5l-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </li>
    <li class="flow-step">
      <div class="flow-num">3</div>
      <h4>HTTPS 上传</h4>
      <p>Bearer token 调 <span class="mono">POST /api/usage/events/batch</span></p>
    </li>
    <li class="flow-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12h12m0 0l-5-5m5 5l-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </li>
    <li class="flow-step flow-step-final">
      <div class="flow-num">4</div>
      <h4>入库 & 可视化</h4>
      <p>Server 解析事件，按租户聚合到仪表盘</p>
    </li>
  </ol>
</section>
```

- [ ] **Step 4: Append styles for Section 3 into `<style>`**

```css
.flow {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
  gap: 12px;
  align-items: stretch;
}
.flow-step {
  background: linear-gradient(180deg, #ffffff 0%, #F7F8FE 100%);
  border: 1px solid var(--gray-200);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.flow-step h4 { margin: 4px 0 0; font-size: 14px; color: var(--navy-700); }
.flow-step p { margin: 0; font-size: 12.5px; color: var(--gray-700); }
.flow-num {
  width: 28px; height: 28px;
  border-radius: 9999px;
  background: var(--brand-500);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.flow-step-final .flow-num { background: var(--horizon-green); }
.flow-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--horizon-blue);
}
@media (max-width: 768px) {
  .flow {
    grid-template-columns: 1fr;
  }
  .flow-arrow svg { transform: rotate(90deg); }
}
```

- [ ] **Step 5: Verify in a browser**

Reload `docs/onboarding-overview.html`. Expected:
- Section 2 shows 3 source cards side-by-side at desktop width; cards have colored dots (purple/green/orange) and the path text in a purple chip.
- Section 3 shows 4 numbered step cards with three right-pointing arrows between them, all on one row at desktop width.
- Resize the window below 768px (DevTools responsive mode @ 390px): both grids collapse to single column, the flow arrows rotate 90° to point down.

- [ ] **Step 6: Commit**

```bash
git add docs/onboarding-overview.html
git commit -m "docs(onboarding): data sources + architecture flow sections"
```

---

### Task 3: Sections 4 + 5 — Dashboard preview & capabilities

**Files:**
- Modify: `docs/onboarding-overview.html`

- [ ] **Step 1: Append Section 4 (仪表盘能看到什么) markup into `<main>`**

Four mini "widgets" mimicking the real dashboard cards. The numbers are illustrative — they're placeholders for visual reference, not data.

```html
<section class="card">
  <p class="eyebrow">仪表盘</p>
  <h2 class="section-title">一眼看懂你在 AI 上花了什么</h2>
  <p class="section-sub">所有数据按租户隔离；时间窗、项目、设备维度自由切换。</p>
  <div class="grid-4">
    <div class="widget">
      <p class="widget-label">Token 拆分</p>
      <p class="widget-value">1.24<span class="widget-unit">M</span></p>
      <div class="widget-bar">
        <span class="bar-in"  style="width:62%"></span>
        <span class="bar-out" style="width:23%"></span>
        <span class="bar-cache" style="width:15%"></span>
      </div>
      <p class="widget-legend"><span class="dot dot-in"></span>输入 <span class="dot dot-out"></span>输出 <span class="dot dot-cache"></span>缓存</p>
    </div>
    <div class="widget">
      <p class="widget-label">每日成本趋势</p>
      <p class="widget-value">$<span>18.40</span><span class="widget-unit">/天</span></p>
      <svg class="spark" viewBox="0 0 120 36" preserveAspectRatio="none">
        <polyline points="0,28 15,22 30,25 45,14 60,18 75,8 90,12 105,6 120,10" fill="none" stroke="var(--horizon-green)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <p class="widget-foot">↑ 12% 周环比</p>
    </div>
    <div class="widget">
      <p class="widget-label">项目排行 Top 3</p>
      <ul class="rank">
        <li><span>tokenizer</span><span class="mono">432k</span></li>
        <li><span>web-dashboard</span><span class="mono">281k</span></li>
        <li><span>parser-codex</span><span class="mono">187k</span></li>
      </ul>
    </div>
    <div class="widget">
      <p class="widget-label">设备贡献</p>
      <div class="device-row"><span>MacBook Pro</span><div class="device-bar"><span style="width:58%;background:var(--brand-500)"></span></div></div>
      <div class="device-row"><span>Linux Workstation</span><div class="device-bar"><span style="width:34%;background:var(--horizon-purple)"></span></div></div>
      <div class="device-row"><span>VPS Tmux</span><div class="device-bar"><span style="width:8%;background:var(--horizon-orange)"></span></div></div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append styles for Section 4 into `<style>`**

```css
.grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.widget {
  border: 1px solid var(--gray-200);
  border-radius: 16px;
  padding: 16px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 158px;
}
.widget-label { font-size: 12px; color: var(--gray-700); margin: 0; font-weight: 600; }
.widget-value { font-size: 24px; font-weight: 800; color: var(--navy-700); margin: 0; letter-spacing: -0.02em; }
.widget-unit { font-size: 13px; color: var(--gray-700); font-weight: 600; margin-left: 4px; }
.widget-bar { height: 8px; border-radius: 9999px; background: var(--gray-100); overflow: hidden; display: flex; }
.widget-bar span { display: block; height: 100%; }
.bar-in    { background: var(--brand-500); }
.bar-out   { background: var(--horizon-blue); }
.bar-cache { background: var(--horizon-orange); }
.widget-legend { margin: 0; font-size: 11px; color: var(--gray-700); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 9999px; margin-right: 4px; vertical-align: middle; }
.dot-in { background: var(--brand-500); }
.dot-out { background: var(--horizon-blue); }
.dot-cache { background: var(--horizon-orange); }
.spark { width: 100%; height: 36px; }
.widget-foot { margin: 0; font-size: 12px; color: var(--horizon-green); font-weight: 600; }
.rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rank li { display: flex; justify-content: space-between; font-size: 13px; color: var(--navy-700); }
.rank li .mono { color: var(--gray-700); font-size: 12px; }
.device-row { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--navy-700); }
.device-bar { height: 6px; background: var(--gray-100); border-radius: 9999px; overflow: hidden; }
.device-bar > span { display: block; height: 100%; border-radius: 9999px; }
@media (max-width: 768px) {
  .grid-4 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 480px) {
  .grid-4 { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Append Section 5 (核心能力) markup into `<main>`**

```html
<section class="card">
  <p class="eyebrow">核心能力</p>
  <h2 class="section-title">为什么用 Tokenizer</h2>
  <div class="grid-4 cap-grid">
    <div class="cap">
      <div class="cap-icon cap-icon-purple">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      </div>
      <h4>多设备聚合</h4>
      <p>一个账号关联多台机器，每台设备一个 token，数据汇总到同一仪表盘。</p>
    </div>
    <div class="cap">
      <div class="cap-icon cap-icon-blue">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h12"/></svg>
      </div>
      <h4>多项目过滤</h4>
      <p>按工作目录自动归类项目；可一键过滤"只看 Git 项目"，屏蔽实验性目录。</p>
    </div>
    <div class="cap">
      <div class="cap-icon cap-icon-green">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      </div>
      <h4>时间窗切换</h4>
      <p>7 天 / 30 天 / 全部时段一键切换，对比环比趋势，识别用量异常。</p>
    </div>
    <div class="cap">
      <div class="cap-icon cap-icon-orange">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 4v5h-5"/></svg>
      </div>
      <h4>增量同步 & 失败队列</h4>
      <p>幂等去重让重跑安全；上传失败会落入 <span class="mono">~/.tokenizer/queue.jsonl</span> 下次自动重发。</p>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Append styles for Section 5 into `<style>`**

```css
.cap-grid .cap {
  border: 1px solid var(--gray-200);
  border-radius: 16px;
  padding: 18px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cap h4 { margin: 6px 0 0; font-size: 15px; color: var(--navy-700); }
.cap p { margin: 0; font-size: 13px; color: var(--gray-700); }
.cap-icon {
  width: 36px; height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cap-icon-purple { background: rgba(117,81,255,0.12); color: var(--horizon-purple); }
.cap-icon-blue   { background: rgba(57,101,255,0.12); color: var(--horizon-blue); }
.cap-icon-green  { background: rgba(1,181,116,0.12);  color: var(--horizon-green); }
.cap-icon-orange { background: rgba(255,181,71,0.18); color: #C27400; }
```

- [ ] **Step 5: Verify in a browser**

Reload. Expected:
- Section 4 shows 4 widgets in one row at desktop: a stacked horizontal bar (Token 拆分), a sparkline (成本趋势), a ranked list, and three horizontal device bars.
- Section 5 shows 4 capability cards in one row, each with a tinted square icon (purple/blue/green/orange).
- At 768px both grids collapse to 2 cols; below 480px to 1 col.

- [ ] **Step 6: Commit**

```bash
git add docs/onboarding-overview.html
git commit -m "docs(onboarding): dashboard preview + capability sections"
```

---

### Task 4: Sections 6 + 7 — Quickstart timeline & footer

**Files:**
- Modify: `docs/onboarding-overview.html`

- [ ] **Step 1: Append Section 6 (5 步快速上手) markup into `<main>`**

```html
<section class="card">
  <p class="eyebrow">5 分钟上手</p>
  <h2 class="section-title">五步把你的 AI 用量接进来</h2>
  <p class="section-sub">完成前两步即可在控制台看到你的第一台设备；完成五步即可看到第一条用量。</p>
  <ol class="steps">
    <li class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>安装 CLI</h4>
        <p>在项目根目录链接全局命令，或者直接 <span class="mono">npm install -g</span>。</p>
        <pre class="cmd"><code>npm link</code></pre>
      </div>
    </li>
    <li class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>初始化配置</h4>
        <p>生成 <span class="mono">~/.tokenizer/config.json</span> 并指向你的 Tokenizer 服务地址。</p>
        <pre class="cmd"><code>tokenizer init</code></pre>
      </div>
    </li>
    <li class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>领取 enroll token</h4>
        <p>登录控制台 → <span class="mono">/devices</span> → 点击「添加设备」，复制一次性 enroll token。</p>
      </div>
    </li>
    <li class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>注册这台设备</h4>
        <p>用 enroll token 换取长期 device token，自动写入本地配置。</p>
        <pre class="cmd"><code>tokenizer enroll --enroll-token &lt;token&gt;</code></pre>
      </div>
    </li>
    <li class="step">
      <div class="step-num">5</div>
      <div class="step-body">
        <h4>采集 & 同步</h4>
        <p>扫描三个本地源、增量去重、上传到服务端。可加进 cron 或 launchd 定时跑。</p>
        <pre class="cmd"><code>tokenizer collect &amp;&amp; tokenizer sync</code></pre>
      </div>
    </li>
  </ol>
</section>
```

- [ ] **Step 2: Append styles for Section 6 into `<style>`**

```css
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.step {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 16px;
  align-items: flex-start;
  padding: 16px;
  border: 1px solid var(--gray-200);
  border-radius: 16px;
  background: linear-gradient(90deg, rgba(66,42,251,0.05) 0%, #fff 30%);
  border-left: 3px solid var(--brand-500);
}
.step-num {
  width: 36px; height: 36px;
  border-radius: 9999px;
  background: var(--brand-500);
  color: #fff;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.step-body h4 { margin: 0 0 4px; font-size: 15px; color: var(--navy-700); }
.step-body p { margin: 0 0 8px; font-size: 13.5px; color: var(--gray-700); }
.cmd {
  margin: 0;
  background: var(--navy-800);
  color: #E9E3FF;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  overflow-x: auto;
}
.cmd code { font-family: var(--font-mono); color: inherit; }
```

- [ ] **Step 3: Append Section 7 (页脚) markup into `<main>`**

```html
<footer class="foot">
  <div class="foot-grid">
    <div>
      <p class="eyebrow">配置文件</p>
      <p class="mono foot-mono">~/.tokenizer/config.json</p>
    </div>
    <div>
      <p class="eyebrow">失败队列</p>
      <p class="mono foot-mono">~/.tokenizer/queue.jsonl</p>
    </div>
    <div>
      <p class="eyebrow">API 入口</p>
      <p class="mono foot-mono">POST /api/usage/events/batch</p>
    </div>
  </div>
  <p class="foot-tag">Tokenizer · 把 AI 编码的每一个 token 都记账</p>
</footer>
```

- [ ] **Step 4: Append styles for Section 7 into `<style>`**

```css
.foot {
  border-radius: var(--radius-card);
  border: 1px solid var(--gray-200);
  background: linear-gradient(135deg, var(--navy-800) 0%, var(--brand-600) 100%);
  color: #fff;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.foot .eyebrow { color: rgba(255,255,255,0.7); }
.foot-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.foot-mono {
  margin: 4px 0 0;
  color: #fff;
  font-size: 13px;
  background: rgba(255,255,255,0.10);
  padding: 8px 12px;
  border-radius: 8px;
  word-break: break-all;
}
.foot-tag {
  margin: 0;
  text-align: right;
  font-size: 12px;
  color: rgba(255,255,255,0.7);
}
@media (max-width: 768px) {
  .foot-grid { grid-template-columns: 1fr; }
  .foot-tag { text-align: left; }
}
```

- [ ] **Step 5: Verify in a browser**

Reload. Expected:
- Section 6 shows 5 stacked step cards, each with a purple-circled number, a title, description, and (steps 1, 2, 4, 5) a dark navy code block.
- Section 7 shows a dark gradient footer with 3 inline path chips and a right-aligned tagline.
- Mobile: 3-col footer collapses to 1 col; tagline left-aligns.
- Scroll the whole page top-to-bottom: 7 sections in order, all spacing consistent (32px gap between sections, 24px on mobile).
- DevTools → Network: still zero external requests.

- [ ] **Step 6: Commit**

```bash
git add docs/onboarding-overview.html
git commit -m "docs(onboarding): quickstart timeline + footer"
```

---

### Task 5: Final pass — acceptance checks

**Files:** (no changes unless an issue surfaces)

- [ ] **Step 1: Open the file fresh in a browser with DevTools open**

Use Chrome or Firefox. Confirm:
- Network tab: zero external requests (just the HTML file).
- Console: zero errors.
- All 7 sections render in order: Hero → 数据源 → 数据流转 → 仪表盘 → 核心能力 → 5 步上手 → 页脚.

- [ ] **Step 2: Toggle responsive at 390px (iPhone-class)**

In DevTools responsive mode, set width to 390px. Confirm:
- All multi-column grids collapse to single column.
- Flow arrows in Section 3 rotate 90° to point downward.
- No horizontal scrollbar at any scroll position.
- All text readable, no overlap.

- [ ] **Step 3: Toggle responsive at 1100px+ (desktop)**

Confirm:
- Page is centered with whitespace gutters.
- 3-card and 4-card rows render fully in a single row without wrapping.

- [ ] **Step 4: Visual style sanity-check against the real dashboard**

Open `app/page.tsx` hero banner in the running app (or just inspect the file). Confirm the infographic hero uses the same gradient + bloom pattern and the brand purple matches.

- [ ] **Step 5: If anything fails, fix in place and re-verify; otherwise, no extra commit needed**

The earlier per-task commits already capture all changes.

---

## Self-Review

- **Spec coverage:**
  - Visual style (brand colors, hero bloom pattern, navy text, rounded cards) → Task 1 design tokens + hero; reused in all later sections.
  - All 7 content sections → Hero (T1), Data sources (T2), Architecture (T2), Dashboard preview (T3), Capabilities (T3), Quickstart (T4), Footer (T4).
  - Self-contained, no external resources, no JS → Task 1 shell, reinforced in T2/T3/T4 verify steps and Task 5 Step 1.
  - Responsive at 768px / 390px → CSS media queries in each task; verified in Task 5 Steps 2–3.
  - Acceptance criteria (zero external requests, 7 sections, brand-purple consistency, responsive) → Task 5 in full.
- **Placeholder scan:** No "TBD" / "implement later"; all CSS and HTML are concrete and ready to paste.
- **Type consistency:** CSS class names are unique and consistently used across sections (`.card`, `.eyebrow`, `.section-title`, `.section-sub`, `.grid-3`, `.grid-4`, `.mono`). No name drift.
- **Scope:** Single static file, one plan, one commit per section pair, plus a final verification task.
