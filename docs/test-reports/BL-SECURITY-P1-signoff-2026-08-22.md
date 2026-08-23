# BL-SECURITY-P1 Signoff 2026-08-22

> 状态：**全部 PASS**（Evaluator 隔离验收完成，fix_round 0；verdict: `docs/test-reports/BL-SECURITY-P1-verdict.json`）
> 触发：前端评审 P1 安全簇六项 + F-32 查询放大治理，异厂商编排（generator=codex / evaluator=kimi）

---

## 变更背景

关闭 `docs/test-reports/frontend-code-review-2026-08-10.md` 的 P1 安全簇（F-01 认证边界 / F-02 开放重定向 / F-05 tooltip 存储型 XSS / F-33 决策竞态 / F-04 注册误判 / F-35 跨账号财务口径），并顺路治理批次成本查询放大（F-32 分片）。规格：`docs/specs/BL-SECURITY-P1-spec.md`。

---

## 变更功能清单与验收结果

### F001：AUTH_SECRET 生产 fail-closed + deploy workflow 硬失败 — **PASS**

**Executor：** generator（commit `dec508f`）
**验收实测：** 无 AUTH_SECRET 生产形态 `next start` → HTTP 500，仅静态错误、零密钥回显；构建期（`NEXT_PHASE` 信号）无 secret `npm run build` exit 0；`validate-deploy-secrets.sh` 缺 secret exit 1（硬失败），另两把钥匙保持 warning（exit 0，2 条 ::warning::）。单测四态抛错 + dev 占位绿。

### F002：safeCallbackPath + 登录开放重定向封堵 — **PASS**

**Executor：** generator（commit `d7eace0`）
**验收实测：** Evaluator 独立向量表 24 条恶意输入全部回落 `/`；合法路径逐字节保留；解码后二次判定防嵌套编码逃逸；`app/login/page.tsx` 无裸 callbackUrl 进 redirect。

### F003：图表 tooltip 存储型 XSS 转义 + device/source 输入约束 — **PASS**

**Executor：** generator（commit `234e8f0`）
**验收实测：** 恶意 device name 端到端：enroll 硬拒 400（边界实测）；batch 热路径 2xx + 截断/剥控制字符入库（真 scratch 库实测，毒丸不钉死队列）；渲染层 escapeHtml 全覆盖 4 个 chart 的 tooltip 插值；全仓 `dangerouslySetInnerHTML`/`innerHTML` 零命中；`src/cli/**` 零改动。

### F004：Gate 决策数据库 CAS — **PASS**

**Executor：** generator（commit `c672181`）
**验收实测：** 迁移后 scratch 库真实并发两请求 → 实测状态码 200 + 409；DB 终态恰一份 decisionSig 且等于 200 响应所示；重复决策 409 不覆盖；跨租户 404。features.json 遗留的 open_acceptance（真并发未闭合）本轮闭合。

### F005：订阅额度按 accountKey 分组 + additive 索引 migration — **PASS**

**Executor：** generator（commit `cb16ce1`）
**验收实测：** scratch 库 `migrate deploy` 29 条干净重放；双 accountKey fixture 探针证实 windows 与 capturedAt/capturedBy 不跨账号；单账号等价回归绿；新索引在 pg_indexes 实证；i18n 双语在库。open_acceptance（真 DB 面）本轮闭合。

### F006：设备注册绑定本次 enrollment — **PASS**

**Executor：** generator（commit `5d03f74`）
**验收实测：** 状态端点四态 + `force-dynamic` + no-store + 租户作用域；F-04 复现路径行为级断言（无关新设备不误判成功）；退避 1s→10s 封顶实测；`enrollmentId` additive 兼容；`initialDeviceIds` 死 prop 清理零残留。abort/unmount 三重守卫代码核检在库（无 jsdom，渲染级不可执行——见 Soft-watch S2）。

### F007：批次成本查询放大治理 — **PASS**

