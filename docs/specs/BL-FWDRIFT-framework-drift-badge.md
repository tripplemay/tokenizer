# BL-FWDRIFT — 控制台显示「框架落后 N 版 + 升级指引」

**批次类型：** 普通批次（全 `executor: generator`）
**规格状态：** 用户已确认（2026-07-26）

---

## 1. 背景

P1 模式画像上线后，控制台能显示每个项目的框架版本（`v1.0.3` / `版本未知` / `v1.4.0`），
但**看不出这个版本意味着什么**——落后多少、要不要升、怎么升，都得人去翻 CHANGELOG。

实测数据说明这不是理论问题：9 个 harness 项目里 1 个在 v1.4.0、3 个停在 v1.0.3、
5 个连基准版本都推断不出来。**下一步「推广到其他项目」需要的正是这张落后清单。**

## 2. 目标

在 `/harness` 的项目卡片上，把框架版本从「一个字符串」变成「一个判断」：

- 落后：`v1.0.3 · 落后 8 版` + 升级命令
- 最新：`v1.4.0`（无额外噪声）
- 未知：`版本未知` + **重建账本**指引（**不是 adopt**——见 §4 F003 的修订说明）
- 超前（项目比服务端已知的最新还新）：如实显示，不谎报落后

## 3. 非目标

- **不做一键升级**：`sync` 会遇冲突并需要人判断每处本地定制的去留，那是 P2 签名意图的范畴
- 不在服务端解析框架仓库；已发布版本清单以常量维护（与 `AGENT_FEATURE_VERSION` 同一套做法）
- 不改 agent 侧上报格式（`modes.framework.version` 已够用）

## 4. 特性拆分与验收标准

### F001 — 框架版本比较工具（`src/shared/framework-version.ts`）

已发布版本清单常量 + 语义化比较 + 落后版本数计算。

**验收（可机械核验）：**
- `compareFrameworkVersion("1.0.3", "1.4.0") < 0`；`("1.4.0","1.4.0") === 0`；`("1.5.0","1.4.0") > 0`
- `versionsBehind("1.0.3")` 返回该版本在清单中距最新版的**发布次数**，不是数值差
- `versionsBehind("unknown")` / 非法输入 → `null`（不猜、不报 0）
- **（fix_round 1 新增）** 前导零属非法：`01.0.3` / `1.00.3` / `1.0.03` 一律 `null`，
  且 `versionsBehind` 不得给出次数。初版只校验「全是数字」，`Number()` 吞掉前导零后
  `join` 又命中发布清单 → 非法版本被报成「落后 9 版」（Codex 实测抓到）
- `versionsBehind("9.9.9")`（超前/清单外）→ `null`，且 `isAhead` 为真
- 清单末位必须等于 `LATEST_FRAMEWORK_VERSION`（防清单与常量漂移的自检测试）

### F002 — 版本判断接入渲染链路

**（fix_round 1 订正）** 初版描述写「页面算好落后信息再传给徽章」，而验收标准只写了
tsc + 空值安全——**描述与验收标准自相矛盾**，两家 evaluator 因此给出相反结论（Codex 按描述
判 FAIL，Kimi 按验收判 PASS，两家都没错）。裁决：判断逻辑**留在徽章组件内**（它是唯一消费者，
更内聚；页面不该承担展示分支），描述随之订正。

`frameworkStanding()` 在 `app/harness/mode-badges.tsx` 内调用，页面只负责把 `modes` 传进来。

**验收：** `npx tsc --noEmit` 通过；页面对 `modes` 为 `null`（老 agent）时不得抛错；
版本判断不得散落在多处（`frameworkStanding` 的调用点有且只有一处）。

### F003 — 徽章渲染四种状态 + 指引（中英）

**验收：**
- 四种状态各有独立文案；`messages/zh-CN.json` 与 `messages/en.json` 的
  `harness.modes` 下键集合**完全一致**（缺键会在运行时抛 `MISSING_MESSAGE`）
- 落后时给出可复制的升级命令（含 `harness.sh sync`）
- **（fix_round 1 订正）** 「未知」要分两种，给的命令必须**真的能跑**：
  - `framework === null`（无账本）→ `harness.sh adopt` 命令
  - `version === "unknown"`（有账本但基准线推断不出）→ **重建账本**命令
    （`rm harness.json harness.lock && … adopt --as <确认后的版本>`）。
    初版要求这里也给 `adopt`，但 `adopt` 在 `harness.lock` 已存在时会直接拒绝执行——
    **那是一条跑不通的建议**，两家 evaluator 都指出了这点。

### F004 — 回归测试

**验收：** `npm run test` 全绿；新增用例覆盖 F001 的全部分支（含 unknown / 超前 / 清单外）；
总用例数不少于当前 392 + 新增数。

## 5. 铁律核查

| 铁律 | 本批次的落点 |
|---|---|
| 1 结论须有证据 | 落后判断来自版本清单常量，不靠推测；清单与常量一致性有自检测试 |
| 2 不臆造 | 未知版本一律显示「未知」并给 adopt 指引，**不默认成最新** |
| 9 数据流终点验证 | 验收要检查**页面实际渲染出的文案**，不止函数返回值 |
| 12 机械回写 | 验收结论由外部 evaluator 落成 verdict 工件，本地逐字读取回写 |

## 6. 车道与编排

**本地异构 + fan-out 对抗复核**：generator = 主实例（claude）；evaluator = **Kimi 与 Codex 各跑一遍**
（`local-cli` transport，两者 `model_family` 均与 claude 不同，满足独立性铁则第 5 条）。
两份结论不一致 → 举 `debias_conflict` 闸门停机交人裁决。

**闸门：** `verifying → done` 为 Class B 迁移，举 `phase_advance` 闸门，由人在控制台批准。
