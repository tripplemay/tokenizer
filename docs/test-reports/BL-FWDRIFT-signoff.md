# BL-FWDRIFT 验收签署

**批次：** BL-FWDRIFT — 控制台显示「框架落后 N 版 + 升级指引」
**车道：** 本地异构 + fan-out 对抗复核（generator=main-claude，evaluator=reviewer-kimi × reviewer-codex）

| 轮次 | Kimi | Codex | 处置 |
|---|---|---|---|
| fix_round 0 | PASS/PASS/**FAIL**/PASS | **FAIL**×4 | 结论不一致 → 举 `debias_conflict` 闸门 → 人类裁决（控制台批准，签名 `SniH6cO2…`） |
| fix_round 1 | **PASS ×4** | **PASS ×4** | 一致通过 |

## 两轮之间实际改了什么

1. **F001 真 bug**（Codex 独家抓到）：`parseFrameworkVersion` 只校验「三段全是数字」，
   `Number()` 吞掉前导零、`join` 后命中发布清单 → `"01.0.3"` 被报成「落后 9 版」。
   改为逐段 `/^(0|[1-9]\d*)$/`；单个 `0` 仍合法。
2. **F003 规格错**（两家共识）：「未知」实为两种状态，且原方案给的 `adopt` 命令在
   `harness.lock` 存在时会被拒 —— 跑不通的建议。拆成 无账本→`adopt` / 有账本但基准未知→重建账本。
3. **F002 规格自相矛盾**：描述与验收标准打架，两家因此得出相反结论。裁决为
   **改规格不改实现**（判断逻辑留在唯一消费者组件内）。
4. **F004**：补「三段全数字但前导零」分支用例。

## L1 与沙箱

`tsc --noEmit` exit 0 · `npm run test` 405 passed / 4 skipped（0 failed）。
两轮四次派活，沙箱事后核查：主仓零污染 · 日志中真实凭据零命中 · 外部实例无 push ·
一次性 worktree 用后清理。

**待人类批准 `reverifying → done`。**
