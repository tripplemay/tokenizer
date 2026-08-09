# BL-AGENT-SUPPLY-CHAIN 落地方案

> 依据：reader-cliagent.md 短板 2/3/4、roadmap.md 中期表；以下引用的文件路径均已实地打开核对（行号可能随后续提交微移）。

## 目标

把本机 agent 的「装—升—卸—凭据」四条生命周期链路从"尽力而为"升级为"可校验、可回退、可清干净"：

1. 安装/升级从追 `origin/main` HEAD（public/install.sh:231-237、public/install.ps1:158-164）改为锁定发布账本末项对应的 tag + commit SHA 校验；
2. 建立 agent 发布 tag 规范（当前仓库 **0 个 tag**，已用 `git tag | wc -l` 实测确认），与产品部署（push main 即部署、无 tag）解耦；
3. `uninstall-service --purge` 完整卸载（现状 src/cli/service.ts:171-194 只删 plist/unit/crontab，不清 `~/.tokenizer` 数据、app checkout、软链、凭据）；
4. 凭据轮换给出可执行的手动 SOP（服务端吊销机制已存在：app/api/devices/enroll/route.ts:67-84 re-enroll 时 revoke 全部旧 token），API 化留给后续批次；
5. 顺带修复既有 Windows CI `install-agent-lifecycle` 失败（.auto-memory/project-status.md「已知边界」记载的遗留问题）。

## 范围（In / Out）

**In：**
- 发布账本 `src/shared/agent-releases.json` 增加 commit 锚点 + 只读发布清单端点 + 两步发布法 runbook 与脚本
- install.sh / install.ps1 双端锁版 + SHA 校验 + 旧服务端回退路径
- `uninstall-service --purge`（POSIX 全清；Windows EBUSY 容忍）
- 凭据轮换手动路径文档化 + `tokenizer status` 显示 token 前缀（本地可见性，不动协议）
- Windows CI 既有失败修复（test-only，判断见 F006）

**Out（刻意不做）：**
- **凭据轮换 API 化**（`POST /api/devices/rotate-token` 之类）：新增 agent↔服务端协议面，且"被盗 token 可自轮换锁死合法设备"需要独立威胁建模 → 留给未来 BL-CRED-ROTATE-API（本方案给出取舍，见「风险与对策」6）
- **tarball sha256 / 签名产物**：agent 以 tsx 源码运行、无构建产物，GitHub 自动生成源码压缩包无字节稳定性承诺（2023-01 git archive 变更事故先例），commit SHA 本身即内容寻址，`package-lock.json` 的 registry integrity 哈希覆盖依赖链 → tag + SHA pin 等效且零额外流水线；未来若出现预构建产物再上 Release asset + sha256（远期）
- **agent 自更新通道**（daemon 自拉新版）：升级仍 = 重跑 install.sh；锁版是它的前置
- **凭据加密存储**（keychain/DPAPI）：形态改造独立成批，本批只保留既有 0600/icacls 尽力收紧（src/cli/config.ts:115-123、src/cli/file-permissions.ts）
- cron 双条目 / 轮询退避：属 BL-AGENT-LATENCY（roadmap 近期）

## Features 预案

**F001 · 发布账本 commit 锚点 + 发布清单端点 + 两步发布法 runbook/脚本 · executor: generator**
涉及：`src/shared/agent-releases.json`（追加 1.3.0 条目，各条目可选 `commit` 字段）、`src/shared/agent-release-version.ts`（暴露 pin 读取，既有解析不动）、`app/api/agent/releases/route.ts`（新）、`scripts/release-agent.sh`（新）、`docs/agent-release-runbook.md`（新）、`tests/shared/agent-release-version.test.ts`、`tests/server/agent-releases-route.test.ts`（新）
acceptance：
1. GET `/api/agent/releases` 返回 200，`latest.version` 等于账本末项，且回填后 `latest.commit` 为 40 位 hex
2. 旧条目（1.0.0–1.2.1）无 `commit` 字段时 `agentReleaseStanding` 行为不变：`npx vitest run tests/shared/` 全绿
3. `scripts/release-agent.sh --dry-run` 打印两步发布计划（tag `agent/v<semver>` → 回填 commit）且 `git status` 零写入
4. runbook 明确 tag 命名空间 `agent/v*` 与产品部署解耦、两步发布顺序、以及"tag 指向发布 commit、锚点在回填 commit 中"的自引用规避约定
5. `npx vitest run tests/server/agent-releases-route.test.ts` 全绿

