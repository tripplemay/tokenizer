# Memory Index

## T0 — 每次启动必读
- [项目状态快照](project-status.md) — 当前批次、计划、决策、遗留问题（覆盖写，≤30 行）
- [环境信息](environment.md) — 生产/Staging 地址、服务器配置、测试账号

## T1 — 按当前角色加载
- [Generator 行为规范](role-context/generator.md) — 编码约定、设计稿还原、回归测试沉淀 | 加载：角色为 Generator 时
- [Evaluator 行为规范](role-context/evaluator.md) — 测试分层 L1/L2、UI 验收、签收报告 | 加载：角色为 Evaluator 时
- [Planner 行为规范](role-context/planner.md) — 需求处理、角色分配、done 收尾、框架维护 | 加载：角色为 Planner 时

## T2 — 触发条件命中时加载
- [用户角色与工作方式](user-role.md) — 用户身份、技术背景、沟通偏好 | 加载：需要调整沟通风格时
- [文档结构与查阅入口](reference-docs.md) — docs/ 各子目录用途 | 加载：需要查找文档时
- [技术域 pattern 库](../framework/patterns/README.md) — 部署/DB/LLM 集成/UI 还原/i18n/测试环境实战坑 | 加载：按索引表触发条件命中时

<!-- 后续可按需追加 feedback-*.md / reference-*.md 条目 -->
<!-- 格式：- [标题](文件名) — 一行描述 | 加载：触发条件 -->
