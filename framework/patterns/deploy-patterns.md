# Deploy Patterns（框架沉淀）

> 跨批次通用的生产部署 / 运行时进程管理 / 反向代理模式。Planner 在写涉及 deploy / PM2 / process management / nginx 的 spec 时必读。

---

## 1. PM2 cluster zero-downtime reload 的 3 个必要条件

### 1.1 坑

`pm2 reload` 做到"零丢包"**不是** "cluster mode + instances ≥ 2" 自动拥有的能力。常见的错误假设（BI2 Planner v1 犯过）：

> "PM2 cluster 会 hijack `listen` 调用，let master 代为分发端口；两个 instance 滚动替换即 zero-downtime。"

这只在"worker 进程是 PM2 的直接子进程 + app 主动发 ready 信号"时成立。KOLMatrix BI2-F002 两轮实测证伪该假设：

- **Round A**: `script: "npm", args: "start"` + `instances: 2` → `npm` 是 PM2 直接子进程，但 `npm` 再 spawn 孙子 `next`；`cluster` 模块只 hook 直接子进程的 `listen()`，孙子 `server.listen(3001)` 直接走 OS 端口 → **EADDRINUSE crash loop 116×**
- **Round A'**: `script: "node_modules/next/dist/bin/next"` 直连 + `instances: 2`（绕过 npm 双层进程）→ cluster hook 生效，两 worker 稳定，但 **60× curl + reload 只有 56/60 = 93%**（4× 超时），原因：没有 `process.send('ready')` 信号，PM2 走 `listen_timeout` 默认 3s 估算，new/old worker 切换窗口重叠 2-3s

### 1.2 真正 zero-downtime 的 3 个必要条件

**条件 1 — worker 是 PM2 直接子进程：**

不能用 `npm start` / `yarn start` / shell wrapper 脚本。PM2 fork/spawn 出来的**第一层**进程必须就是 app 进程。

**条件 2 — app 主动发 `process.send('ready')` 信号：**

在 `server.listen(port, callback)` 的 callback 里发 ready。PM2 靠这个信号精确感知"新 worker 已 accept 连接"，才去 SIGTERM 老 worker。没有此信号，PM2 只能用 `listen_timeout` 做超时估算，切换窗口重叠。

**条件 3 — `ecosystem.config.js` 配 `wait_ready: true` + 合理 `listen_timeout`：**

```js
{
  name: 'app',
  script: 'server.js',        // 条件 1：直接 JS 入口
  exec_mode: 'cluster',
  instances: 2,
  wait_ready: true,            // 条件 3：告诉 PM2 必须等 ready 信号
  listen_timeout: 10000,       // 10s 上限，Next cold start ~450ms 绰绰有余
  kill_timeout: 5000,          // SIGTERM 后给 drain in-flight 请求 5s
}
```

### 1.3 Next.js 生产部署的唯一可靠路径

对 Next.js `production build`，**唯一**同时满足 3 个条件的方式是 custom `server.js`：

```js
// server.js (~22 行)
const { createServer } = require("node:http");
const next = require("next");

const port = Number(process.env.PORT) || 3001;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));
  server.listen(port, hostname, () => {
    console.log(`[server] listening on ${hostname}:${port}`);
    if (process.send) {
      process.send("ready");   // ← 条件 2：ready 信号
    }
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      console.log(`[server] ${sig} received, closing connections`);
      server.close(() => process.exit(0));
    });
  }
});
```

该方式不失去任何 Next.js 特性（middleware / instrumentation.ts / app router / React 19 / server actions 全兼容）。丢失的只有 Turbopack dev 优化（dev 不用 server.js，跑 `next dev`）。

### 1.4 Planner spec 起草期检查清单

涉及 PM2 deploy 的 spec（BI2 F002 / BI3 F003 staging / B5+ worker 进程等），Planner **必须**核对：

- [ ] `script:` 是否指向**可执行 JS 文件**（非 `npm` / `yarn` / shell wrapper）？
- [ ] app 代码里是否有 `if (process.send) process.send('ready')`？（custom server 或 instrumentation.ts）
- [ ] `ecosystem.config.js` 是否配 `wait_ready: true`？
- [ ] `listen_timeout` 是否与 app 实际冷启动时间匹配（prod Next.js ~500ms，设 10s 有余量）？
- [ ] `kill_timeout` 是否足够 drain in-flight 请求（Next.js SSR 默认 1.6s 短，改 5s）？
- [ ] Acceptance 写"reload 0 掉包"时，是否附"60× curl 叠加 reload + 两 worker uptime 交错"两条可证伪指标？

### 1.5 反面案例（BI2 Planner v1 路径，已作废）

| 假设 | 结果 |
|---|---|
| `npm start` + cluster + instances=2 自动 zero-downtime | EADDRINUSE crash loop |
| `next` 直连 + cluster + instances=2（无 wait_ready）自动 zero-downtime | 93%（2-3s 窗口丢包） |
| fork mode + `increment_var: PORT` + nginx upstream | 架构更散，仍需 wait_ready，nginx 成状态依赖，不推荐 |

