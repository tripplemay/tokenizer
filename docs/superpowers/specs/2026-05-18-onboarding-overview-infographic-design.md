# 新用户介绍信息图（单张总览长图）

**Date:** 2026-05-18
**Status:** Approved (pending spec review)

## Problem

新用户第一次进入 Tokenizer 时只看到一个空的仪表盘 + 一个 `OnboardingCard`，
对"这个系统是什么、能采到什么数据、价值在哪里、怎么 5 分钟跑起来"缺少
一张一眼看懂的全景图。需要一份图文并茂的介绍材料，可分享、可贴到
README 或对外渠道，让新用户/潜在用户在不进产品的情况下也能理解整套能力。

## Goals

- 一张总览长图，把 Tokenizer 的核心能力按"是什么 → 采什么 → 怎么流转
  → 看到什么 → 怎么上手"的叙事串起来。
- 视觉与产品本身一致：用 `tailwind.config.js` 里的 `brand` 紫色调和
  `horizon*` 辅色，复刻 `app/page.tsx` hero banner 的渐变 + 紫色 bloom。
- 单文件、自包含、脱机可看；可直接截图导出 PNG 分享。

## Non-Goals

- 不做多张分主题信息图（用户已确认只要一张总览大图）。
- 不强调"多租户数据隔离"作为亮点（用户已明确剔除）。
- 不做 A4 分页 / 打印 PDF 优化。
- 不做英文或双语版本（仅中文）。
- 不集成进 Next.js 路由、不做 React 组件化、不引入 i18n 词条。

## Output

**单文件：** `docs/onboarding-overview.html`

- 仅作为仓库内文档存在，不进 `public/`，不参与 Next.js 构建与部署。
- 双击即可在浏览器打开；不联网、不依赖 Tailwind CDN、不引用外部 CSS/字体。
- 字体回退到 system-ui 栈（与 `tailwind.config.js` 的 `display` family
  保持一致）。
- 所有图标、装饰图形使用内嵌 SVG（不依赖 react-icons 或任何外部图标库）。

## Visual Style

直接对齐 `tailwind.config.js` 与 `app/page.tsx` 已有视觉语言：

- **主色：** `brand-500 #422AFB`（主），`brand-400 #7551FF`（辅）。
- **强调色（区分数据源/能力）：**
  - Claude Code → `horizonPurple-400 #7551FF`
  - Codex → `horizonGreen-500 #01B574`
  - OpenCode → `horizonOrange-500 #FFB547`
  - 数据流箭头 / 链接 → `horizonBlue-500 #3965FF`
- **文字：** 标题 `navy-700 #1B254B`，副文 `gray-700 #707EAE`。
- **背景：** 页面底色 `lightPrimary #F4F7FE`；卡片白底 + 1px `gray-200 #DADEEC`
  边、`rounded-3xl`、柔和阴影。
- **Hero / 关键段落：** 复刻 `home/page.tsx` hero banner —— `bg-gradient-to-br
  from-brand-500/10 via-white to-brand-500/5` + 两个 `blur-3xl` 紫色 bloom。
- **整体宽度：** 居中 `max-width: 1100px`；移动端正常竖向滚动。

## Content Structure（7 节，自上而下）

1. **Hero**
   - 主标题：「把每一次 AI 编码的 token 用量看得清清楚楚」
   - 副标题一行点出"多工具、多设备、多项目聚合分析"
   - 三个 chip：多工具 / 多设备 / 多项目
   - 紫色 bloom 装饰

2. **三大数据源**（3 卡横排，移动端竖排）
   - Claude Code · `~/.claude/usage-data/session-meta/*.json`
   - Codex · `~/.codex/sessions/**/rollout-*.jsonl`
   - OpenCode · `~/.local/share/opencode/opencode.db`
   - 每卡：图标 + 名称 + 采集路径（等宽字体）+ 一行能贡献的字段

3. **数据流转架构图**（横向 4 步 + SVG 箭头）
   1. 本地 CLI 读取日志/数据库
   2. 增量去重（`unique(source, sourceEventId)`）
   3. HTTPS 上传 Bearer token 到 `/api/usage/events/batch`
   4. Server 解析入库 → 仪表盘可视化

4. **仪表盘能看到什么**（4 个 mini widget 模拟）
   - 输入 / 输出 / 缓存 tokens 拆分
   - 每日成本趋势（mini sparkline）
   - 每项目 token 排行
   - 每设备贡献占比

5. **核心能力高亮**（4 个能力小卡）
   - 多设备聚合
   - 多项目过滤（Git Only 过滤）
   - 时间窗切换（7d / 30d / All）
   - 增量同步 & 失败队列（`~/.tokenizer/queue.jsonl`）

6. **5 步快速上手**（时间线 / step list）
   1. `npm link`（或安装 CLI）
   2. `tokenizer init`
   3. 在网页控制台 `/devices` 领取 enroll token
   4. `tokenizer enroll --enroll-token <token>`
   5. `tokenizer collect && tokenizer sync`
   - 每步配一行命令（等宽字体框 + 紫色左侧 accent）

7. **页脚**
   - 配置文件路径：`~/.tokenizer/config.json`
   - 队列文件路径：`~/.tokenizer/queue.jsonl`
   - 一行链接占位（仓库地址留空 / 文本占位即可）

## Technical Approach

- 单个 HTML 文件，`<style>` 内联全部 CSS，不引用任何外部资源。
- 使用 CSS variables 定义上述配色，便于阅读和后续微调。
- 响应式用纯 CSS `@media (max-width: 768px)`：三/四列卡片切换为单列。
- SVG 图标全部内嵌（每个数据源 1 个、每步流程 1 个、装饰 bloom 用 div +
  `filter: blur()`）。
- 不写 JS（无交互需求）。

## Acceptance

- `docs/onboarding-overview.html` 文件存在，双击在 Chrome / Firefox 中
  打开后：
  - 不发任何外部网络请求（DevTools Network 面板为空，字体除外可回退到系统）。
  - 内容按上述 7 节顺序完整显示，无破版。
  - 主色与产品仪表盘一致（紫色 #422AFB 系），有 hero bloom 效果。
  - 在 1100px 桌面宽度下卡片横排；在 ~390px 移动宽度下卡片自然换行为单列。
