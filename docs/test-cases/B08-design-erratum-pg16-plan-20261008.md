# B08 erratum: real PostgreSQL 16 acceptance plan (NOT RUN)

> Planner 设计验收方案；当前基线未实现此模型，以下所有结果都是必须满足的预期，不是实测 PASS。
> 使用 migrated scratch PG16 + 真实 Prisma/HTTP/事务；不得以mock存储或sleep概率并发替代。

## Harness prerequisites

- 固定 product/server SHA、migration SHA、scheme/hash/policy版本、Node和PG版本。
- scratch tenant T1/T2，各有受token约束的D1/D2；Project PA/PB/PW固定ID。
- 使用 SQL/应用可控屏障，在 SELECT后、INSERT前、CAS前、COMMIT前暂停writer；交换明确提交顺序。记录每连接 txid/隔离级别、返回值、P2034/P2002重试次数与最终行。
- 重试整个事务并重新resolve，不重用前次read的Project/tuple。无网络/cache副作用在可重试事务内发生。
- 每case独立seed/reset；确认HTTP逐indexoutcomes覆盖全部请求；取前后数据库快照，核验UsageEvent/Project/identity/observation/dispute审计、token/device/timezone副作用。
- cache验收须真实Next+PG；仅mock invalidate回调是单测，不替代提交后freshness。

## Project state cases

| ID | Seed/input/barrier | 必须断言 |
| --- | --- | --- |
| P01 | D1/P: A -> B -> no-repo，各不同新event ID | PA/PB分离；第三行null/明确workspace-only，绝不PA/PB；A历史不变；ambiguity持久 |
| P02 | repo PB已由D2建好，再D1/P先A后B | repo fast path也更新workspace ambiguity；缺repo仍不归A |
| P03 | 同batch同D/P，A/B/no-repo的全部6种排列 | 结果同P01；无repo不依赖行序；每观察都保存 |
| P04 | 一个batch repo A出现多个path，再path P出现repo B | 不因按repo取首sample漏记P；P ambiguous |
| P05 | 同D/P的A/B两个事务均在workspace-read后暂停；分别让A/B先提交 | 最终两个repo；ambiguous；无repo不归任一；无cross-history；CAS/retry count实录 |
| P06 | 两设备同path、无repo；两tenant同repo/path | workspace独立；repo仅tenant内归并；任何跨tenant identity FK写被拒 |
| P07 | PW含历史无repo行，再输入A | 按已批准promotion策略：推荐PW历史名/归属不变，新行PA；若另选弱语义，preview/audit明确历史受影响 |
| P08 | PW空；并发A/B promotionCAS | 最多一个empty-PW晋升，另一repo独立；最高resolutionVersion、ambiguity，无丢observation |
| P09 | ambiguous已有，旧no-repo积压/explicit A/B迟到/无path同名项目 | ambiguity不清；有明确repo按repo；缺repoUnknown；不按name或arrival合并 |
| P10 | hash collision强制fixture，canonicalValue不同；Windows/UNC/case key契约fixture | collision拒归并；bytes/tenant/device核验；客户端event ID不重写；平台不符合预定契约即fail-closed |

## Event revision/hash cases

| ID | Seed/input/barrier | 必须断言 |
| --- | --- | --- |
| E01 | rev1/rev2同ID；分别先低后高、先高后低 | 最终rev2；mutation数允许2或1，实际RETURNING计数准确；低尾部stale |
| E02 | 空行，同T不同H同时insert；两种先提交顺序 | 后者conflict不覆盖；两轮均持久disputed；禁止宣传无偏authoritative结果 |
| E03 | 同T同H不同嵌套JSON key顺序、missing/null契约fixture | canonical规则一致时duplicate；规定不同者conflict；hash对应实际SET值 |
| E04 | 同ID最大T有两H，同batch夹其他key、低T | 冲突key0 mutation；其他key按协议成功；每index明确，聚合算术一致 |
| E05 | rev2=1000 -> rev3=900，legacy尾部重试 | 900合法接受；legacy不能覆盖；真实Next成本下降可见 |
| E06 | stale/duplicate event带不同当前repo/path/git；以及新明确repo观察 | usage immutable attribution不改；duplicate不悄悄重绑；合法新event观察独立处理 |
| E07 | invalid sequence/越int64/source-scheme mismatch/capability缺revision | HTTP400在device/token/timezone/project/usage写之前；PG所有before/after快照一致 |
| E08 | hash方案升级/旧比较器rollback/同rank不同scheme | 仅批准迁移能变化scheme；不偷偷hash重算；旧writer被fence或暂停 |
| E09 | conflict队列同source+ID的两个不同版本，partial/rowless响应及崩溃 | exact两version可恢复；畸形outcome不清queue；上界超限不隐式丢未ACK数据 |

## Migration/rollback cases

| ID | Seed/input/barrier | 必须断言 |
| --- | --- | --- |
| M01 | 一个Project曾A->B原地改写，历史A/B事件都指同Project | M2不能因distinctProjectId=1创建可信单repo路径；报告ambiguous且无自动winner |
| M02 | 同workspace含A/B/no-repo；dry-run后等数量替换成员/修改repo evidence | execute digest stale；0chunk写；no-repo历史保持 |
| M03 | backfill与ingest于同identity concurrent；chunk事务commit前kill连接 | 无半chunk；重读后CAS；重跑0mutation；冲突报告稳定 |
| M04 | moved PA->PB，后来人工合法PB->PA，旧rollback再执行 | ABA fence拒覆盖；skipped统计正确；非只比projectId |
| M05 | 将resolver切旧fallback，在ambiguous+versioned数据上发旧Agent | 不绕identity/rank围栏；不能安全写时503/暂停；schema兼容不等于可写 |
| M06 | 复制批准规模scratch，执行additiveDDL/索引/tenantchunk及恢复 | 锁时长/行数/计划/恢复hash实录；无生产推断；仅实际变化tenant cache失效 |

## Evidence / release boundary

每case产物包含请求hash、返回indexdispositions、SQL前后快照hash、事务调度、行级CAS计数、冲突原因、rollback实际moved/skipped。默认不输出原始client路径/remote/正文，仅syntheticfixture可全输出。

真实PG case不得skip；平台identity/Agent队列另有nativeLinux/Windows验证。失败应给最小重跑脚本及reset命令。最终须不同模型家族fresh Evaluator签收；本设计文档不授予迁移或生产批准。
