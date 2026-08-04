# BL-AGENT-RELEASE-ACCEPTANCE - Agent 1.2.0 / 1.2.1 发布验收

> **类型：** Evaluator-only 验收批次(全部 `executor: evaluator`,跳过 building)
> **日期:** 2026-08-04 · **Planner:** main context
> **背景:** 两个 Agent 发布的实现先于独立验收进入生产——1.2.0/capability 8(`c5fe6be`,2026-08-02 部署)与 1.2.1/capability 9(`bbb2c8b`,随 `a7bf556` 于 2026-08-04 经用户批准部署,含 `device_reporter_observability` 迁移)。本批次补上独立 fresh-context 验收,消费 backlog 条目 `BL-AGENT-CATALOG-RELEASE-RECOVERY` 与 `BL-AGENT-SINGLE-INSTANCE-LIFECYCLE`。

## 1. 验收原则

- Evaluator 以**磁盘代码、聚焦测试运行、生产实测**为准,不采信实现叙述与 commit message。
- 不修改任何产品代码;只写测试产物与报告。
- F003 涉及本机 daemon 升级,属真实系统状态变更:执行前记录当前状态(版本、PID、锁文件),失败须能回滚(`install.sh` 可重复执行);证据脱敏(不含 token 完整值,前缀展示是产品行为,可引用)。
- 生产实测限只读端点与设备页观察;不触发 mode intent 签发,不动 Harness 闸门。

## 2. Feature 验收标准

### F001 - Agent 1.2.0 / capability 8(目录兼容性恢复与升级判定)

对照 backlog 原决策逐条:

1. 旧 parser **不**回退兼容 `subagent:true` 布尔声明,不重新暴露不可信 external subagent 路由;
2. local-cli / A2A 目录恢复以 fail-closed 为前提(对象式 bridge 声明解析失败时目录退化而非放行);
3. `MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION = 8` 生效:capability < 8 的 reporter 无法承载工具绑定 mode intent,提示升级;
4. 控制台原因提示按「报告新鲜度 → 升级要求 → 版本核验 → 兼容但空目录」互斥有序。

### F002 - Agent 1.2.1 / capability 9(单实例生命周期与 reporter identity)

1. `agent-lock`:活 PID 拒第二实例、死 PID 回收、release 不误删后继锁(现有测试 + 独立核验);
2. `bin/tokenizer` wrapper 转发 SIGTERM/SIGINT 并等待 Node 子进程退出;
3. 服务端 harness report / relay / heartbeat / enroll:携带控制面语义的写入要求 reporter identity,过期 daemon 不能覆盖已接受诊断或控制面状态(serializable transaction);
4. 设备页显示被接受上报的 Token 前缀与时间(i18n 双语);
5. `MAX_AGENT_FEATURE_VERSION` 上限拒畸形 capability;
6. 生产 DB 已应用 `20260802000000_add_device_reporter_observability`。

### F003 - 本机升级真实链路

1. 记录升级前状态:`~/.tokenizer/app` 内容版本、daemon PID 树、agent.lock;
2. 执行 `install.sh` 升级链路;
3. 升级后:app 为 `a7bf556` 等效、旧 wrapper 与旧 Node 子进程均退出(无孤儿并发上报)、新 daemon 单实例持锁;
4. 新 Agent 上报 capability 9 且服务端接受;设备页/控制台不再提示升级;
5. 全过程证据(脱敏)落 `docs/test-reports/`。

## 3. 完成定义

三个 feature 全 PASS + 验收报告落盘 → 举 verifying-to-done 人工闸门。发现回归按事实记录并转 fixing(修复归 Generator,Evaluator 不修产品代码)。