**Executor：** generator（commit `a43c522`）
**验收实测：** Evaluator 从原始 fixture 独立复算（不复用 Generator 断言）：totalComputeTokens=1,951,110 / totalCostUsd=19.388000 与产品输出逐字段一致；单查询聚合（$queryRaw 计数=1）；封闭批次跨 30s 窗口钉同一 sentinel cache key，活跃批次按量化窗口换 key；四条边界探针（乱序/同毫秒/开闭沿/时钟偏斜）绿；关联查询确定序 + take 上限 + UI 披露。

### F008：安全专项对抗输入独立验收报告 — **PASS**

**Executor：** evaluator（本角色）
**产物：** `docs/test-reports/BL-SECURITY-P1-security-audit-2026-08-22.md`（六项安全 + F007 复算的可复现命令与决定性输出）；`tests/evaluator/bl-security-p1-f008-probes.test.ts`（41 探针全绿）。

---

## 未变更范围

| 事项 | 说明 |
|---|---|
| `src/cli/**` · agent 协议 · `AGENT_FEATURE_VERSION` | 硬约束：7 个实现 commit 逐一 `git show --name-only` 核对零命中 |
| 生产 / staging | 本验收在隔离 checkout + 一次性 scratch PostgreSQL（docker pg16，验后销毁）执行，未触碰任何真实环境、凭证或付费服务 |
| `progress.json` / `features.json` 状态机字段 | 外部 evaluator 不写状态机；判定经 verdict.json 由编排者回流 |

---

## 预期影响

| 项目 | 改动前 | 改动后 |
|---|---|---|
| 缺 AUTH_SECRET 的生产运行时 | 静默占位串继续服务 | fail-closed 500 + deploy 硬失败 |
| 登录 callbackUrl | 零校验跳转 | 同源绝对路径白名单，余者落 `/` |
| tooltip 渲染 | 原始插值进 innerHTML | 全插值 HTML 实体转义 |
| gate 决策落库 | read-check-write 无 CAS | updateMany CAS，并发恰一胜 |
| 额度卡片 | DISTINCT ON 漏 accountKey 跨账号混拼 | provider+accountKey 分组，逐账号一卡 |
| 批次成本查询 | 逐区间 groupBy（≤60 往返）+ nowMs 毁缓存 | 单查询 range-join + 封闭批次永久缓存 |

---

## 类型检查 / CI

```
npm test          → 96 files passed | 7 skipped；1221 passed | 17 skipped（macOS, Node v25.7.0）
npm run verify    → exit 0（prisma generate + tsc --noEmit）
npm run lint      → exit 0（0 errors 0 warnings）
env -u AUTH_SECRET npm run build → exit 0
```

注：已知 Windows-only CI lifecycle 失败为 Windows CI 特有，本次 Linux/macOS 评估未出现，不计入判定。

---

## L2 实测记录

无 staging 影响 — N/A。本批安全语义全部在 L1 + 隔离 scratch 库实测闭环；F001 的生产 secret 人类闸门已在 2026-08-10 由用户确认（见 spec 关键决策记录）。

---

## Ops 副作用记录

本批次无生产/staging 数据库 ops。Evaluator 仅使用一次性 docker scratch 库（`blsec-eval-pg`，127.0.0.1:5545），验收后销毁。

---

## Harness 说明

本批经异厂商编排（generator=codex / evaluator=kimi，model_family 互斥）交付。Evaluator 判定已落 `docs/test-reports/BL-SECURITY-P1-verdict.json`（fix_round 0，8/8 PASS），状态机回流（status=done、docs.signoff 填写）由编排者执行——外部 evaluator 按规约不直接写状态机字段。

---

## Soft-watch（不阻塞 done，需后续跟进）

| ID | 描述 | 风险等级 | 建议处置 |
|---|---|---|---|
| S1 | `tests/shared/enrollment-status.test.ts:14` 为恒真断言（字符串字面量 not.toBe(null)），零回归检出力；承重行为断言在 :15（绿） | low | 下批次删除或改为行为断言 |
| S2 | F006 组件卸载 abort 无渲染级行为测试（仓库 vitest 为 node 环境无 jsdom）；三重守卫（AbortController + clearTimeout + cancelled）代码核检在库 | low | 如需行为证据，后续批次引入 jsdom/testing-library 再补 |

---

## Framework Learnings

本批次无 framework learnings。
