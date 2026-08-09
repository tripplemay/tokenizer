# BL-GATE-INBOX — 闸门全局触达：待批徽章 + 邮件通知 + 三处存而不显补显

> 状态：planning 定稿 · 2026-08-10 · Planner=主会话（快车道默认映射；staged intent 77af0221 已随
> BL-REPO-MECH 消费，按 once 语义不重放——如需异构形态请控制台签新 intent 下批消费）
> 详细依据：`docs/analysis/2026-08-08-repo-strategy/batch-plans/BL-GATE-INBOX.md`（规划期实地核对，
> 关键更正：收件箱聚合本体**已存在**于 /harness 列表页 page.tsx:49-57——真实缺口是全局触达与补显）

## 1. 目标

把人闸门从「要主动开 /harness 刷」变成「任何页面都能被触达」：全站待批徽章 + 闸门邮件通知
（复用既有 Resend 基建），并补齐三处存而不显。**零 agent↔服务端协议改动，AGENT_FEATURE_VERSION 不动。**

## 2. Features（普通批次，全部 executor:generator，执行序 F001→F002→F003→F004→F005）

### F001 · 全局待批徽章 + pending-count API
- `app/api/harness/gates/pending-count/route.ts`（新）：session 鉴权；`{pending: n}`，n = HarnessGate count
  where userId + consumedAt null + decisionAction null；未登录 401。
- `app/_components/pending-gates-badge.tsx`（新）：n>0 红底计数徽章 `<Link href="/harness">`；n=0 或 fetch
  失败不渲染；30s 轮询（常量与 /harness AutoRefresh 同拍）。挂载 `src/components/navbar/index.tsx`。
- acceptance：①401/计数条件/响应形状单测；②组件三分支（n>0/n=0/失败）单测；③轮询常量导出断言；④verify/lint 绿。

### F002 · 闸门邮件通知（Resend REST，fail-open）
- schema：`HarnessGate.notifiedAt DateTime?`（claim 列，纯 additive migration）。
- `src/server/harness-gate-notify.ts`（新）：claim 式防重发（`updateMany where notifiedAt:null` 计数 1 才发）；
  Resend REST（`AUTH_RESEND_KEY`/`AUTH_EMAIL_FROM` 已是生产 env，零新依赖）；正文含项目/kind/batch/
  from→to/raisedAt(UTC)/控制台链接（`NEXT_PUBLIC_APP_URL` 优先回落 request origin）。
- report route：gate 落库后事务外 fire-and-forget；re-raise 清 `notifiedAt` 再通知；发送失败复位 null 重试。
- **fail-open 铁则**：key 未配/email 空/发送失败一律静默跳过，report 通道 200 不受影响（通知故障不得卡上报）。
- acceptance：①并发 claim 只发一封；②无 key → 跳过且 200；③发送失败复位重试；④re-raise 再通知；⑤渲染纯函数快照（UTC + 链接）。

### F003 · evidence 查看先行版（纯服务端，内容上传剥离在 BL-GATE-EVIDENCE-UPLOAD）
- `src/shared/harness-evidence.ts`（新）：路径分类纯函数（docs/ 前缀→repoDoc / 其他→path；防御空串/超长）。
- `app/harness/evidence-list.tsx`（新）：路径 + 分类徽标 + 剪贴板复制；接入列表页 page.tsx:124-130 裸列表
  与详情页 views.tsx 两处 gate 渲染点；i18n en/zh。
- acceptance：①分类纯函数边界单测；②三渲染点均引用 EvidenceList（grep 断言，裸列表清零）；③空数组不渲染；④verify 绿。

### F004 · dashboardUrl 补显
- 详情 overview 加外链 Fact + 列表卡片小外链；经 `src/shared/url.ts` `safeHttpUrl` 过滤（javascript: 拒）；i18n。
- acceptance：①safeHttpUrl 测试补 case；②空值显示 notReported 不渲染 `<a>`；③`grep -rn dashboardUrl app/` 命中 >0（现为 0 的机械翻转）。

### F005 · dispatch 产物补显
- `src/server/harness-detail.ts` dispatchRuns select 补 `artifactPath/artifactSha256`；Activity 表加产物列
  （path mono + sha256 截断 title 全量）。**注意**：`tests/server/harness-detail.test.ts` 现有断言明确排除这两列，
  需反转并在 commit 说明依据（两字段入库前已过服务端校验：repo-relative ≤512 无穿越 + SHA256 格式，非 raw 通道）；
  `decisionSig`/intent `payload`/`signature` 的排除断言保留。
- acceptance：①select 断言反转；②两者皆空显示 "—"；③敏感字段排除断言保留；④verify 绿。

## 3. 编排与边界

- 快车道默认映射：主上下文 Generator 串行（F002 与 BL-TRANSITION-LOG 同改过 report route，注意与现网
  transition/archive 逻辑共存）；隔离 subagent evaluator 验收；fan-out（5 features）。
- **部署**：全批产品代码，整批实现完、verify/test/lint/build 四绿后一次 push（migration 纯 additive 零停机）。
- Out：独立 /harness/inbox 新页（聚合本体已在列表页，另起页=双批准面）· evidence 内容上传（协议批次
  BL-GATE-EVIDENCE-UPLOAD）· webhook/推送第二通道 · decision expires_at 限期授权 · 闸门历史分页。
- 风险：邮件通知的 claim 与 serializable 重试交互（claim 在事务外、以 notifiedAt 原子 updateMany 保证恰一次）；
  Resend 额度/可达性（fail-open 设计使其只影响通知不影响状态机）。
