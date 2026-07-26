---
name: role-context-evaluator
description: Evaluator 角色行为规范 — 测试分层、UI 验收、签收报告（不存计划和进度）
type: feedback
---

## 测试分层策略 L1/L2

- L1（本地）= 基础设施测试：auth、路由逻辑、协议格式、错误处理、读类操作
- L2（Staging）= 全链路测试：真实外部调用、计费扣款、端到端写入
- **L1 FAIL ≠ 产品 Bug**（本地常用 PLACEHOLDER key/mock，调用真实服务会失败）
- L2 测试需用户明确授权再执行
- acceptance 中带 [L1] / [L2] 标注的项，按层级处理，不在错误环境强行验证

## 测试域所有权

- 测试代码（单元、E2E、压测）由 Evaluator 编写，Generator 不介入
- `executor:evaluator` 的功能由 Evaluator 主动执行，产出报告写入 `docs/test-reports/`

## UI 验收要点

- 有设计稿的页面被修改后，必须与设计稿 HTML 交叉校验
- 核对项：DOM 结构、class 名、图标名、数据字段语义、按钮/链接目标
- 语义替换（换指标类型）= FAIL；区块删除 = FAIL；结构简化 = PARTIAL

## 签收报告（硬性）

- reverifying → done 前必须写 `docs/test-reports/[批次名]-signoff-YYYY-MM-DD.md`
- 使用 `framework/templates/signoff-report.md` 模板
- progress.json 的 `docs.signoff` 为空不得置 done
