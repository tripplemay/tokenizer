# B01 CI 基础设施实现交接（Generator，非验收）

- 基线：`2074991717abaf3cb34d9aad894bcd4357fefbc3`。
- 范围：`.github/workflows/`、`scripts/ci/`、锁文件中的 Playwright、浏览器/跨平台测试；无产品运行时代码、数据库迁移或状态机改动。
- 位置：独立 detached worktree `tokenizer-b01-ci-foundation-20261007`。未提交、未推送、未部署；`progress.json` 仍为 `verifying`，F005 仍为 `pending`。
- 第一轮独立 Evaluator 在另一 worktree 的 `docs/test-reports/b01-ci-foundation-20261007/evaluator-verdict.json` 判 `FAIL/BLOCK_DEPLOY`：Windows 未阻断部署、登录态浏览器门禁缺席。以下是对这两项的第二轮整改，不是自我签收。

## 改动

1. Linux 与 Windows job 均只用 Node 22 + `npm ci` 的锁文件版本，不再在安装后临时安装 Vitest/Coverage。Linux 增加 lint；原有 verify/test/build 保留。
2. 新增 PostgreSQL 16（与 Compose 主版本一致）service job。先执行全部 28 个迁移，再显式运行五个 DB probe 文件；JSON 结果断言测试数不少于 10、零 skip、零失败。当前单一 push-main 发布路径的 Deploy 必须同时等待 Linux、Windows、DB、browser 四项；任一失败均不部署。
3. 对协议相关改动，Deploy 的 verify job 获取 `harness.json` 锁定的框架 fixtures 并运行双向 contract 6 个测试，零 skip 才放行。独立 Contract Conformance workflow 也支持 PR，统一 Node 22 和零 skip 检查。
4. 修复 Windows CI 中被证实的 POSIX 测试误跑：`install.sh` 的实际进程生命周期只在 POSIX 执行，静态安全断言在 Windows 仍执行并规范化 CRLF；Agent POSIX `SIGTERM` 清锁测试只在 POSIX 执行，Windows 改测强制终止后的真实锁回收。测试 fixture 同时设置 `HOME` / `USERPROFILE`，并延长实际启动所需的测试超时。未跳过 Windows service 套件的四个原生测试。
5. 新增 `verify-browser`：独立 PG16 service、全量迁移、生产 Next build、锁定 `@playwright/test@1.63.0` 的 Chromium。通过带本地数据库 guard 的合成 User/Session 种子验证匿名重定向、历史账户 7d 空窗与 all-time 返回、首次生成 enrollment token -> claim -> 上传一条 usage -> 不调用 reload 自动进入看板。失败保留 screenshot、trace、JUnit 和浏览器错误附件。配置载入时及种子写入前双重拒绝非环回 app/非 `tokenizer_e2e*` 数据库；不配置真实发信 provider。`.gitignore` 排除临时 `test-results/` 和 `.ci/`。

## 本地实现检查

环境：macOS arm64、Node `22.22.0`、npm lockfile、隔离 PostgreSQL `16`；非 GitHub Windows runner。

| 检查 | 观察结果 |
| --- | --- |
| 干净 `npm ci` | 成功，锁定 Vitest `2.1.9`；依赖审计提示 28 项漏洞，属于 B02 范围，未自动 `audit fix` |
| `actionlint`、`git diff --check` | 通过 |
| `npm run lint`、`npm run verify`、`npm run build` | 通过 |
| `npm run test` | 1453 passed、21 skipped；默认未配置 PG/fixtures，故 skip 不作为 DB/contract 验收 |
| 隔离 PG16 `prisma migrate deploy` | 28/28 migrations applied |
| 显式 DB probe job 命令 | 48 passed、0 skipped；包含前述 10 个真实 DB 用例，结果见 `evidence/db-probes.json` |
| 本地锁定框架 commit `027c369dcf94d3eb891d1e5243d44d82964ca276` 的 contract | 6 passed、0 skipped，结果见 `evidence/contract-results.json` |
| B01 Playwright 套件针对 B10 修复候选 `f5f3718` 的生产 Next server | 3 passed、0 failed，首次上传自动刷新约 62 秒；见 `evidence/b10-browser-results.xml` |
| B01 Playwright 套件针对未修基线的历史空窗用例 | 如预期失败，15 秒内找不到“所选时间范围内暂无用量”；截图见 `evidence/baseline-historical-negative/test-failed-1.png` |
| Playwright 自管理 `webServer` | 对未修基线的匿名重定向路径 1 passed；证明 CI 使用的启动配置可工作，不证明另外两条在基线通过 |