**F002 · install.sh 锁版安装 + SHA 校验 · executor: generator**
涉及：`public/install.sh`（231-237 段改造：fetch `${SERVER_URL}/api/agent/releases` → checkout 锚点 commit → `git rev-parse HEAD` 比对，不一致 exit 1；端点 404/无锚点 → 回退 `origin/main` + WARN；`TOKENIZER_REF` env 逃生口）、`tests/cli/install-agent-lifecycle.test.ts`（字符串断言同步）
acceptance：
1. `bash -n public/install.sh` 通过
2. 本地 fixture 仓 + mock manifest 演练：装完 `git -C ~/.tokenizer/app rev-parse HEAD` == manifest commit
3. 篡改场景（tag 被移走、manifest commit 与实际不符）安装以非 0 退出且不执行 install-service
4. manifest 不可达时回退安装成功且输出含 WARN（grep 断言）
5. `npx vitest run tests/cli/install-agent-lifecycle.test.ts` POSIX 全绿

**F003 · install.ps1 同等锁版 · executor: generator**
涉及：`public/install.ps1`（158-164 checkout 段同构改造；`-Branch`/`TOKENIZER_BRANCH` 保留为测试逃生口，走该口时 WARN 并跳过 pin）
acceptance：
1. CI `Validate install.ps1 syntax` step（deploy-vps.yml:98-108 的 Parser::ParseFile）零 error
2. 新增跨平台源码断言测试：默认路径含 manifest fetch 与 rev-parse 比对、逃生口路径含 WARN（纯读文件断言，任意平台可跑）
3. 双installer 的 manifest URL、校验失败退出语义一致（同一断言文件覆盖两端）

**F004 · uninstall-service --purge · executor: generator**
涉及：`src/cli/service.ts`（171-194 扩展）、`src/cli/service-windows.ts`（237-249 扩展）、`src/cli/index.ts`（81-83 加 option）、`tests/cli/uninstall-purge.test.ts`（新）
行为：先跑既有卸载，再删 `~/.tokenizer/`（credentials/config/device/queue.jsonl/state.json/logs/agent.lock/app）与 `~/.local/bin/tokenizer` 软链；Windows 另清 `~/.tokenizer/bin` shim 与用户 PATH 项（install.ps1:135-143 写入的），app checkout 因进程 cwd 占用（bin/tokenizer:6-13 强制 cwd=app 根）删不掉时容忍 EBUSY 并打印手工指令；破坏性操作需 `--yes` 或 TTY 确认；输出提示"本地凭据已删，服务端 deviceToken 仍有效，吊销 = dashboard 重发 enrollment token 后 `--force-enroll` 重enroll"（enroll/route.ts:67-72 语义）
acceptance：
1. HOME 沙箱演练：purge 后 `~/.tokenizer` 与 `~/.local/bin/tokenizer` 不存在（路径常量在 config.ts:25-29 为模块加载期求值，测试需子进程注入 HOME——既有测试是否已有此模式：未核，实现时对齐）
2. 非 TTY 且无 `--yes` 时拒绝并非 0 退出
3. 不带 `--purge` 时行为与现状逐字一致（既有 service-windows.test.ts 等全绿）
4. `npx vitest run tests/cli/uninstall-purge.test.ts` 全绿