### 1.6 PM2 6.0.14 `env_file` 不可靠 anti-pattern

KOLMatrix B5 fixing-4 暴露：

- `ecosystem.config.js` 用 `env_file: /opt/<app>/.env.<env>` 字段
- 初次部署时 PM2 daemon 把 shell 环境变量（`source .env` 之后）作快照锁住
- **多次 `pm2 reload --update-env` / `pm2 restart --update-env` 后 env_file 不重读** —— 新增 env var 永远不进入 process env
- `/proc/<pid>/environ` 直接 dump 看不到新变量，但 .env 文件已含

**正确流程**（新增 env var 后）：

```bash
cd /opt/<app>
pm2 delete <app>                          # 不是 reload / restart
set -a && source .env.<env> && set +a     # 显式注入当前 shell
pm2 start ecosystem.config.js --only <app>  # PM2 从 shell 继承所有变量
sudo cat /proc/<NEW_PID>/environ | tr '\0' '\n' | grep <NEW_VAR>  # 验证
```

**spec 起草陷阱：** `ecosystem.config.js` 的 `env_file:` 字段名给人「PM2 会管」的强烈错觉。实际它只在初次 spawn 读一次。任何依赖「reload 自动注入新 env」的 runbook 都会踩。如果你的 deploy runbook 里写 `pm2 reload <app> --update-env`，**那是错的**，必须改成 delete + sourced-shell start。

### 1.7 不限于 `env_file` — 任何 `.env` 改动后 PM2 reload/restart 都不重读（v0.9.14 实战再现）

**实战触发：** BL-043 staging .env.staging 修复（2026-05-06）— Planner 添加新 env var `KOLMATRIX_APP_PASSWORD` + 同步改 `DATABASE_URL` 中密码后：

```bash
# 路径 1（标准 ecosystem.config.js 但不含 env_file 字段，PM2 启动时由 deploy-staging.sh 跑：
#   set -a; source .env.staging; set +a; pm2 start ecosystem.config.js --only <app>）
# .env 改动后：
pm2 reload kolmatrix-staging --update-env  # ❌ 仍 28P01 password authentication failed
pm2 restart kolmatrix-staging --update-env  # ❌ 同
```

**深入诊断（pm2 jlist 验证）：**
- `DATABASE_URL` 在 process env 中存在但**值是旧的**（PM2 daemon 启动时缓存的 env snapshot）
- `KOLMATRIX_APP_PASSWORD` 在 process env 中**根本不存在**（PM2 没读 `.env.staging` 新加的 line）
- 直接 `PGPASSWORD=$NEW_PWD psql -h localhost -U kolmatrix_app -d kolmatrix_staging` 通过 → 证明 PG 角色密码与 .env 一致，根因不是 PG 配置错位，而是 **PM2 进程内 env 与 .env 文件不一致**

**修订规则（reaffirm 加强）：** 不限于 §1.6 `env_file` 字段用法 — **任何环境下** `.env` 改动后必须 `pm2 delete + sourced shell start`（不是 reload / restart）。

**深层原因：** PM2 daemon 持有所有 process 的 env snapshot（process 启动时从 fork 的 shell 继承）。`reload --update-env` 只重启 process（保持 daemon 缓存的 env），不会重新 source `.env` 文件 — 因为 PM2 daemon 不知道 .env 文件存在（除非你用 `env_file:` 字段，但 §1.6 已证 `env_file:` 也只初次读）。

**修复模板（与 §1.6 一致，加注 .env 改动场景）：**

```bash
cd /opt/<app>
pm2 delete <app>                          # 不是 reload / restart — daemon 不重读 .env
set -a && source .env.<env> && set +a     # 显式 source 注入当前 shell（含新加的 var）
pm2 start ecosystem.config.js --only <app>  # PM2 daemon 从新 shell 重新缓存 env
# 如需验证：pm2 jlist | jq '.[] | select(.name=="<app>") | .pm2_env.<NEW_VAR>' 应非空
```

**反面案例（已落实战）：** BL-043 staging .env.staging 修复时 Planner 先尝 reload + restart 全失败 → 才用 delete + sourced start 解。**未来 spec 起草时凡涉及"新增 .env var + PM2 应用读"必须明示「pm2 delete + sourced shell start」流程，不可依赖 reload/restart --update-env**。

**来源：** v0.9.14 沉淀（BL-043 staging gap 修复 2026-05-06）。reaffirm v0.9.7 §1.6 + 扩范围（不限 env_file 字段用法）。Planner johnsong 在 prod redeploy ops 期间踩到，用户 2026-05-06 全 Accept。

---

## 2. VPS working tree 卫生 + artifact in-git 强制

### 2.1 两个关联 gap 的典型触发链

