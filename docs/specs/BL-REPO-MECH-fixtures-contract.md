# BL-REPO-MECH 附录：contract-fixtures 接口（F002 测试实现依据）

> Planner 附录 · 2026-08-09 · 依据 harness-template v1.8.0（`4ac7a6f`）实物生成的金标。
> 沙箱内实现 F002 测试时以本附录为 fixture 接口的唯一事实源（沙箱读不到模板仓）。

## 环境变量契约（tests/contract/ 全部测试遵守）

- `CONTRACT_FIXTURES_DIR`：指向 harness-template 仓的 `contract-fixtures/` 目录。
  **未设置或目录不存在 → 整个 suite 用 `describe.skipIf` 显式 skip**（`npm run test` 全量不受影响）。
- 框架侧验签器从 fixtures 目录**派生**（fixtures 恒在模板仓内）：
  `$CONTRACT_FIXTURES_DIR/../templates/claude/console/validate-pending-gate.sh`（用法：`bash <脚本> schema|guard <progress.json>`；
  guard 的签名模式要求脚本同目录有 `console.pub`——测试须把脚本复制到临时目录并把测试公钥放为同目录 `console.pub`，
  先例见模板仓 `test-pending-gate.py`）。
- Ed25519 需 OpenSSL 3：探测顺序 `HARNESS_OPENSSL` → `/opt/homebrew/opt/openssl@3/bin/openssl` → PATH（先例 `tests/server/harness-sign.test.ts` 的 `findOpenSsl`）；
  验签器进程 env 须带 `HARNESS_OPENSSL`。探测不到 → skip 并输出原因。

## fixtures 目录布局与文件形状（v1.8.0 实物）

```
contract-fixtures/
├── fixtures.json                  # {schema_version:1, framework_version, schemas:{...sha256}, files:[...]}
├── canonical-json/vectors.json    # {"vectors":[{"name","input","expected"}]}——expected 为规范化后的精确字符串
├── keys/test-console.key|.pub     # TEST-ONLY Ed25519 密钥对（PEM）；测试签发用 .key、验签用 .pub
├── pending-gate/{valid,invalid}/*.json
└── mode-intent/{valid,invalid}/*.json
```

**pending-gate fixture 文件**：`{"name", "expect": "valid"|"invalid", "checks": ["schema"|"guard",...], "reason"?, "pending_gate": {...完整 pending_gate 块，decision 内含 sig...}}`
**mode-intent fixture 文件**：`{"name", "expect", "reason", "mode_defaults": {"intent": {...含 sig...}, "staged_at"}}`

## 三个测试文件的职责（spec §2 F002 的展开）

1. `tests/contract/canonical-json.contract.test.ts`
   逐条 vectors：`canonicalJson(input)`（`src/server/harness-sign.ts` 导出）的输出与 `expected` **逐字节相等**（含中文不转义用例）。
2. `tests/contract/sign-verify.contract.test.ts`（方向①：tokenizer 签发 → 框架验签）
   用 `keys/test-console.key` 作为签名私钥（`signDecision` 读 `HARNESS_CONSOLE_SIGNING_KEY`，支持 PEM 原文），
   对至少两个 decision 载荷（一个含中文 note、一个含嵌套 scope）签发 → 组装成 `{"status":"verifying","pending_gate":{...}}`
   写临时 progress.json → 框架 `validate-pending-gate.sh schema` 与 `guard`（签名模式）均退出 0；
   随后篡改任一已签字段一字节 → guard 必须非 0。
3. `tests/contract/fixture-ingest.contract.test.ts`（方向②：框架 fixture 灌 tokenizer 解析/验签面）
   - pending-gate：valid fixture 的 decision 经 `src/cli/harness.ts` 的中继验签路径（`verifyDecision` 若未导出则通过等价公开面：
     用 `canonicalJson` + node crypto `verify` 复算——与 `tests/server/harness-sign.test.ts` 既有做法一致）以 `test-console.pub` 验真；
     invalid 全部验假或被形状校验拒。
   - mode-intent：valid fixture 的 intent 过 `src/shared/harness-mode-intent.ts` / `src/server/harness-mode-intent-api.ts`
     的解析白名单（valid 全收）；invalid 的 extra-field / autonomy-extra 被白名单拒，tampered/missing-sig 验签必假。

## 边界

- 测试**只读** fixtures；不写模板仓任何文件；临时产物全落 `mkdtemp`。
- 不引入新依赖（node:crypto + child_process 足够）。
- CI 侧接线已就位（`.github/workflows/contract-conformance.yml`，本地无需关心）。
