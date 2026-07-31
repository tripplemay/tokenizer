# BL-HARNESS-REPORT-COMPAT Signoff 2026-07-30

> 状态：Evaluator 全部 PASS，人工闸门已批准并消费，`progress.json status=done`
> 锁定 SHA：`9974815f00c2a190440f06e90fdd5300dc8d3fe1`
> 生产部署 SHA：`100b1479854ef4a06fefd108cbd3dc20cecea761`

## 变更范围

- F001：无 remote 本地仓库改用稳定的 `local:sha256:<digest>` opaque repoKey，报告不再包含绝对路径。
- F002：保留合法 Harness 命令、API route 与文字斜杠；在 title slash 掩码前拒绝 forward-slash UNC 形状。
- F003：report route 在 Prisma 调用前拒绝敏感 title，且错误响应不回显原始输入。
- F004：`reviewer-kimi-a2a` 以 fresh context 独立验收全部改动。

本批不改 Prisma schema、UI、i18n、framework 或 agent feature version。

## 独立验收

`reviewer-kimi-a2a` 在锁定 SHA 上返回 schema-valid verdict，F001-F004 全部 PASS，
`waiting=null`。原始结论见
`docs/test-reports/BL-HARNESS-REPORT-COMPAT-verdict.json`。

| 检查 | 结果 |
|---|---|
| 聚焦回归 | PASS，3 files / 141 tests |
| 全量 `npm test` | PASS，53 files / 695 passed / 4 skipped |
| `npm run verify` | PASS（Prisma generate + TypeScript） |
| `npm run lint` | PASS，0 error / 0 warning |
| `npm run build` | PASS |
| 临时 HOME fixture | PASS，remote/local key 稳定且无绝对路径泄漏 |
| 真实 Harness 项目扫描 | PASS，9 项目 / 84 标题 / 0 rejection |

验收复现了首轮发现的 `//server/share`、`//api/x` 与嵌入式
`//host/share` 绕过，并确认其已在 Prisma 前 fail-closed；四个真实合法斜杠标题
仍可通过。

## 人工闸门

`tripplezhou@gmail.com` 于 `2026-07-31T03:30:28.901Z` 一次性批准
`BL-HARNESS-REPORT-COMPAT-verifying-done-w1`。中继提交 `4344a18` 的 Ed25519
签名已验证，批准已于 `2026-07-31T03:32:00Z` 消费，`pending_gate=null`。
该批准只完成状态机；生产操作来自随后用户对“提交推送部署”的单独明确授权。

## 生产发布

- `main` 已推送并由 GitHub Actions `Deploy VPS` run `30601984523` 发布目标 SHA。
- Linux Verify、Windows Verify 与 Deploy 均成功。
- VPS 检出目标 commit，`prisma migrate deploy` 检查到 19 个迁移且无待执行迁移；
  PostgreSQL healthy，应用容器启动，并通过内部 `/api/health` 检查。
- 公开健康接口在 `2026-07-31T03:43:04Z` 回报
  `commit=100b1479854ef4a06fefd108cbd3dc20cecea761`。
