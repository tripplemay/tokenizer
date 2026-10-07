# B08 additive erratum: workspace ambiguity, revision conflict and rollback

> Planner 设计建议；未实现、未执行真实 PG 验收、不是正式 Evaluator verdict。
> 原提案保持原字节：`B08-event-project-cas-proposal-20261008.md`。
> 原提案提交 `0de8bb12a8d89240fb973bcd36069773c50dd36f`；产品只读基线 `029f6c53ea7193989643a1f2e4d23108ba0c9af5`。
> 本补勘不修改产品、原规格、状态、gate；不 push。以下规则需 Planner/人类确认后才能成为 Generator 的约束。

## 1. 必须先裁决的设计缺口

1. **路径绑定不可变不等于事件归属可证明。** 原 §5.2 使 `(tenant,device,path)` 永久指向 A；B 复用路径后保留此 binding，随后缺 repoKey 的事件仍被无条件归 A。不能改用最后见到的 B：历史积压/乱序同样会错归。
2. **第一次同 tuple 不同 hash 的并发 insert 仍存在 first-commit 偏置。** “不覆盖已存值”成立，但“不按到达时间择胜”如果意指最终全局无赢家，则现状态机不成立。必须选择 accepted-first + 显式争议标记，或更复杂的冲突候选集合/消解流程。
3. **安全 rollback 是可写能力边界，不是 nullable schema 兼容。** 已 versioned / ambiguous 的数据不能重新进入旧无条件 correction / 路径 adoption 的写路径。

这些是设计补勘，不把未来风险描述成已上线产品行为或已通过 PG 测试。

## 2. §5.2 补充：稳定实体、repo 观察、归属权限必须分离

### 2.1 原规则的最小反例

| 输入顺序 | workspace identity | repo projects | 原规则事件归属 |
| --- | --- | --- | --- |
| 设备 D 的路径 P，repo=A | P -> PA | PA | A 事件 -> PA |
| 同 D/P，repo=B | 仍 P -> PA | PA、PB | B 事件 -> PB |
| 同 D/P，无 repoKey | 仍 P -> PA | PA、PB | **错误确定性：缺证据事件 -> PA** |

没有 repoKey 时，单凭同一路径不能区分旧 A 积压、新 B 当前事件、第三个未见到的 repo C，或非 Git 项目。`occurredAt` / 到达时间 / parser revision 都不是 workspace incarnation 的证据。不能借它们构造时间区间猜测 A/B。

### 2.2 最小强制修正与推荐默认

**最低强制规则：** 一旦同设备路径观察到不同 repo，永久进入 `ambiguous`；常规 ingest 不自动清除。缺 repoKey 的新事件必须 `projectId=null`，或明确独立的 workspace-only 类别；不能返回 PA/PB，不按 first/last arrival 自动 rebind。保留 workspace/path 字段以供展示，但不增加伪 repo 证据。

**推荐默认更保守：** 缺 repoKey 且该 workspace 已出现 repo 绑定时，即使目前只见过 A，也默认 `projectId=null`。因为 A 被 B 替换但 B 的显式证据尚未到达时，单 repo 观察也不能证明归属。若产品选择继续允许“尚未观测碰撞时复用 A”，必须明确标记为 weak/path-inferred，而非宣称保证同路径复用安全；该例外须有人类决策，不能由实现者静默选择。

若未来需要缺 repoKey 仍可靠归属，应增加设备签发的稳定 workspace-incarnation/witness，并明确生命周期、重装、目录替换、签发权限和历史上传语义。它是新的身份协议，不能拿 event message revision 或路径本身充当。

### 2.3 最小状态表（推荐保守方案）

对服务器派生的 `(userId, authenticated deviceId, workspace key)`：

| 状态 | 新输入 | 新状态 / 对新事件的 projectId | 历史操作 |
| --- | --- | --- | --- |
| absent | 无 repo、有 path | workspace-only W；事件 -> W | 无 |
| absent | repo A、有 path | repo-observed(A)；事件 -> PA | 无 |
| workspace-only W | 无 repo | W；事件 -> W | 无 |
| workspace-only W | repo A | 记录观察 A；事件 -> PA | **有历史行的 W 不自动晋升/改名为 A** |
| repo-observed(A) | repo A | 不变；事件 -> PA | 无 |
| repo-observed(A) | repo B | ambiguous(A,B)；事件 -> PB | PA/W/历史事件均不变 |
| repo-observed(A) | 无 repo | 不变；事件 -> null（推荐） | 无 |
| ambiguous | 任意显式 repo R | 记录 R；事件 -> PR | 不 rebind / 不清 ambiguous |
| ambiguous | 无 repo | 不变；事件 -> null | 无 |
| 任意状态 | 无 repo、无 path | 不造 name identity；事件 -> null | 无 |