**F005 · 凭据轮换手动 SOP 文档 + status 可见性 · executor: generator**
涉及：`docs/credential-rotation.md`（新，可并入 runbook）、`src/cli/index.ts`（89-95 status 增打 token 前缀 8-12 位 + credentials 文件 mtime）
取舍结论：**先文档化，不 API 化**——服务端吊销机制已完整（re-enroll 事务内 revoke 全部旧 token），缺的只是操作者知识；API 化触协议红线且需独立安全设计。
acceptance：
1. `tokenizer status` 输出含 `dtok_` 前缀片段且断言完整 token 绝不出现在 stdout
2. 文档含端到端 SOP：dashboard 生成 enrollment token → `install.sh --force-enroll --enroll-token X`（install.sh:137-159 已支持）或 `tokenizer enroll` → 验证旧 token 401
3. 服务端旧 token 失效有测试背书：`tests/server/device-enroll.test.ts` 扩展（或新增）"re-enroll 后旧 token 鉴权 401"用例并全绿

**F006 · Windows CI install-agent-lifecycle 修复 · executor: generator（test-only）**
判断：**IN**。理由：a) F002 本就要改同一测试文件；b) 该失败使每次 push 的 workflow conclusion 恒为 failure（project-status.md 记载），掩盖真回归；c) 修复不动产品代码。
涉及：`tests/cli/install-agent-lifecycle.test.ts`——首个用例（spawn bash + `ps -p -o command=`，74-108 行）加 `it.skipIf(process.platform === "win32")`；第二个用例（110-117 行，纯源码字符串断言）保留跨平台执行
acceptance：
1. verify-windows job 全绿（推送后 Actions 实测）
2. POSIX 上两用例仍实际执行非 skip（verbose reporter 无 skipped）
3. deploy job 的 gating 关系不变（deploy-vps.yml:118 `needs: verify` 不含 windows，零改动）

**F007 · 供应链端到端演练报告 · executor: evaluator**
涉及：`docs/test-reports/BL-AGENT-SUPPLY-CHAIN-e2e.md`（新）
acceptance：
1. 五场景各附命令与原样输出：锁版安装 rev-parse 一致；篡改拒装 exit≠0；旧服务端回退 WARN；purge 后 `find ~/.tokenizer` 为空；轮换后旧 token 请求 401
2. 报告落 `docs/test-reports/`（paths-ignore 内，不触发部署）
3. 逐场景 PASS/FAIL 明示，结论原样落盘

## 数据模型 / migration

**无。** Prisma 零变更（Device/DeviceToken/EnrollmentToken 现有结构已够用）。

## API 与协议影响

- **新增**：GET `/api/agent/releases`（公开只读，installer 消费）。这是 installer↔服务端的新面，**不是** agent 心跳/上报协议——heartbeat、report、decisions、mode-intents relay、events batch 全部零改动，9 个消费者项目共用的运输层不受影响。
- **AGENT_FEATURE_VERSION：不 bump**（维持 9/9，src/shared/agent-feature-version.ts:50-51）。理由：无 heartbeat/report schema 变化，服务端不需要按能力拒绝旧 agent；`--purge` 与 status 前缀是纯本地 CLI 能力。
- **agent release：bump 至 1.3.0**（账本追加条目，`agent_feature_version` 保持 9）。副作用：既有设备全部转 `behind` → 首页升级提示（src/server/agent-version.ts:59-61 既定行为，属预期）。本批次即第一个 tag 锁版发布 `agent/v1.3.0`。
- **部署触发**：本批次 src/、app/、public/、tests/、scripts/、docs/ 根的改动全在 paths-ignore 之外，**每次 push main 即部署生产**。且 install.sh/install.ps1 经部署后才对用户生效（src/server/agent-version.ts:8-15 的分发 URL 指向生产）。建议 building 期 feature commit 本地累积、分 2-3 次合并推送（如 F001-F003、F004-F006），每次推送后核对 `/api/health`；服务端改动全部 additive，回滚 = revert 再 push。
- **发布次序约束（防自引用）**：tag `agent/v1.3.0` 指向发布 commit A（账本含 1.3.0 条目、无 commit 锚点）；随后 commit B 回填锚点并 push 部署。装在 A 的 agent 只读 version 上报（agent-release-version.ts:27-30），不受 B 影响。

