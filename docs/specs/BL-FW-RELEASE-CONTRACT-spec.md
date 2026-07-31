# BL-FW-RELEASE-CONTRACT - Harness 发布契约根治

**批次类型：** 跨仓混合批次（3 个 generator feature + 1 个独立 evaluator feature）

**用户确认：** 2026-07-30，用户要求“安排修复批次，根治此 bug”，随后明确“开始”。

## 1. 背景

tokenizer 的 Harness 项目卡片正确上报了本地账本版本 `v1.5.2`，但控制台的
`FRAMEWORK_RELEASES` 静态数组只到 `v1.4.6`。比较函数因此返回 `ahead`，页面如实显示
“比服务端已知的最新还新”。问题不是 device agent、快照持久化或页面分支，而是下列三个
发布记录能独立变更：

1. `harness-template/VERSION`（框架源码当前版本）；
2. `harness-template/CHANGELOG.md`（人工发行记录）；
3. tokenizer `src/shared/framework-version.ts`（控制台可识别的版本列表）。

此前 `v1.5.0`、`v1.5.1`、`v1.5.2` 更新了前两类中的部分物件和项目账本，却没有同步第三项。
现有测试只比较数组末项与由同一数组推导出的常量，无法发现跨文件、跨仓漂移。

## 2. 目标与非目标

### 2.1 目标

- 建立一个机器可读的、有序发布清单作为 v1 正式版本历史的唯一事实源。
- 保留 `VERSION` 的 shell/账本兼容性，但让它受清单机械校验；`CHANGELOG.md` 继续是人读审计记录。
- 使 release manifest 经过 Harness init/sync/bootstrapping 物化到受管项目的 `framework/` 镜像。
- 让 tokenizer 控制台从该镜像读取发布列表，消除手工复制的版本数组。
- 用源仓 CI、同步 fixture 和 consumer 测试在发布前捕获任何后续漂移。

### 2.2 非目标

- 不修改 Prisma、数据库、Harness report/heartbeat API 或 agent capability version。
- 不回写历史 `HarnessProject.modes`；版本比较应对既有快照即时正确。
- 不把控制台改为运行时访问 GitHub、远端 tag 或本地任意框架路径。
- 不自动 push、tag、发版或部署生产；这些均保留后续明确授权与人工闸门。

## 3. 关键设计裁决

### D1 - 单一机器事实源

在 `harness-template/harness/framework-releases.json` 创建例如：

```json
{
  "schema_version": 1,
  "releases": [{ "version": "1.0.0", "released_on": "2026-07-09" }, "...", { "version": "1.5.3", "released_on": "2026-07-30" }]
}
```

`releases` 只记录严格的三段式 SemVer 和 UTC 发布日期，顺序必须严格递增且无重复；最新版
永远由末项推导，不再在 manifest 内重复存储 `latest`。这个合同从 `v1.0.0` 开始，保留 v0.x
在控制台中“旧但无可计数发布清单”的既有语义。`VERSION` 必须等于末项，`CHANGELOG.md` 中
所有 v1 标题的版本与日期和清单双向一致；缺失的 `v1.1.0`、`v1.2.0`、`v1.3.0` 历史条目要按
既有 tag/commit 证据回填。`v1.5.3` 是本修复的新的 patch release，不能静默回改已发布的
`v1.5.2`。

### D2 - 离线、受管分发

manifest 放在已有递归镜像的 `harness/` 目录下，因此模板 `harness.sh` 的 `FRAMEWORK_MIRROR`
会自动将它管理为项目 `framework/harness/framework-releases.json`；无需另起一套顶层复制规则，
offline `--from` 同样可用。同步只在 manifest 本身出现本地定制时按既有双 SHA 规则报告冲突，
不得绕过 `harness.lock` 或破坏自我覆盖防护。

### D3 - 控制台 consumer 保持接口稳定

tokenizer 的 `FRAMEWORK_RELEASES`、`LATEST_FRAMEWORK_VERSION`、`compareFrameworkVersion()`、
`frameworkStanding()` 与 `versionsBehind()` 继续导出相同语义；实现改为从
`framework/harness/framework-releases.json` 派生。Next/TypeScript 已开启 `resolveJsonModule`，无需运行时
文件 I/O 或数据库。`ahead` 是未来未知新版本的真实状态，必须保留，不能为了隐藏本次问题而删除。