repo identity 返回 canonical Project；workspace identity 保存稳定路径实体/legacy binding；另有小型 workspace-resolution 状态或 repo-observation 集合。可采用 `resolutionState + resolutionVersion + observed repo associations`，具体 schema 可由 Generator 提案，但不能把“计数/状态可变”实现成“projectId 无条件重绑”。

CAS 强制条件包括 tenant/device/key、expected resolutionVersion、当前状态；ambiguity 单调增加。hash 命中必须再比 canonicalValue。workspace state、repo observation 和新事件 insert 在同一 Serializable 事务中落盘，避免两个请求各见一个 repo 都把路径当 unambiguous。

### 2.4 resolver 不能有跳过观察的 fast path

- 即使 repo identity 已存在，仍需处理此次 workspace 观察。原“查 repo，存在即返回”不能绕过 A/B 碰撞标记。
- 每个 distinct `(device,path,repo)` 观察都要处理；不能沿用现行 `projectByKey` 每 repo 只取第一行 sample 的优化，否则一个 batch 中同 repo 的多个 workspace 被漏记。
- 同 batch 同路径含 A/B 和缺 repo 行，先合并观察、确定 ambiguous，再做缺 repo 行决策；排列任意行顺序结果相同。
- 对已有事件的 stale/duplicate/correction，不可用本次重采集的当前目录/remote 随意改历史 attribution。只有被批准的独立 attribution 事务才能改 projectId。
- path key 规范化须版本化：Windows case/separator/UNC 与 POSIX 大小写规则应有明确契约；服务器不能 realpath 客户端路径。只变 alias key，不重写旧 sourceEventId/队列/cursor。无效 canonicalValue 不按 name 兜底。
- 新 identity FK/约束必须证明 Project、workspace scope device 与 userId 同租户；仅给每步 WHERE 加 userId 不足以防迁移/脚本写入跨租户绑定。

### 2.5 promotion 与历史语义冲突须显式裁决

原 §5.2 的 W -> A 保持 Project ID，却改变所有既有无 repo 行所显示的项目名称/repo 归属与聚合。这不是“没有 UPDATE UsageEvent 就没有历史影响”。

推荐只允许 **无历史 UsageEvent 的空 W** 自动 CAS 晋升；有历史行的 W 留为 workspace-only，新显式 A 事件进独立 PA。若产品坚持已有 W 自动晋升，必须接受并写清“历史缺证据事件被路径推断归 A”的弱语义；或移到 digest-confirmed、逐行 preview 的独立历史审批中。不能同时承诺“不猜缺 repo 历史”与“所有已有 W 无条件自动晋升”。

## 3. revision tuple/hash 的补充裁决

### 3.1 同序列冲突和首次并发

建议定义：tuple `T=(server scheme rank, sequence)` 只排序；hash H 只判相等，不择胜。

| 存储状态 | incoming | 决策 |
| --- | --- | --- |
| 无行 | T,H | insert；明确是 accepted-first，不是全局无偏证明 |
| 已存 T,H | 同 T/H | duplicate，不重复写 |
| 已存 T,H | 同 T、不同 H | conflict；不覆盖 projection，记录 dispute evidence/state |
| 已存 T,H 且 disputed | 同 T 任意 H | 不静默清 dispute；相同已存 H 可幂等 ACK，但 UI 不假称冲突消失 |
| 已存 T,H | 更高合法 T' | 可 CAS 接受；是否关闭旧争议须定义审计规则 |
| 已存 T,H | 更低 T' | stale，无 usage/project mutation |

两 writer 首次并发插入同 T 不同 H：任一可能先写；另一返回 conflict。若业务要求两种调度顺序的最终“可信状态”相同，必须有可持久化 dispute 状态/候选哈希，使两种顺序均 `disputed=true`。仅客户端 quarantine 无法让其他客户端、UI、后续重试知道服务端争议。是否暂停争议行的成本汇总是产品决策，不能默默当 authoritative。

原 §8.1 “rev1/rev2 每轮最多一次 accepted mutation”过强：rev1 insert 后 rev2 update 合法产生两次 mutation；rev2 先 insert 后 rev1 stale 只有一次。应断言最终最高 tuple、每 tuple 的 CAS 不重复、每次实际 mutation 的计数及提交后失效准确，不错误要求两种调度完全相同的 mutation 次数。

### 3.2 projection 与版本

