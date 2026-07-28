# BL-HARNESS-DETAIL-MODEINTENT 修复轮验收签署

**批次：** Harness 项目下钻、模式意图与 dispatch 历史  
**修复轮：** 1  
**车道：** Generator=`builder-codex`（Codex/local-cli）· Evaluator=`reviewer-kimi`（Kimi/local-cli fallback）  
**结论：** F001-F006 全部 PASS；保持 `reverifying`，等待人工批准 `done` 阶段门

## 首轮撤回与修复

首轮 signoff 后，真实 `npm run cli -- harness` 发现 tokenizer 上报被 `sensitive_summary_data` 拒绝：
合法 F001 feature title 中的精确 Harness 命令 `/plan` 被 POSIX 绝对路径规则误判，导致 report 与 phase gate
无法进入控制台。首轮签核已在原文件中标记撤回，原 verdict 保留为审计，不作为本轮批准依据。

修复提交 `41b64dd` 只在 `feature.title` 标签下剥离精确的 `/plan`、`/build`、`/verify`、
`/dashboard`、`/autodrive` 后再执行路径扫描。原始文本仍参与 raw-channel 与 credential 规则；
`/plan/private`、`/plan.txt`、`/plan-private`、未知命令、POSIX/Windows/UNC/file 路径、换行、凭据，
以及 strict `errorSummary`、`verdict`、mode issue 中的 `/plan` 继续拒绝。

r1b 举起真实 gate 后又发现 device 把本地 gate 连同 `decision:null` 原样发送，服务端按未知字段拒绝。
提交 `4aa801f` 将上报显式投影为服务端允许的 9 个字段；`decision` 与任意本地扩展字段不会离开设备，
非空 decision 仍让 gate 整体不再上报。

## 独立验收与 dispatch

- Generator fix task 锁定 `86a076d5c57a`，928 秒返回 handoff；集成产品提交为 `41b64dd`。
- 修复轮 Kimi A2A task 锁定 `697d4a4de949`，但 runner/watchdog 越过 envelope 与 registry 超时后仍停在
  `WORKING`；该轮被终止，未接收 artifact，并作为 dispatch 传输层缺陷记录。
- 同一 Kimi 经直接 local-cli fallback 锁定 `697d4a4de9498f34db5b42bad31850add68cc21c`，794 秒
  正常返回 `COMPLETED` receipt；verdict schema 合法，F003/F006 均 `PASS`，`waiting=null`。
- Kimi 独立重跑 2 files、90/90 tests 与目标 eslint，并执行 22/22 额外对抗输入探测。
- 最终 Kimi r1c 经 local-cli 锁定 `4aa801f34b427c7cc6e87d8a85bb2f931722de7f`，412 秒返回；
  receipt/verdict schema 合法，独立重跑 31/31 聚焦测试与目标 eslint，F004/F006 均 `PASS`。
- 原样 verdict：`docs/test-reports/BL-HARNESS-DETAIL-MODEINTENT-verdict-r1b.json`、
  `docs/test-reports/BL-HARNESS-DETAIL-MODEINTENT-verdict-r1c.json`。

## 主流程验证

| 检查 | 结果 |
|---|---|
| 聚焦修复测试 | r1b 90/90；最终 gate 投影 31/31，0 failed |
| `npm run test -- --no-cache` | 49 files，619 passed，4 skipped，0 failed |
| targeted eslint / `npm run verify` | 通过 |
| `npm run build` | Next.js 生产构建通过 |
| CI / deploy | GitHub Actions run `30326679863`：Linux、Windows、VPS Deploy 全部成功 |
| 最终部署后真实上报 | `Reported: 6`；tokenizer 不在 skip 列表，gate 已同步 |

修复轮没有触碰 UI。首轮生产模式 Playwright 证据继续适用：桌面 `1440x1000`、移动端 `390x844`，
覆盖整卡下钻、三个视图、四种意图状态、POST 201、DELETE 200；9 个页面状态无横向溢出，
console/page errors 均为 0。截图保留在同批次 desktop/mobile 报告文件中。

## 状态与边界

F001-F006 已完成，控制台只签发模式意图；当前批次不会即时切换，签名 defaults 仍只在下一次 `/plan`
新批次边界消费。dispatch 摘要继续以脱敏结构持久化，不保存 prompt、stdout/stderr、环境变量、源码、
凭据、签名载荷或本机绝对路径。

已举起 `reverifying -> done` 的 `phase_advance` 人工闸门，`decision=null`。任何 agent 都不得代替人类批准。
A2A runner 的 deadline/watchdog 不收束问题不影响本批产品验收，但应在后续 harness 基础设施批次单独修复。