证据 SHA-256：`db-probes.json` = `4ddeb9d2173f52f4a5563e7ce007bed898bc5dceb7661d7eebe0045f156fb7a1`；`contract-results.json` = `b4ccbf2deba81ad1e09d49d96045bff8875249c493c65e4932d796cdb295caa6`。
浏览器证据 SHA-256：`b10-browser-results.xml` = `8a0672027d07a0bbd37ed83949b46ea1c79b6586438e9abfbfd9a54a56c67e9e`；基线负向截图 = `1cc3670a731fd027b06817ff1e2c4c69c7ea8d9c632d1c84f2d667a96418da49`。本地 trace 含合成 session cookie，未归档到仓库；GitHub 的失败 trace 仅作为短期 CI artifact 留存。

`https://github.com/tripplemay/harness-template.git` 本次临时 clone 遇到 SSL EOF；本地 contract 实跑使用已经处于该精确 commit 的关联工作区 `/Volumes/ORICO/project/harness-template/contract-fixtures`。因此验证的是测试和锁定 fixture 契约，不等于本次 GitHub clone 路径也已实跑通过。

浏览器本地隔离库为 `/tmp/tokenizer-b01-e2e-pg-eyyBlN/data`、`127.0.0.1:55619`、`tokenizer_e2e_local`，现已停止。用 Homebrew PG16 的 `initdb -D .../data -U tokenizer_e2e --auth=trust`、`pg_ctl -D .../data -o '-p 55619 -c listen_addresses=127.0.0.1 -c timezone=UTC' start`、`createdb -h 127.0.0.1 -p 55619 -U tokenizer_e2e tokenizer_e2e_local` 建库，再用相同 `DATABASE_URL` 执行 `npm run prisma:deploy`。浏览器正向测试在 B10 worktree 的 server 上运行，B01 测试进程设置 `CI_E2E_EXTERNAL_SERVER=1`；CI 自身不设置该开关，由 Playwright 启动当前 checkout 的 server。

## 仍需独立验收/后续工作

- fresh-context Evaluator 在隔离工作区审查差异，特别检查 GitHub `push` / PR diff 判定、fixture clone、PG service、Windows 进程/锁测试；不可用本报告代替验收。
- 通过独立 CI run 证明 Windows Node 22 的实际四个 service 测试及新锁回收测试通过；本机 macOS 不能宣称 Windows PASS。
- **集成前置：** 本 B01 候选仍是 `2074991` 的旧首页，新增浏览器门禁会对 FR-001/007 正确失败；必须将已实现的 B10 修复 `f5f3718` 与本 CI 差异共同集成，随后由独立 Evaluator 在集成 SHA 上重跑全套 browser/PG/Windows。不能把“B10 服务上的 3/3”写成 B01 当前 checkout 的发布通过。
- 合成 DB session 只验证登录态路由，不验证 Resend 真正邮件送达；Mac Chromium 不代表 Linux CI 或 Windows 浏览器已通过。失败截图与 trace 已由配置收集，但 GitHub artifact 上传尚需真实 run 验证。
- CI 绿灯仍不证明生产部署、真实邮件、备份恢复、Agent 安装或 F005 人工/独立验收。发布前由编排者按既定状态机与人闸门处理；本工作区不得自行推送。