**Gap 1（严重）：** Reviewer 签收"在 VPS 上产出某 artifact"类 feature 时只核对"artifact 存在 VPS"，**未核对"artifact 是否 in git"**。BI3-F005 `scripts/cert-expiry-check.sh` 被 Generator 在 VPS 直接编辑创建，Reviewer 确认脚本存在 + cron + email 告警链路通后签收 PASS，**但脚本从未 commit 入 git**。86 行可执行代码活在 prod 单机 3 天，任何 re-deploy / 迁机器 / 灾后恢复都会丢失。

**Gap 2（工作区卫生）：** Generator 在 VPS SSH 直接编辑 `src/middleware.ts` 加 `console.log` 诊断 BI2-F002 的 UntrustedHost 问题后**未清理也未 commit**。3 天后 BAux1 触发 prod deploy，`deploy-prod.sh` 跑 `git checkout` 时被 working tree 冲突阻塞。

### 2.2 症状（如何知道坑了）

- `deploy-prod.sh` 在 "3/8 git fetch + checkout" 步骤失败
- 失败信息：`error: Your local changes to the following files would be overwritten by checkout` 或 `The following untracked working tree files would be overwritten by checkout`
- Deploy run 耗时不到 1 分钟（早 fail）
- VPS 上 `git status` 显示有 ` M` 或 `??` 文件

### 2.3 3 条防御规律

**规律 1（Reviewer 签收清单）：** Feature acceptance 写"在 VPS 上产出 X"时，**Reviewer 签收清单必须核对该 artifact 是否 `git ls-files` 能找到**：

```bash
ssh <vps> "cd /opt/<project> && git ls-files <artifact-path>"
# 应该输出该路径；空输出 = artifact 只活在 VPS 单点 = 拒绝签收
```

**规律 2（Generator + Planner 自律）：** VPS 上任何 `/opt/<project>` 内的 ad-hoc 编辑（SSH debug 改代码 / 临时加脚本）完成后必须：
- **要么 clean checkout 丢弃**（`git checkout -- <file>`、`rm <file>`）
- **要么 push 回 git**（`cd` 本地 repo → edit → commit → push → VPS `git pull`）
- 不允许长期保留 working tree 脏态（超过本次 debug session）

**规律 3（deploy-prod.sh 前置 check）：** 部署脚本加 `git status --porcelain` early fail：

```bash
# 在 scripts/deploy-prod.sh step 1 "记 prev-sha" 之前加：
STATUS=$(git status --porcelain)
if [[ -n "$STATUS" ]]; then
  echo "❌ VPS working tree not clean, aborting:"
  echo "$STATUS"
  exit 1
fi
```

Early fail 好过 step 3 失败时备份已跑一半 + 状态难清理。

### 2.4 Reviewer 签收新 checklist 模板

涉及 VPS 产出的 feature，L1 自动化验收之后补一步：

| 检查项 | 命令 | 期望 |
|---|---|---|
| artifact 存在 VPS | `ssh … "ls -la <path>"` | 文件存在 + 权限合理 |
| **artifact 在 git tracked** | `ssh … "cd /opt/<project> && git ls-files <path>"` | **输出非空**（该路径在 git index 中）|
| artifact 与 git 版本一致（可选）| `ssh … "cd /opt/<project> && git diff <path>"` | 空输出（无 diff）|

前两项**必检**，第三项可选（如果 VPS 有合法本地改动等待 push）。

### 2.5 Planner spec 起草期的 counter-check

涉及 VPS 部署 / 脚本 / cron 的 spec acceptance 写作时，**必须**包含以下 2 类验收项：

```
- [ ] 脚本 / config file 在 git tracked（`git ls-files <path>` 非空）
- [ ] VPS 上 artifact 与 git 版本 byte-identical（或明确声明允许 drift）
```

仅写"VPS 上脚本存在"是不够的 —— 这会让 Reviewer 走短路径签收。

---

## 3. Staging/Prod deploy 完整链 checklist（schema + 数据回填一并验）

### 3.1 坑

KOLMatrix B5 fixing-2 → fixing-3 → fixing-7 + MVP fixing-2 累积暴露：

- **fixing-2**（commit cfd9c1e）：staging DB 缺 F001 migration → 三页 P2022 ColumnNotFound on `kol.channel_created_at`。F001 commit 时 migration 文件入了 git，但 staging deploy 步骤里没列 `npx prisma migrate deploy`。
- **fixing-3**（commit 3066551）：staging F002 enrich 历史从未跑 → 5/5 抽样 KOL banner/age/videoCount 全空。F002 commit 时脚本入了 git，但 staging deploy 没跑 `npm run enrich:kol-youtube`。
- **fixing-7**（commit ec9340b）：staging /api/health.git_sha = 之前的 chore commit ee45543，本地 HEAD = e493ab4 → Reviewer 严卡 SHA 对齐。e493ab4 仅是 chore(state) progress.json 改动 paths-ignore，不会触发自动 staging deploy。
- **MVP fixing-2**：staging seed 漏 KolCampaign rows + KOL.email → C-10 outreach 不可用（看似 prod redeploy 完成实际数据未到位）。

共同 root cause：**「spec 里写了脚本/migration 入 git」≠「staging 实际跑通」**。runbook 不显式列每一步 = 必踩。

