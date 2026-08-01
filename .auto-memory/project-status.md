---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-NATIVE-SUBAGENT-BRIDGES（fixing，1/5，fix_rounds=0）**：默认 host-native fresh-context fan-out 已完成，F001/F003/F004 为 FAIL，F002 为 PASS，F005 为 PARTIAL。
- 独立 evaluator 与三份证伪复核一致确认：Kimi bridge 虽在 registry 声明，却被 strict-provider gate、目录、选择器和签发路径全部隐藏；当前没有可发布或可签发的 Kimi external same-session target。
- F003 还缺少可独立重验的 nonce/type receipt 字段，且 Kimi adapter 的临时凭据复制不满足 hostile-process 凭据隔离；这些是验收事实，不因局部协议测试通过而消失。
- F005 的全部 L1 已通过：Tokenizer 59 files / 865 passed / 4 skipped，verify、lint、build，以及 Framework bridge/catalog 71 项；真实 Kimi L2 probe 未获授权、未执行，因此不能 PASS。
- 原始 fan-out 与复核证据：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-fanout-2026-08-01.json`；schema verdict：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-verdict.json`。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。

## 已知边界

- 修复阶段必须先解决“规格要求发布 external bridge”与“当前 strict-provider fail-closed 策略”的冲突，再重新获取 Kimi 的真实、脱敏 parent-child 审计证据；不得以隐藏 bridge 或实施阶段叙述作为替代。
- 当前没有 done 人工闸门，也没有 mode intent；本轮未调用认证 Codex/Kimi 服务、未修改产品代码、未部署。
