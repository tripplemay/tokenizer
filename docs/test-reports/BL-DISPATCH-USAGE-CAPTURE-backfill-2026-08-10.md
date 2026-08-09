# BL-DISPATCH-USAGE-CAPTURE F004 回填与端到端实证报告

- 日期：2026-08-09 17:45 UTC · 执行者：主上下文 Generator（快车道）
- 生产：Deploy success @ 0d4deca（Linux Verify 绿；Windows 为既知存量红）；health 200

## 回填（机械证据）

用框架 v1.9.0 的 `extract-run-usage.py --into` 对本机 6 个历史 run-meta 补写 usage：

| run | adapter | input_tokens | 判定 |
|---|---|---|---|
| build-f6b8cea300c5（F003 首派，回执假阴性但真实烧钱） | codex | 2,150,425 | materialize |
| build-001ecd9ae461（F003 重派） | codex | 1,634,158 | materialize |
| build-356e6fdaa596（F002） | codex | 4,017,045 | materialize |
| build-c0b11e94f6d4（F005） | codex | 1,736,673 | materialize |
| BL-REPO-MECH-verify（Kimi） | kimi | null | attribution_only（wire 已被 kimicode 采集器正常收集，防双重计费） |
| BL-REPO-MECH-reverify（Kimi） | kimi | null | attribution_only |

codex 四项数值与 run 日志 `turn.completed` 逐字一致（提取器实跑输出留存于会话记录）。
**codex 派发合计：input 9,538,301 / output 81,488 / reasoning 32,056 tokens。**

## 上行（机械证据）

- 本机 agent 重装至 1.3.0（app checkout 0d4deca；install.sh 首跑未推进 checkout、手动 fetch+checkout 完成——
  该行为已记入观察，归 BL-AGENT-SUPPLY-CHAIN 整改面）
- `tokenizer harness` 两轮：Reported 9 / Failed 0（第二轮验证请求侧可重放；服务端幂等键 dispatch:<taskId> + update:{} 由
  tests/server/harness-dispatch-usage.test.ts 的 10 用例钉住）

## 待人类目视闭环（acceptance ①②）

/events 应出现 4 条 source=codex 的派发事件（input 如上表；model 为空——codex 日志无 model 行，如实 unpriced）；
kimi 零新增事件（详情页 Activity 的 dispatch 表 tokens 列对 kimi 行显示「仅归因」）。

## 终局确认（2026-08-09T18:05:58Z）

- **用户目视确认：/events 出现 4 条 source=codex 派发事件，数值与上表一致。**
- 「模型显示未知」原因（fix_round=1 修正，原表述被 F004 复验证伪）：codex 运行日志无 model 行**属实**，
  但本机 codex.json 定制自 e59c822（2026-08-07）起 argv 已含 `-c model=gpt-5.6-sol`（早于四次派发）——
  模型身份在本机产物中**可知**。事件 model=null 的真实原因：`extract-run-usage.py` 未实现 spec 决策 3
  的「adapter argv 声明」兜底档（只读日志）。该缺口连同已物化 4 事件的 model 补写（物化 create-only）
  已按修正后前提登记 backlog BL-DISPATCH-MODEL-PIN。
- 排查中挖出并修复两层链路断点（均有回归用例钉死）：
  1. dispatch 扫描的批次白名单在批次切换后丢弃全部历史 run——用量随批次结束即丢失；
  2. readRegistry 只认 dispatch/1 旧格式——注册表迁 tool-integrations/1（5bd8c52，2026-07-31） 后
     **dispatch 镜像静默断链至今**（Activity 显示的均为迁移前旧行），本批顺带修复恢复。