### 3.2 完整链 checklist

任何批次 status `building → verifying` 切换前，Generator 必须按下面顺序在 staging VM 跑通；缺任何一步 = 拒切：

```bash
# 1. SSH 进 staging（KEX 设置见 environment.md）
ssh tripplezhou@<staging-ip>

# 2. 拉代码到 deploy 路径
cd /opt/<app>-staging
git pull --ff-only origin main

# 3. 装依赖（npm ci 而非 install，保锁版）
set -a && source .env.<staging> && set +a
npm ci --include=dev

# 3.5. ⚠️ Prisma client 生成（必跑显式步骤，不依赖 postinstall hook）
# NODE_ENV=production 下 npm ci 不跑 package.json 的 postinstall（含 prisma generate），
# 导致 node_modules/.prisma/client/ 缺席 → next build 阶段 tsc 解析
# `import { PrismaClient } from "@prisma/client"` 失败。来源：BL-025-F001 staging deploy 失败。
npx prisma generate

# 4. ⚠️ Schema 迁移（必跑，即便本批次没改 schema 也跑 — 防漏）
npx prisma migrate deploy

# 5. ⚠️ 数据回填脚本（如本批次含 enrich/seed）
npm run db:seed                     # 或 npm run enrich:kol-youtube 等
# 如批次含数据回填脚本，spec § 必须显式列脚本名

# 6. Build（注意 OOM）
NODE_OPTIONS='--max-old-space-size=4096' GIT_SHA=$(git rev-parse --short HEAD) npm run build

# 7. PM2 重启（按 §1 anti-pattern：必须 delete + sourced-shell start）
pm2 delete <app>-staging
pm2 start ecosystem.config.js --only <app>-staging

# 8. 验证 SHA 对齐
curl -sS https://staging.<domain>/api/health | jq .git_sha
# 必须等于 git rev-parse --short HEAD

# 9. 抽样验证数据（如本批次含 enrich/seed）
psql ... 'SELECT COUNT(*) FROM <table> WHERE <new_col> IS NOT NULL'
# 抽 5 个白名单 ID 在浏览器走查
```

### 3.3 Spec 起草期 checklist 对应（Planner）

每条 spec § "staging deploy 步骤" 必含：

- [ ] `npx prisma generate`（npm ci 之后立即跑，不依赖 postinstall hook；BL-025-F001 沉淀）
- [ ] `prisma migrate deploy`（不论本批次是否改 schema）
- [ ] 数据回填脚本名 + 抽样验证条件（如含数据填充）
- [ ] `pm2 delete + sourced-shell start`（不要写 reload）
- [ ] `/api/health.git_sha = HEAD` 验证步骤
- [ ] Planner 提供白名单 ID 给 Reviewer 抽样（防 BL-012-style 数据池污染）

### 3.4 chore(state) commits 不触发 staging deploy + Reviewer SHA 严收紧的边界

`chore(state)` / `chore(planner)` / `test(...)` 类 commits 本质是状态机维护文件改动（progress.json / .auto-memory / docs/test-reports/），paths-ignore 配置使其**不触发** staging/prod deploy（设计如此，避免无意义重 build）。

**但 Reviewer 严收紧 SHA 对齐时**，本地 HEAD = chore commit、staging git_sha = 上一个 prod commit → 误判 mismatch。

两种处理（按情境选）：

- **(a) Planner 主动同步 SHA**：chore commit 后 Planner 自己 SSH staging 跑 §3.2 步骤 6-8（build + pm2 + SHA 验证），把 staging SHA 推齐到 chore HEAD。
- **(b) Reviewer 签收规则容许 chore-only 差异**：white-list SHA-1...SHA-2 区间内仅 paths-ignore matched 的差异 = 等价部署（见 `evaluator.md` "SHA 对齐严收紧的边界"）。

**默认推 (a)** —— 简单、无歧义、不需要 Reviewer 自己判 paths-ignore 范围。

---

## 4. Visual baseline regen 注意事项

### 4.1 GITHUB_TOKEN push 不触发下游 workflow

KOLMatrix B5 F006 case（commits 14ea522 / 172c2df / 5b2f622）：

- `update-visual-baselines.yml` workflow 跑完 → 用 GITHUB_TOKEN 推 commit 把新 baseline 入 git
- GitHub 默认 policy：**用 GITHUB_TOKEN 推的 commit 不触发其他 workflow**（防 infinite loop）
- 结果：visual baseline 重生后 visual regression CI 没跑 → 没人知道 baseline 是否真匹配 → 后续 PR 跑 visual regression 才发现 baseline still off

**解决方法：** baseline regen workflow 之后**必须跟一个 real-content commit 触发下游 CI**。空 commit 不够（paths-ignore matches all 时 CI skip）。

### 4.2 Spec / Generator checklist

任何 feature 改 UI layout（dashboard / discovery / detail / login 等）= 必有 visual baseline 重生：

