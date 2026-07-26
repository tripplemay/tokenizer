---
name: reference-docs
description: 项目文档结构及各类文档的查阅入口（按需加载）
type: reference
---

## 开发时主要查阅

- `docs/specs/` — 实现规格文档（Planner 写，Generator 读）
- `docs/dev/` — 架构详情、开发规则、CI/CD 等按需加载的子文档
- `design-draft/` — UI 设计稿（页面还原时参考）

## 测试相关

- `docs/test-cases/` — 测试用例文档（Evaluator 写）
- `docs/test-reports/` — 测试签收报告（Evaluator 在 reverifying→done 时写）
- `docs/test-reports/user_report/` — 用户反馈报告（Planner 在新批次启动时必读）

## 不需要主动阅读

- `docs/archive/` — 历史文档归档
- `docs/adr/` — 架构决策记录（按需）
