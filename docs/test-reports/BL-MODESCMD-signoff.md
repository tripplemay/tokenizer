# BL-MODESCMD 验收签署

**批次：** `tokenizer harness --modes` 终端子命令
**车道：** 本地异构 —— **generator = Codex（外部 CLI 写代码）· evaluator = Kimi（跨厂商复核）**
**结论：** F001 PASS（单轮通过，无 fix_round）

## 这一批同时是 dispatch「外部 generator」路径的首次实跑

| 环节 | 结果 |
|---|---|
| Codex 实现 | 两轮共 51 分钟；新增 `harness-modes-print.ts`(43 行) + `index.ts` 加 `--modes`(6 行) |
| 提交 | **由编排者按 features.json 打 tag**（`7bdd03c`）——Codex 两轮均无法提交（厂商沙箱禁写 `.git`），如实上报、未伪造 SHA、未 push |
| 回流① diff 与规格边界对账 | 越界文件 **0** |
| 回流② spec-lock 稽核 | 复用既有 `buildModeSnapshot`；`--modes` 提前 return 不落到网络路径 |
| 回流③ L1（编排者自跑） | tsc 干净 · 405 测试通过 · 命令实跑退出码 0 |
| 回流④ 提交与推送 | 归编排者，外部实例全程不 push |

## Kimi 的独立复核（跨厂商，非同 family）

自建三项目受控 fixture（全要素 / 最小 / 非 harness 目录），**构造已知漂移数**并核对输出吻合：
`漂移 2 · 定制 1` 与 fixture 的 ok1/modified1/missing1/customized1 对得上，`机件 4/4` 与
settings.json 的四个 hook 对得上；`not-harness` 正确未被发现。

- **不触发网络**：指到 `index.ts:45-48` 的提前 return，并追出「唯一网络出口是 `agentFetch`
  （`harness.ts:166` 上报 / `:227` 拉决策），只有 `runHarnessSync` 可达」——不是只搜 fetch 字样
- **回归双证据**：(a) `git diff 9e3d6b6..7bdd03c` 显示 `--list` 与无旗标路径逐字节未动；
  (b) 取父提交旧版与现版在同一 fixture 下 A/B 实跑，两侧输出 diff 为空、退出码同为 0
- **边界核验**：`harness.ts` / `harness-modes.ts` 该区间 diff 为空（既有导出签名未动）；`app/` `prisma/` 未碰

## 沙箱四道锁事后核查

主仓污染 0 · 外部实例无 push · 日志中真实凭据零命中 · 超时封顶可用（v1.4.1 修复后）。

**待人类批准 `verifying → done`。**
