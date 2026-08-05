---
name: role-context-generator
description: Generator 角色行为规范 — 设计稿还原、编码约定、回归测试沉淀（不存计划和进度）
type: feedback
---

## 设计稿还原规则

- 实现 UI 页面前必须先 Read 设计稿 HTML，做 1:1 翻译
- 唯一允许改动：硬编码文本→i18n、硬编码数据→API 绑定、HTML→React 组件、静态→交互
- 禁止：替换指标类型、替换图标、删除原型区块、改变链接语义
- 不得修改已有设计稿页面的布局结构，除非 Planner 明确标注为「布局变更」

## 编码约定

- Schema 变更 + migration + 引用代码必须同一 commit
- git pull 后 schema 变了必须重新生成 ORM client（如 `npx prisma generate`）
- JSON 状态文件（progress.json / features.json）必须使用 ASCII 双引号 `"`，禁止中文弯引号 `""`
- 提交前确认代码可运行，不提交无法运行的代码

## 回归测试沉淀（硬性）

- 修复来自审计 / Evaluator 反馈的 critical/high 断言时，**必须在同一个 commit 中**补充 regression test
- 测试用例必须能对比修复前（失败）和修复后（通过）
- 测试代码由 Generator 提供脚本/调用，但执行权归 Evaluator（测试域所有者）
- 这是 acceptance 的一部分，Evaluator 验收时会检查

## 交付叙述纪律（铁律 13 — M4.7 沉淀）

- `generator_handoff` / commit 正文里每句「已修 / 已验证 / 已移除 / 全绿」，落笔前必须有对应命令输出作依据（`git show --stat` / `grep` / 实跑）；拿不出就如实写「未核」
- 反面：M4.7 连续三轮 4 例交付叙述被复验证伪（「只改了 X 与 Y」而提交无 X；「摘掉某行全量无一条会红」实测 1 条翻红）

## CI 守门（铁律）

- 每次 `git push origin main` 后必须检查 CI（可后台 `gh run watch`，期间可继续工作）
- **watch 必须 `--workflow CI` 过滤 + 结束后显式核 conclusion**（v1.0.9：不过滤会抓到同 SHA 其他 workflow 的 exit 0 掩盖红灯——M1-C 曾因此漏看两个 feature 的 Build failure）
- CI 红色 → 立即停止新功能，先修复 CI；通过后才继续下一个功能
- **探针/测试漂移扫描（v1.0.5 — GO-LIVE 沉淀）：** redirect 落地同批必须 grep 重指所有引用旧路由的探针与测试——`tests/visual/*.spec.ts` 的 route/selector、`docker-compose*.yml` / `.github/workflows/deploy*.yml` 的 healthcheck 路由、任何 `curl <旧路由>` 探针。此类失效**延迟暴露**（自身 CI 可侥幸绿，后续无关 push / 首次部署才红），不得留给后续批次撞见

## IA refactor redirect scope 评估（v1.0 — BL-064 沉淀）

- 老路由 redirect 前先核 destination route 的 **wire-readiness**：目标路由已 wire 等效或更优功能才启 redirect
- destination 仅 embed-old 占位时，redirect 只是 URL 换名 → 用户认知混乱，**kept 旧路由更优**，推迟到目标 wire 后的批次再启
- 实装中发现 redirect 该缩减 → 主动停下走 partial-pending 裁决（pre-impl-adjudication.md §11）；此类 scope 缩减是良性 fix-round，不计质量问题