- 固定字段顺序不够：minimized rawJson 的嵌套对象需递归 canonical key order，明确 missing/undefined/null、JSON 数字与 -0、decimal/null 行为。hash 必须覆盖实际 SET 的完整 mutable projection；不能 hash 一个值而 UPDATE 另一个 normalization 结果。
- 明确 `payloadHashScheme` 持久化或固定版本兼容策略。新 server 变更 projection/hash 版本，不能将旧行同 tuple 误报冲突，更不能偷偷重算旧 hash 成为新的真源。
- source 内不同 scheme 若 rank 相同，须证明语义可比较且列出别名；建议 server 常量保证 rank 唯一。更高 rank 的部署不能被旧 binary 的旧 rank 表降级。
- 同 batch structural invalid revision -> B06 400 reject-before-write；semantic equal-tuple/different-H -> revision outcome conflict。原 §3.1/§4 的 HTTP400 与逐行 conflict 语义需分开。
- 最大 tuple 有多个 H 时，该 key 不落 usage/project mutation；独立其他 key 可按明确的 partial protocol 成功。低 tuple 行 disposition 仍须逐 index 给出，不能只返回折叠后的一个 winner。聚合 received/duplicate/stale/conflict 的算术须写清。
- server unique key 必须在 Codex canonical sourceEventId 转换后比较；原 wire ID、canonical ID、outcome index 的映射须保留，不用不可信原 wire ID 推计数。
- 冲突保留至少包含 exact version/hash scheme/tuple/有限候选证据；本地 quarantine 只按 source+ID 去重会吞新版，不能作为 B08 的默认设计。bounded 超限必须明示策略，不可无日志丢掉未 ACK 的修正。

## 4. 迁移/backfill/rollback 必须补齐的围栏

1. additive FK/CHECK 覆盖 identity kind/scope、tenant ownership、revision 全空/全有、hash scheme/rank compatibility；DDL/索引锁在真实 PG副本测，不由 Prisma schema 文本推断安全。
2. M2 从历史 event 所指 **Project ID 唯一** 并不足以证明 workspace repo 唯一：现行 resolver 可能先把 Project A 原地改成 B，A/B 事件现在都指同一个 ID。backfill 必须比较历史 event.repoKey 的 distinct 值、Project.repoKey、canonical repo aliases；不同 repo 或矛盾 -> ambiguous/manual-review，不建立可信单 repo路径归属。
3. 只有缺 repo 行、没有明确不同 repo，不代表能从当前 Project.repoKey 推出历史 repo。历史含同路径 A/B + 缺 repo 行，保留缺证据行，不使用最近事件/当前remote补齐。
4. backfill digest 除范围/计数，还绑定 exact row IDs、canonical inputs、expected row/version/link/hash、policy/version、chunk watermark。数量不变但成员/数据变化必须 stale。执行 reread + CAS；不让 ingest 与 backfill 各自无条件写。
5. 每 chunk 事务记录 before/after mapping + run ID，second run 0 mutation；缺/冲突 evidence 不被 next-run 自动消掉。审计默认只写 bounded tenant counts、row IDs/key hashes。
6. attribution rollback WHERE 不只钉 expected projectId：还有 attributionVersion/runId 或等价 revision fence，防止 PA -> PB -> PA 的 ABA、操作员后续合法移动又被旧rollback覆盖。冲突行 skipped，不强制回退。回滚后仅对实际改变 tenant失效。
7. revision rollback 保留tuple/hash/dispute及比较器；legacy stream不得覆盖 versioned 行。无法保证的旧 binary只能读/暂停 ingest，不能以“列兼容”继续写。关闭 capability enforcement不等于解除 version fence。
8. project rollback保留 ambiguity/no-repo拒推规则、不同repo guard。不能回退到当前路径catch或首次workspace binding直归A的分支。回滚到未具备围栏的server前暂停所有usage writers与后台重放。
9. 模式切换必须对请求/事务钉一个完整policy version，避免路由新版校验、resolver旧版规则、callback新版计数混合。dual-read fallback在ambiguous/conflict上fail-closed，不能绕新表回旧workspace unique。

## 5. 实施建议与未决项

原 S1 仅修不同 repo catch + revisionCAS，不等于完整路径归属安全。S1 应明确禁止“没有identity状态时仍保证缺repo事件正确归属”的交付措辞；S3启用resolver前先落实本补勘状态/观察规则。

必须由 Planner/人类裁决：单 repo 观察后缺 repo 的强/弱默认；已有 W 自动promotion的历史影响；服务端 dispute储存/展示/汇总规则；hash版本升级策略；backfill与rollback审计保留期限。

真实 PG16 验收场景另见 `docs/test-cases/B08-design-erratum-pg16-plan-20261008.md`。它是待执行方案，不是已运行成绩。不能用本补勘文件、模型状态表或同家族review冒充实现或跨家族签收。
