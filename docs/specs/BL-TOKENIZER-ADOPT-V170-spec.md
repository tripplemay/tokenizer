# BL-TOKENIZER-ADOPT-V170 - tokenizer 采纳框架 v1.7.0

> **类型：** 普通批次（executor:generator + 一条 evaluator 验收）
> **日期:** 2026-08-05 · **Planner:** main context
> **背景:** harness-template 已发布 v1.7.0（github.com/tripplemay/harness-template，e91fbbc，含全部 tag）。tokenizer 的框架镜像停在 v1.6.2，且 src 测试（framework-version / mode-badges / harness-tool-catalog）与 1.6.2 硬耦合——直接升会破坏 10 个测试。本批次让 tokenizer 干净采纳 v1.7.0。

## 1. 背景与依赖

- v1.7.0 的 dispatch provider（A 血统）经真机验证：修复 6 个潜伏 launch bug（`-I` 导入、bytes 写入、copy-in 权限、staged 属主、artifact 父目录模式、artifact 属主），并含 deliverable_channels、铁律13、codex `--ignore-user-config` 硬化。
- tokenizer 的 `src/shared/framework-version.ts` 在构建时 import `framework/harness/framework-releases.json` 派生 `LATEST_FRAMEWORK_VERSION`；升版会改变控制台的 framework-standing 显示（属预期产品行为变更，push 后会部署）。
- **机器契约迁移（rollout 注意，非纯代码）：** v1.7.0 的 provider 要求 machine config（`~/.tokenizer/harness/vm-v1/provider.json` + bundle manifest）带 `image_location` 与 `kimi_identity`（A 的完整性特性，B 曾退化掉）。采纳后本机需迁移该 config，否则 bridge launch fail-closed。此为本机安装步骤，记入验收报告与 project-status，不入 git。

## 2. Feature 与验收

### F001 - 采纳 v1.7.0 框架文件（executor:generator）

将 harness-template@v1.7.0 的受管框架文件同步进 tokenizer：`.claude/dispatch/**` 与 `framework/templates/claude/dispatch/**`（runtime + tests，逐字节一致，保留本地 `agents-registry.example.json`）、`framework/harness/framework-releases.json`（末项 1.7.0）、`framework/VERSION`=1.7.0、`framework/harness/*.md` 与 root 文档层的 v1.6.5 铁律13 增量、`harness.json`/`harness.lock` 版本记账。验收：`diff -rq` 与 v1.7.0 源一致（除本地 registry）；framework-releases.json 末项=1.7.0；provider 含 6 处真机修复标记（`TARGET_RESOLUTION_PYTHON`/`no-same-owner`/`a+rX`/`write_bytes`/artifact chown/copy-in chmod）；全部 framework dispatch 套件（python）绿。

### F002 - 更新耦合的 src 测试（executor:generator）

更新与框架版本/桥接形状硬耦合的 3 个 vitest 测试到 v1.7.0 期望：`tests/shared/framework-version.test.ts`（latest 1.6.2→1.7.0，behind/ahead 用例相应更新）、`tests/shared/mode-badges.test.ts`（synced-latest 版本、behind guidance 用例）、`tests/cli/harness-tool-catalog.test.ts`（external bridge attestation 2 例，对齐 v1.7.0 provider/manifest 形状，含 planner=plan+terminal-message）。验收：`npx vitest run` 全绿（此前 10 failed 归零），断言语义正确（非仅改数字凑绿），`npm run verify`/`lint`/`build` 清白。

### F003 - 真机验收与独立签收（executor:evaluator）

以 fresh context 独立验收 F001+F002；在本机迁移 machine config 到 v1.7.0 契约后，对已认证 Kimi 执行一次真实 planner terminal-message bridge launch（brokered 凭据、无源码写入、证据脱敏），确认 RETURNED/completed + nonce receipt；运行 framework 聚焦 + 全量 npm test/verify/lint/build。全 PASS 后举 verifying-to-done 人工闸门。

## 3. 完成定义

三 feature 全 PASS + signoff + 人工闸门。push 会触发生产部署（framework-version.ts 行为变更），部署时机由用户决定。