- [ ] feature 改 UI 后 commit + push 触发 PR → visual regression workflow 失败（baseline mismatch 是预期的）
- [ ] 跑 `update-visual-baselines.yml` workflow → baseline 入 git（用 GITHUB_TOKEN）
- [ ] **跟一个 real-content commit**（如 `chore(visual): regenerate baselines via update-visual-baselines workflow` + 一行任意修改）触发 visual regression workflow 跑通
- [ ] 验证 visual regression workflow 全绿才算 baseline 真匹配

### 4.3 Visual test 选择器要 deterministic

KOLMatrix B5 F006 case：

- `firstCard = .first()` 选择器依赖默认排序，遇到平台条件渲染（recent videos / topic cloud 仅 youtube KOL 有）变成 flake
- 应改：`page.locator('[data-kol-platform="youtube"]').first()` — 显式锚点

任何条件渲染的 UI 元素，visual test 必须用 stable data-attribute 锚点而非位置 selector。

---

## 5. 新 auth-gated endpoint 配套 deploy script（v0.9.12 — BL-034 F007 沉淀）

### 5.1 坑（双坑组合）

BL-034 F007 把 `/api/health` `git_sha` + `version` 字段加 token guard（`HEALTH_DETAIL_TOKEN` env 守卫）— 默认无 token 不返这两字段。但 deploy-staging.sh 既有验证段严格 grep `git_sha` 字段：

```bash
# deploy-staging.sh （F007 之前 OK，F007 之后死循环）
ACTUAL_SHA=$(curl -s "$HEALTH_URL" | jq -r .git_sha)
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "SHA mismatch"; exit 1
fi
```

**死循环：** F007 commit 推 staging → deploy-staging.sh 跑 → curl health 返 `null`（token 未配）→ ACTUAL_SHA="null" ≠ EXPECTED_SHA → exit 1 → deploy 失败 → 用户无法落地 `HEALTH_DETAIL_TOKEN` env → **下次 deploy 仍 fail**（先有鸡先有蛋）。

**第二坑（bash 旧 bytecode）：** Generator 在 fix-round 1 同步加 graceful-degrade 路径（commit `07a6db4`：token 未配置时 warning + skip strict check），git pull 更新文件后第二次 deploy 仍 fail — 因为 bash 进程已读取旧 bytecode；第三次 deploy 重启进程才生效。

### 5.2 修订规则

**新增 default-deny 健康检查 endpoint（任何返回字段加 auth gate）时同 commit 改 deploy script，否则触发死循环：**

1. **Spec 起草必含子项：** 「本 feature 改动 health endpoint 字段返回行为时，同 commit 修 `scripts/deploy-*.sh` 加 graceful-degrade 路径（auth env 未配时 warning 而非 exit 1）」
2. **Generator 实装：** auth-gated endpoint 改动同 commit 改 deploy script。两个 commit 拆分 = 故障窗口（即使秒级窗口 staging deploy 死循环不可恢复，要等用户手动落 env）
3. **Reviewer L2 验收：** 新 auth-gated endpoint 的 deploy script 改动必须验证两条路径：(a) auth env 未配时 graceful-degrade（warning + 不 exit）+ (b) auth env 已配时 strict check
4. **Bash 旧 bytecode 重启 deploy run：** deploy script 改动同 commit 后必须**重启 deploy 进程**（pm2 reload 或 docker restart 或 simply 触发新 GH Actions run）— bash 已读取旧 bytecode，不会自动 reload；如果 deploy 是 GH Actions 触发则下次 run 自然新进程，无需特殊操作；如果是 SSH 持续连接 + bash interactive 则需手动 source 或退出重进

### 5.3 graceful-degrade 模板

```bash
# scripts/deploy-staging.sh （F007 fix-round 1 后版本）
ACTUAL_SHA=$(curl -s -H "X-Health-Token: ${HEALTH_DETAIL_TOKEN:-}" "$HEALTH_URL" | jq -r .git_sha)

if [ -z "$HEALTH_DETAIL_TOKEN" ]; then
  echo "⚠️  HEALTH_DETAIL_TOKEN not set — skip strict SHA verification (graceful-degrade)"
  echo "   To enable strict check: SSH staging, set HEALTH_DETAIL_TOKEN in .env.staging, redeploy"
  exit 0
fi

if [ -z "$ACTUAL_SHA" ] || [ "$ACTUAL_SHA" = "null" ]; then
  echo "❌ Health endpoint returned no git_sha despite token set"
  echo "   Token may be wrong or endpoint may not return git_sha. Investigate."
  exit 1
fi

if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "❌ SHA mismatch: expected $EXPECTED_SHA, got $ACTUAL_SHA"
  exit 1
fi

echo "✅ git_sha verified: $ACTUAL_SHA"
```

### 5.4 反面案例

**KOLMatrix BL-034 F007 实战（2026-05-05）：** F007 commit 0db858f 加 token gate → staging deploy 死循环（token 未配 + 严格 grep）→ 用户报障 → Generator fix-round 1 commit 07a6db4 加 graceful-degrade → 第二次 deploy 仍 fail（bash bytecode）→ 第三次 deploy 触发新 GH Actions run 才 PASS。

