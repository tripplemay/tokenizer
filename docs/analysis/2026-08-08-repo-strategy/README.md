# tokenizer 战略分析：双仓合并裁决与「agent 编程项目管理系统」升级路线

> 日期：2026-08-08 · 性质：独立分析任务（不触发状态机流转）
> 调查方式：11 个独立 agent（7 域读取器 + 3 视角裁判 + 1 路线图起草员），207 次工具调用，
> 覆盖 tokenizer（321 commits）与 harness-template（157 文件 / 30 tag）两仓全量 + 业界竞品调研。
> 原始材料见 `appendix/`。图形化版本（Artifact）：https://claude.ai/code/artifact/fc2e1f97-01e1-4a7f-a1ba-05ba0ff24d20
>
> ⚠️ 本目录暂未提交：`deploy-vps.yml` 的 paths-ignore 未覆盖 `docs/analysis/**`（只豁免
> specs / test-cases / test-reports 三个子目录），推送本目录会触发生产部署。
> 处理建议见 §4「顺带发现」。

---

## 0. 裁决摘要

**不建议合并两个仓库。** 三个互相独立的评审视角一致得出 keep-separate 结论
（发布工程 0.85 / 消费者运维 0.80 / 产品定位 0.72，全文见 `appendix/judges.json`）。

**「升级为 agent 编程项目管理系统」的方向值得全力做，且与仓库合并完全正交**：
升级所需的每一项能力都落在 tokenizer 产品仓内部；框架的中立标准层定位反而是
该产品最锐利差异点（独立性治理）的公信力来源。

双仓的真实摩擦用「三件增量机械化」消解（§3），不动分发契约的任何不变量。

## 1. 现状确认

- **用量统计域（原始定位）：成熟。** 5 家 CLI 采集（Claude Code / Codex / OpenCode / Aider / Kimi Code）、
  幂等入库、三级自动定价管道、多租户 + 时区 + i18n。短板：quota 仅 1 家 provider、
  `summaries.ts`（1128 行）无集成测试、/events 无分页、成本为 list-price 估算。
  详见 `appendix/reader-usage.md`。
- **控制台域（v1.3 起的第二身份）：骨架完整。** 八大能力已实装（进度镜像 / 人闸门生产实测 /
  mode intent v2 / 模式画像 / drift badge / sync health / dispatch 镜像 / 身份防降级）；
  P3 实时日志、P4 跨机调度设计已定未实装；三处「存而不显」（dashboardUrl / artifactPath / evidence 内容）。
  详见 `appendix/reader-console.md`。
- **生态事实：** 本机 9 个消费者项目的 harness.json 全部指向 harness-template；
  模板仓已是 77% 可执行代码的机件仓，几乎每个 patch 由下游真机踩坑回流驱动；
  tokenizer 服务端代码对 "harness-template" 零引用——两个身份只在闸门契约层隐性耦合。
  详见 `appendix/reader-ecosystem.md`、`appendix/reader-template.md`。

## 2. 不合并的六条论据（全文见 appendix/judges.json）

1. **分发契约当场断裂**：`harness.sh:92-93` 硬校验源树根目录 `harness/ + templates/`；
   合并后 `sync --ref` clone 产品仓根目录直接 die；实测 `cmd_sync` 不重写 source_url——
   9 份 harness.json 全要人工改；5 个消费者停在 v1.4.0 基线、2 个在 1.0.3，旧拷贝不认识新布局；
   degit 整仓会把控制台产品代码带进新项目底座。8 个下游强制 breaking migration，换第 9 个（tokenizer 自己）的便利。
2. **版本流混杂**：模板仓 30 tag 高频发布流 + release-contract CI vs tokenizer 零 tag 产品流；
   框架 tag 打在产品 commit 上，`--ref` 拉框架下载整个产品仓，上下游依赖方向反转。
3. **部署/CI 双向危险耦合**：模板仓 tests/scripts/console/archive/.github 不在 paths-ignore 内→
   一次框架 patch 部署一次生产；反向 paths-ignore 路径连 verify 都不跑→框架改动在合并仓获得零 CI，
   1.3 万行机件回归测试失去触发通道。
4. **账本语义反转**：`framework/` 从受管镜像（224 文件实测 100% 对齐）翻转为上游源本体，
   verify 会把上游编辑报成漂移，双 sha 账本 / FRAMEWORK_MIRROR / 仓内成对镜像全部要重定义。
5. **中立性瓦解**：console-mode.md:291-296 明确通道 B 实现「不属于本框架」；
   业界收敛形态是标准与平台分离（OTel / A2A / MCP；Vercel↔Next.js 双仓范式）；
   合并锁死商业化分层（框架开源引流 + 控制台开核收费）。