### D4 - 发布顺序与可见状态

先在 `harness-template` 完成并验证 `v1.5.3`，再从该已验证源执行 tokenizer sync，并在同一
tokenizer 批次提交 consumer 改动。发布控制台后，旧的 `v1.5.2` 快照会正确显示“落后 1 版”；
tokenizer 项目完成 sync/heartbeat 上报 `v1.5.3` 后显示 latest。这是正确的发布语义，不回写
历史快照伪造最新状态。

## 4. Feature 与验收

### F001 - 框架发布清单唯一事实源与源仓校验

**范围：** `harness-template/harness/framework-releases.json`、`VERSION`、`CHANGELOG.md`、发布验证脚本与
`.github/workflows/`。

**验收：**

- 清单覆盖 v1 正式版本史并以 `1.5.3` 结尾；v1.1.0/v1.2.0/v1.3.0 的 changelog 历史条目完整回填。
- validator 拒绝空清单、非法版本/日期、前导零、重复、非递增、VERSION 不同和 v1 changelog 单边版本。
- validator 是只读的，成功与失败 fixture 均有测试；源仓 GitHub workflow 在 push/PR 运行。
- 不读取 token、网络凭据或生产环境变量。

### F002 - 发布清单随 Harness init 与 sync 可靠分发

**范围：** `harness-template` 的既有 mirror/install 机件及必要的 source fixture；只有 fixture 暴露缺口时才改模板或 bootstrap。

**验收：**

- 新 init、已有项目 sync、nested 与 flat bootstrap 都将 manifest 写入 `framework/harness/framework-releases.json`；adopt 保持只记录，旧项目缺清单时由后续 sync 补入。
- `harness.lock` 管理该文件；字节、SHA 与源树一致。
- 临时目录 fixture 不修改真实项目，且回归确认 VERSION、CHANGELOG、harness.json 和已有自我覆盖
  逻辑仍有效。

### F003 - Tokenizer 控制台消费发布清单并消除静态漂移

**范围：** tokenizer 的 `framework/` 镜像及 `harness.json`/`harness.lock`、
`src/shared/framework-version.ts`、相关 tests 与必要文档。

**验收：**

- 受控 sync 后 tokenizer 镜像和账本均指向 `v1.5.3`，`framework/harness/framework-releases.json` 与源一致。
- 不存在独立手写的 `FRAMEWORK_RELEASES` 数据副本；导出 API 与四态比较保持兼容。
- 测试明确验证 `1.5.3 -> latest`、`1.5.2 -> behind(1)`、`9.9.9 -> ahead` 和 malformed -> unknown。
- 模式徽章继续保留 future-ahead 文案，但同步后的 tokenizer 不显示旧的 `v1.4.6` 基线。

### F004 - 跨仓独立发布契约验收

**范围：** 独立验收工件，禁止产品代码修改。

**验收：**

- `reviewer-kimi-a2a` 从锁定 SHA 自行读取两仓实物、规格和 diff，不信任 handoff。
- 运行源仓 validator/fixture、tokenizer focused 与全量测试、`npm run verify`、`npm run lint`、
  `npm run build`，并确认无 DB/API/agent-feature-version/生产写入。
- 结论落 `docs/test-reports/BL-FW-RELEASE-CONTRACT-verdict.json`，schema 合法，逐项 F001-F004
  给 PASS/PARTIAL/FAIL、证据与复现步骤，`waiting=null`。

## 5. 编排与闸门

- Generator：`builder-codex`，`local-cli`，model family `codex`；仅允许 source/consumer 的本地实现，
  不得 push 或部署。
- Evaluator：`reviewer-kimi-a2a`，model family `kimi`，与 generator 互斥；fresh context 验收。
- F001/F002 与 F003 存在源仓发布依赖，串行执行；F004 只在 F001-F003 完成并锁定 SHA 后开始。
- `verifying -> done` 使用 Class B 人工 `phase_advance` 闸门。闸门批准不包含 push、tag、GitHub release、
  生产部署或数据库迁移授权。