**反面（不遵守本节会发生的）：** 引入 default-deny 健康检查时不改 deploy script → staging deploy 死循环要 N 小时排查 + 全责落到 fix-round 1 + 用户驱动 SSH 落 env 时无法验证（deploy 跑不通）→ prod 上线时间被延后。

**来源：** KOLMatrix BL-034 F007 deploy-staging.sh 死循环 + bash 旧 bytecode 双坑。Reviewer 在 signoff 报告新提此规律入框架（v0.9.12 候选），用户 2026-05-05 全 Accept。

---

### 5.1 spec acceptance 改 deploy-script 时同 commit 必须改对应 yml workflow（v0.9.13 — BL-024-F006 retroactive 沉淀）

**坑：** BL-034 F001 spec acceptance 已 done @ dbbfbb3（deploy-prod.sh 加 ALTER ROLE 段 line 71-81）但漏了同 commit 改 `.github/workflows/deploy-prod.yml` script 块加 `set -a; source .env.production; set +a` 桥接 → GH Actions Run 时 `KOLMATRIX_APP_PASSWORD` env var 不会 export 到 shell 环境 → ALTER ROLE 段 silent skip → prod kolmatrix_app 角色实际仍用 init migration 字面 `'kolmatrix_app'` 弱密码（**CRIT-1 fix 未在 prod 生效 1+ 周**）。

Planner johnsong 在 BL-024 prod redeploy ops 准备阶段（2026-05-05 23:00）实地核查 deploy-prod.sh 注释「Reads KOLMATRIX_APP_PASSWORD from .env.production via the SSH workflow's `set -a; source .env.production; set +a` (added in the GH Actions step)」与 deploy-prod.yml script 块实际内容对比才发现 — 注释明示但 yml 实装漏。BL-024 F006 retroactive hotfix（commit eacbbbb）补 yml 桥接 + 同步修 deploy-staging.yml。

**根因：** spec 起草时 Planner / Generator 对「deploy 链」的端到端理解仅停在 deploy-script 层，未明确「shell env 来源 = yml 桥接」这一上下游关系。注释明示但实装漏 → silent skip 1+ 周不被发现。

**修订规则：**

1. **任何修改 `scripts/deploy-*.sh` / `infrastructure/deploy-*.sh` 的 spec feature acceptance**，必须同 commit 改对应 `.github/workflows/deploy-*.yml`（如 deploy-script 引入新的 env var 依赖 → yml script 块必须 `set -a; source .env*; set +a`）

2. **Planner spec lock 前 checklist：**
   ```bash
   # 任意 spec feature 涉及 deploy-script 改动时，spec lock 前跑：
   # 检查同 commit 是否 yml 配套
   git log --name-only -1 | grep -E 'scripts/deploy|infrastructure/deploy|\.github/workflows/deploy'
   # deploy-script 改动数 > 0 + yml 改动数 = 0 → 立即修订 spec acceptance 加 yml 配套段落
   ```

3. **Generator 实装 checklist：** deploy-script 改动需 yml 桥接同 PR；不分 commit 推（避免一边修一边漏）

4. **Reviewer L2 验收 checklist（强制）：** staging deploy 不仅看 health endpoint，还要**抓 deploy log warning**：
   ```bash
   # 验 staging deploy 后，gh run view <RUN_ID> --log | grep -E '⚠️|skipping|unset|warning'
   # 任意 warning 命中 → 立即标 PARTIAL 切 fixing；deploy 看似 success 但 silent skip = 实质 fail
   ```
   BL-034 F001 silent skip 持续 1+ 周未发现的根因正是 Reviewer 没看 deploy log 中 "⚠️ KOLMATRIX_APP_PASSWORD unset — skipping" 这行 warning。

**反面案例（已落 BL-024 F006 retroactive hotfix）：** BL-034 F001 spec acceptance 写 ALTER ROLE 段 done @ dbbfbb3 但 prod CRIT-1 实际未修 1+ 周（直至 2026-05-05 Planner 实地核查）。本可在 BL-034 F001 spec lock 时加「同 commit 改 yml」检查项 + Reviewer L2 deploy log warning 抓取避免。

**来源：** KOLMatrix BL-024-F006 retroactive hotfix（commit eacbbbb，BL-034 F001 root cause 1+ 周后实地核查发现）。Generator Kimi 在 BL-024 generator_handoff 提案 + Planner johnsong 实地核查 + 用户 2026-05-06 全 Accept（v0.9.13 候选 #1）。

---

## 6. 数据命名/结构变更类修复：部署立即触发 on-boot 后台任务，需配套幂等数据修复（v0.9.23 — aigcgateway BL-SYNC-ADAPTERTYPE-FALLBACK 沉淀）

### 6.1 坑

当修复**改变已存在数据的命名 / 结构规则**（如给某类记录的 canonical name 加前缀、改字段派生逻辑），且项目存在 **on-boot / 定时后台任务**（如 model sync 在 `instrumentation.ts` boot 时跑、cron 回填）时：

