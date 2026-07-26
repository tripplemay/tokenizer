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

## CI 守门（铁律）

- 每次 `git push origin main` 后必须检查 CI（可后台 `gh run watch`，期间可继续工作）
- CI 红色 → 立即停止新功能，先修复 CI；通过后才继续下一个功能

## IA refactor redirect scope 评估（v1.0 — BL-064 沉淀）

- 老路由 redirect 前先核 destination route 的 **wire-readiness**：目标路由已 wire 等效或更优功能才启 redirect
- destination 仅 embed-old 占位时，redirect 只是 URL 换名 → 用户认知混乱，**kept 旧路由更优**，推迟到目标 wire 后的批次再启
- 实装中发现 redirect 该缩减 → 主动停下走 partial-pending 裁决（pre-impl-adjudication.md §11）；此类 scope 缩减是良性 fix-round，不计质量问题