6. **治不了主要摩擦**：演进史 8 项摩擦（appendix/reader-evolution.md §5）主导成本源于
   「N 消费者各持物化副本」，与仓界无关；唯一独占收益（契约两侧同仓演进）有低一个数量级的替代方案。

## 3. 替代方案：三件增量机械化

1. **契约 fixture 化（框架仓）**：新增 `contract-fixtures/`——pending-gate / mode-intent schema 快照、
   金标签名载荷、canonicalJson 测试向量，随 framework-releases.json 逐版本发布，release-contract CI 校验。
2. **跨仓契约 CI（tokenizer）**：`contract-conformance` job——checkout 模板仓 @ `harness.json.framework.commit`，
   双向跑契约测试（服务端签发物过框架验签器；框架 fixture 灌进服务端解析器）。
   harness-console-demo 演练仓被 CI 取代后删除。
3. **版本测试去税（tokenizer）**：版本耦合测试改从 `framework/harness/framework-releases.json` 镜像
   动态生成期望值，消掉「每版必改 ~10 个测试」（BL-TOKENIZER-ADOPT-V170 实证）。

配套纪律：upstream-first 补丁（codex.json 三处各修一次的教训）；框架仓加本机批量升级脚本。
预留 hybrid 出口：未来若控制台需运行时 import 框架机件，抽「契约制品」小包（schemas + canonicalJson + 类型）
供两仓共同 pin——仍不合并全量仓库。

## 4. 顺带发现

- **paths-ignore 与 CLAUDE.md 不一致**：CLAUDE.md 称 `*.md` 已豁免，实际 deploy-vps.yml 只豁免
  根目录列举文件与 docs/specs|test-cases|test-reports。建议下批次二选一：扩为 `docs/**`，或修正 CLAUDE.md 表述。
- 三处「存而不显」与 harness-console-demo 清理（见 §1 控制台域、§3.2）。

## 5. 升级路线图（全文见 appendix/roadmap.md）

**战略判断**（appendix/reader-landscape.md）：纯用量统计被 ccusage + 厂商原生 dashboard 双向挤压；
纯编排看板被 vibe-kanban 占位。活路 = **成本归因 × 独立性治理 × agent 性能分析**的交集（全场空白，
且 tokenizer 是唯一把用量域与编排域放在同库同租户的产品，`HarnessProject.projectId → Project` 外键已在）。

| 阶段 | 批次 | 内容 |
|---|---|---|
| 近期（1–2 周期） | BL-GATE-INBOX | 全局闸门收件箱 + evidence 查看 + 三处存而不显补显 |
| | BL-TRANSITION-LOG | 状态流转事件表 + 阶段时间线（纯服务端，成本归因前置） |
| | BL-COST-BATCH-V1 | 成本×批次/阶段归因 v1（时间窗 join 版） |
| | BL-BUDGET | 预算表 + 75%/90% 告警 |
| | BL-AGENT-LATENCY | cron 双条目 + 轮询退避 + enroll 自愈 fetch；顺带 /events 分页 |
| 中期（3–6 周期） | BL-LIVE-SESSION | P3 兑现：有界日志 tail + live tab |
| | BL-STEERING-V1 | 签名任务指令通道（pause/cancel/note），复用 mode intent 骨架 |
| | BL-PERF-ANALYTICS | 批次历史归档 + 性能分析（一次通过率/返工轮数/每 feature 成本） |
| | BL-DEVICE-DECOUPLE | Device 表 harness 列拆表（两域最强耦合点，越晚越贵） |
| | BL-AGENT-SUPPLY-CHAIN | 安装锁 tag + sha 校验 + --purge 卸载 |
| | BL-QUOTA-PROVIDERS | Claude / Kimi 订阅配额 provider |
| 远期（6+ 周期） | P4 跨机调度 | dispatch 升级为派活通道，对齐 MCP Tasks / A2A 生命周期 |
| | 标准三件套 | OTel gen_ai.* 导出、A2A Agent Card 映射、AGNTCY 对齐 |
| | 看板编排面 | backlog→features 看板，拖卡触发 intent/派活（vibe-kanban 对标） |
| | 企业治理层 | 多操作员、审批分级、限期授权（expires_at 已留类型）、hooks 下发 |

**总原则**：近期全部「服务端 + UI 薄改动」（9 项目共用 agent 运输层且升级链路弱）；
中期先还两笔债再上双向通道；远期全部踩在 mode intent 已验证的签名下行骨架上。