**部署 = `git reset --hard` + 重启 → 后台任务立即用新代码跑一次**，在"旧数据（旧命名）+ 新逻辑（新命名）"之间产生 **orphan / 中间态**。

aigcgateway BL-SYNC-ADAPTERTYPE-FALLBACK fix-round-1 实例：修复让 guangtech 模型 canonical 从裸 `gpt-5.5` 改为 `guangtech/gpt-5.5`。部署后 boot sync 立即跑 → 用新命名建了 6 个 `guangtech/*` 模型行，但**活跃 channel 仍按 `realModelId` 匹配、挂在旧的裸名模型上** → 新模型 orphan（0 channel）、旧模型仍带活跃 channel。一次性重命名脚本因此必须"先删 orphan 再 rename"。

### 6.2 规律

- **数据命名/结构变更类修复必须配套幂等数据修复脚本**（committed，非临时 SQL），把存量旧数据迁到新规则
- **修复脚本要能自愈部署后 boot 任务产生的中间态**（如"目标名已被 orphan 占用 → 无引用则删 orphan 再迁"），否则脚本会因"目标已存在"卡住
- **时序：先部署（让 prod 跑新代码）→ 再跑数据修复**。反序（先改数据、后部署）会被部署前旧代码的 boot 任务打回旧规则
- 脚本必须**幂等**：dry-run 默认 + 复跑无变化，Reviewer 可安全复验

### 6.3 Planner spec 起草 / Generator 实装 / Reviewer 复验 checklist

- [ ] 本批次是否改了"已存在数据的命名/派生规则"？是 → 必须配套数据修复脚本（feature 或 ops 步骤显式列出）
- [ ] 项目有 on-boot / cron 后台任务吗？会消费/重算被改的数据吗？→ acceptance 标注"部署后 boot 任务时序"
- [ ] 修复脚本处理 orphan / 目标已存在 / 共享引用等中间态（护栏跳过或自愈）
- [ ] 脚本幂等（dry-run 默认，复跑 0 变更）；Reviewer 复验含"脚本 dry-run 待处理 = 0"

**来源：** aigcgateway BL-SYNC-ADAPTERTYPE-FALLBACK fix-round-1（部署后 boot sync 建 orphan，一次性重命名脚本增强为删 orphan 再 rename）。

---

## 7. 不可逆生产迁移（换机 / 换部署模型）— v1.0.1（aigcgateway BL-PROD-MIGRATE-DEPLOYSVR 沉淀）

换生产服务器、或换部署模型（原生 PM2 → 容器化）属不可逆操作，必须按固定剧本，否则一次翻车全站瘫痪或数据丢失。

### 7.1 迁移剧本：演练 → 预置 → 最短停机窗口 → 回滚就绪

四段式，前两段完全可逆、旧机全程照常服务：

1. **并行演练（旧机不动）**：新机起完整新栈 + 灌一份**生产数据快照** + 全链路冒烟（真实凭据解密、跨云资源读写、流式、鉴权、MCP 等）。演练在新机 loopback 跑，不切流量。价值：本次演练即捕获 Next standalone HOSTNAME bug（§7.3），割接前挡掉。
2. **可逆预置（旧机不动）**：割接要用的**一切可逆步骤全预置完** —— 签 TLS 证书（DNS-01 免停机）、装反向代理 vhost、验证公网入口可达（`curl --resolve <域名>:443:<新IP>` 绕 DNS 直验新机 200 + 证书）。目的：把不可逆窗口压到只剩数据同步 + DNS 切换。
3. **最短停机窗口**：`停旧机写入 → 数据终态同步 → 切 DNS`。每个不可逆点（停写 / 数据终态 / DNS 切）执行前取用户 go/no-go。数据终态用 `drop schema public cascade + pg_restore --no-owner`（清演练残留）。
4. **回滚就绪**：旧机停写**冻结**（DB 不再写）作回滚点；旧 DNS 值 / `VPS_HOST` 旧值 / last-known-good 镜像 tag 全留档。观察期内不退旧机；旧机若还承载其他服务，整机退役单列。

**Planner spec checklist（迁移批次）：**
- [ ] acceptance 含"演练冒烟"（新栈 loopback）+ "割接后公网端到端"两层
- [ ] 三个不可逆门禁（停写 / 数据终态 / DNS 切）标注 go/no-go
- [ ] 回滚手册显式（流量回滚命令 + 镜像/进程回滚命令 + 旧机冻结确认）
- [ ] 旧机若跑多服务，退役范围 = 仅本服务冻结；整机下线依赖其他服务迁移，单列

### 7.2 凭据一致性（有状态应用迁移红线）

**"解密 DB 数据的密钥"必须与源机逐字节一致，且 sha256 跨机比对证明** —— 不能只"复制了就算"。一旦不一致，DB 内所有加密字段（如 provider 凭据）无法解密 = 全站瘫痪。

