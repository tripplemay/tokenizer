# BL-MODESCMD — `tokenizer harness --modes` 终端子命令

**批次类型：** 普通批次（单 feature）
**执行者：** 外部 generator（Codex，`local-cli`）—— 本批次同时是「外部 CLI 写代码」路径的首次验证

## 背景

模式指纹（`buildModeSnapshot`）已经在上报与控制台渲染上用起来了，但**终端里看不到**——
排查「这个项目为什么显示成手动模式」时只能去翻五个文件，或者像我这几天一样写临时脚本。

## F001 — `harness --modes` 打印本机各项目的模式指纹

在既有 `tokenizer harness` 子命令上新增 `--modes` 旗标：发现所有 harness 项目并逐行打印
框架版本 · 漂移计数 · 执行形态 · 自主开关 · dispatch 开关 · 闸门校验模式 · 机件在位数。

**验收标准（可机械核验）：**
1. `npx tsx src/cli/index.ts harness --modes` 退出码 0，每个被发现的项目输出一行
2. 输出中含框架版本与漂移数（如 `v1.4.2` / `定制 16`）、执行形态、闸门模式
3. `--modes` **不触发任何网络请求**（不上报、不拉决策）——纯本地只读
4. `--list` 与无旗标的既有行为**完全不变**（回归）
5. `npx tsc --noEmit` 干净；`npm run test` 全绿

**边界：** 只允许改 `src/cli/index.ts` 与新增 `src/cli/harness-modes-print.ts`；
不得改 `src/cli/harness.ts` / `harness-modes.ts` 的既有导出签名；不得碰 `app/` 与 `prisma/`。