## 测试计划

| 文件 | 新/改 | 关键用例 |
|---|---|---|
| tests/shared/agent-release-version.test.ts | 改 | commit 锚点可选字段解析；无锚点旧条目 standings 不变 |
| tests/server/agent-releases-route.test.ts | 新 | 200/结构/latest 一致性；无鉴权可达 |
| tests/cli/install-agent-lifecycle.test.ts | 改 | 锁版逻辑字符串断言；win32 skipIf；POSIX 进程编排用例保留 |
| tests/cli/uninstall-purge.test.ts | 新 | HOME 沙箱全清；非 TTY 拒绝；无 --purge 行为不变 |
| tests/server/device-enroll.test.ts | 改 | re-enroll 后旧 token 401 |
| （新）installer 双端一致性断言 | 新 | install.sh/install.ps1 的 manifest URL 与失败语义成对断言 |
| docs/test-reports/BL-AGENT-SUPPLY-CHAIN-e2e.md | 新 | F007 五场景实测记录 |

## 依赖与前置

- **前置批次：无硬依赖**。roadmap 中期项，与 BL-DEVICE-DECOUPLE / BL-LIVE-SESSION 零耦合，可独立启动。
- **被依赖**：自主/无人值守模式的 agent 侧可信度、未来 BL-CRED-ROTATE-API、任何"agent 自动升级通道"设想均以锁版发布账本为前提。
- **流程沉淀**：runbook 落地后，后续每个含 agent 变更的批次在 done 阶段须按两步发布法打 tag——建议按框架提案规则追加到 `framework/proposed-learnings.md` 待用户确认，不直接改 framework/。

## 风险与对策

1. **发布锚点自引用死锁**：commit 锚点不能指向包含它自己的 commit → 两步发布法（tag→回填），agent 端只消费 version、installer 端只经服务端 manifest 消费锚点，两侧互不依赖对方缺的字段。
2. **降级路径被滥用**：manifest 404 回退 origin/main 可被中间人强制触发 → install.sh 本身与 manifest 同源同 TLS（token.vpanel.cc），信任锚一致，不新增假设；回退必 WARN，F007 实测验证。
3. **tag 可被移动**（仓库写权限者）：SHA 比对兜底——tag 只是人类可读入口，校验对象是 commit SHA。
4. **purge 自删**：进程 cwd 在被删目录内（bin/tokenizer:6-13）——POSIX inode 语义安全；Windows EBUSY 容忍 + 手工指令，acceptance 按平台分档。
5. **每 push 即部署**：合并推送策略 + 部署后 health 检查；本批服务端面全 additive。
6. **轮换 API 化的诱惑**：本批坚决不做——静态 token 自轮换端点会把"token 被盗"升级为"设备被锁死"，需要 grace window / 审计 / 二因子式设计，独立成批（BL-CRED-ROTATE-API 建议进 backlog）。
7. **未核事项**（如实标注）：dashboard 是否已有设备/token 吊销 UI（未核，F004/F005 文案按 re-enroll 吊销语义写，该语义已有代码背书）；tests/cli 既有 HOME 注入模式（未核，实现时对齐）；verify-windows 失败的具体报错行（未核，依据 project-status.md 记载 + 测试源码 POSIX 依赖推断）。

## 规模估计

**M** · 7 features（6 generator + 1 evaluator，混合批次：planning → building → verifying）· 主要涉及文件约 16 个（src/cli 3、src/shared 2、app/api 1 新、public 2、scripts 1 新、docs 2 新、tests 5±）。F001→F002/F003 有先后序（端点先行），F004/F005/F006 可并行；单人一个批次周期内可完成。