```bash
# 跨机比对（只传 hash，不落明文 / 不进日志）：源机 authoritative 配置 vs 新机 .env 逐项 ✓ 才继续
h() { printf '%s' "$1" | sha256sum | cut -c1-16; }   # 对 ENCRYPTION_KEY / JWT / 签名 secret / DB 密码逐项
```

**配套坑 — env_file 引号**：源机 `.env` 若被 bash `source`（值带引号 `KEY="v"`），迁到 docker compose `env_file` 时**引号被当字面量保留**（值变成 `"v"` 而非 `v`）→ 密钥错位。构建新 `.env` 时必须去外层引号规范化。

### 7.3 容器化 Next.js standalone 的 HOSTNAME 坑

Next.js standalone `server.js` 默认绑 `process.env.HOSTNAME`，而 **Docker 运行时把 HOSTNAME 注入为容器 ID** → app 绑到容器 IP 而非 `0.0.0.0`：
- 发布端口经 docker-proxy 仍可达（宿主 / 外部 curl 200）——**掩盖问题**
- 但**容器内** `127.0.0.1:<port>` 不监听 → 容器 HEALTHCHECK（`fetch 127.0.0.1`）ECONNREFUSED、状态永远卡 `starting`

**修复**：compose `environment: HOSTNAME=0.0.0.0`（发布端口仅绑 127.0.0.1 loopback 时无安全影响）。与 `web-runtime-patterns.md` §"Next standalone request.url origin 反代推导" 同族——一个是绑定地址、一个是对外 URL 构造。

**来源：** aigcgateway BL-PROD-MIGRATE-DEPLOYSVR（GCP 原生 PM2 → deploysvr 容器化，2026-07-12）。演练捕获 HOSTNAME bug；sha256 校验 ENCRYPTION_KEY 逐字一致；Certbot DNS-01 预签零停机割接。

---

## 来源

- KOLMatrix BI2-F002 两轮重裁决 + Round 2 实测证伪（2026-04-20）
- KOLMatrix BI3-F005 脚本未入 git + BAux1 deploy 失败（2026-04-23）
- KOLMatrix B5 fixing-2/3/4/6/7（schema migration / enrich / PM2 env_file / timeout / SHA 对齐 多坑，2026-04-30 ~ 2026-05-01）
- KOLMatrix MVP-internal-demo-prep fixing-1/2/3（KolCampaign+email seed gap / SHA mismatch / aigcgateway contract drift，2026-05-01）
- 裁决文档：`docs/specs/BI2-f002-zero-downtime-fix.md` v2
- 交接文档：`docs/specs/BI2-f002-round2-adjudication.md`
- 修复 commits：`ba11e6b` / `bc1de3b` / `4f86fc0`（salvage cert-expiry-check.sh）/ `cfd9c1e` / `3066551` / `4d1057c` / `ee45543` / `ec9340b` / `8cd80f2` / `912fbc7`

---

## 版本历史

| 日期 | 修订 | 来源 |
|---|---|---|
| 2026-04-20 | 初版沉淀（§1 PM2 zero-downtime 3 条件 + Next.js custom server 路径）| KOLMatrix BI2-F002 两轮证伪 |
| 2026-04-23 | §2 VPS working tree 卫生 + artifact in-git 强制（3 条规律 + Reviewer checklist）| KOLMatrix BI3-F005 签收漏 + BAux1 deploy 失败 |
| 2026-05-01 | §1 扩展 PM2 6.0.14 env_file anti-pattern；§3 完整链 checklist（schema + enrich + SHA 对齐边界）；§4 Visual baseline regen 注意事项 | KOLMatrix B5 7 轮 fixing + MVP-internal-demo-prep 3 轮 fixing 累积 |
| 2026-05-05 | §5 新 auth-gated endpoint 配套 deploy script（v0.9.12，含 graceful-degrade 模板 + bash 旧 bytecode 重启 deploy run）| KOLMatrix BL-034 F007 deploy-staging.sh 死循环 + bash bytecode 双坑 |
| 2026-05-06 | §5.1 spec acceptance 改 deploy-script 时同 commit 必须改对应 yml workflow（v0.9.13，含 Planner spec lock checklist + Generator 实装 checklist + Reviewer L2 deploy log warning 抓取强制）| KOLMatrix BL-024-F006 retroactive hotfix（BL-034 F001 root cause 1+ 周后实地核查发现）|
| 2026-07-03 | §6 数据命名/结构变更类修复：部署立即触发 on-boot 后台任务产生 orphan/中间态，须配套幂等数据修复脚本（自愈 orphan + 先部署后修数据 + dry-run 默认）| aigcgateway BL-SYNC-ADAPTERTYPE-FALLBACK fix-round-1（v0.9.23）|
| 2026-07-12 | §7 不可逆生产迁移（换机/换部署模型）：演练→预置→最短停机窗口→回滚就绪四段剧本 + 凭据 sha256 逐字一致红线（含 env_file 引号坑）+ 容器化 Next.js standalone HOSTNAME=0.0.0.0 坑 | aigcgateway BL-PROD-MIGRATE-DEPLOYSVR（GCP 原生 PM2 → deploysvr 容器化，v1.0.1）|
