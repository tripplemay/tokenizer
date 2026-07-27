import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, signDecision, signHarnessPayload } from "@/server/harness-sign";
import type { HarnessDecisionPayload } from "@/server/harness-sign";
import type { HarnessModeIntentPayload } from "@/shared/harness-mode-intent";

/**
 * 闸门决策签名的跨语言契约测试。
 *
 * 为什么必须有：签名在这里产生（Node），却在**另一个系统的另一种语言里**验证
 * （机器侧 `validate-pending-gate.sh` 用 Python 规范化 + openssl 验签）。
 * 两边的规范化只要差一个字节，验签就必失败——而那会表现为「批准了却没生效」，
 * 极难排查。故把契约钉成测试。
 */

let dir: string;
let priv: string;
let pub: string;
let openssl: string;

function findOpenSsl(): string {
  for (const candidate of [
    process.env.HARNESS_OPENSSL,
    "/opt/homebrew/bin/openssl",
    "/opt/homebrew/opt/openssl@3/bin/openssl",
    "/usr/local/bin/openssl",
    "openssl"
  ]) {
    if (!candidate) continue;
    try {
      const algorithms = execFileSync(candidate, ["list", "-public-key-algorithms"], { stdio: ["ignore", "pipe", "ignore"] });
      if (algorithms.toString().toUpperCase().includes("ED25519")) return candidate;
    } catch {
      // Try the next standard OpenSSL 3 location.
    }
  }
  throw new Error("harness signing tests require an Ed25519-capable OpenSSL 3");
}

beforeAll(() => {
  openssl = findOpenSsl();
  dir = mkdtempSync(join(tmpdir(), "harness-sign-"));
  priv = join(dir, "console.key");
  pub = join(dir, "console.pub");
  execFileSync(openssl, ["genpkey", "-algorithm", "ed25519", "-out", priv]);
  execFileSync(openssl, ["pkey", "-in", priv, "-pubout", "-out", pub]);
  process.env.HARNESS_CONSOLE_SIGNING_KEY = execFileSync("cat", [priv]).toString();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 复刻机器侧 Python 的规范化：json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False) */
function pythonCanonical(value: unknown): string {
  return execFileSync("python3", [
    "-c",
    "import json,sys;print(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(',',':'),ensure_ascii=False),end='')"
  ], { input: JSON.stringify(value) }).toString();
}

const CASES: HarnessDecisionPayload[] = [
  { gate_id: "BL-042-verifying-done-w7", action: "approve", by: "yixing", at: "2026-07-25T00:00:00Z" },
  {
    gate_id: "g2", action: "approve", by: "yixing", at: "t",
    note: "已复核 verdict", scope: { once: true, expires_at: "2026-08-01T00:00:00Z" }
  },
  // 中文 + 嵌套多键 + 键序颠倒：ensure_ascii 与递归排序两处最容易出分歧
  { gate_id: "g3", action: "reject", by: "张三", at: "t", note: "证据不足：evidence 为空", scope: { expires_at: "x", once: false } }
];

describe("canonicalJson", () => {
  it.each(CASES.map((c, i) => [i + 1, c] as const))(
    "case %i 与机器侧 Python 规范化逐字节一致",
    (_i, payload) => {
      expect(canonicalJson(payload)).toBe(pythonCanonical(payload));
    }
  );

  it("递归排序嵌套对象的键（只排顶层会在 scope 多键时产生分歧）", () => {
    expect(canonicalJson({ b: 1, a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1},"b":1}');
  });

  it("忽略 undefined 字段（note 缺省时不得序列化成 null）", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("signDecision", () => {
  function verifyWithOpenssl(payload: HarnessDecisionPayload, sig: string): boolean {
    const p = join(dir, "payload.bin");
    const s = join(dir, "sig.bin");
    writeFileSync(p, Buffer.from(canonicalJson(payload), "utf8"));
    writeFileSync(s, Buffer.from(sig, "base64"));
    try {
      execFileSync(openssl, ["pkeyutl", "-verify", "-pubin", "-inkey", pub, "-rawin", "-in", p, "-sigfile", s], {
        stdio: "ignore"
      });
      return true;
    } catch {
      return false;
    }
  }

  it.each(CASES.map((c, i) => [i + 1, c] as const))(
    "case %i 的签名可被 openssl（机器侧校验器所用）验证通过",
    (_i, payload) => {
      expect(verifyWithOpenssl(payload, signDecision(payload))).toBe(true);
    }
  );

  it("篡改任一字段都会使签名失效 —— 含未参与业务判定的 scope 与 note", () => {
    const payload = CASES[1];
    const sig = signDecision(payload);
    expect(verifyWithOpenssl({ ...payload, by: "attacker" }, sig)).toBe(false);
    expect(verifyWithOpenssl({ ...payload, gate_id: "other-gate" }, sig)).toBe(false);
    // scope 曾因未纳入签名载荷而可被篡改成永久授权 —— 回归保护
    expect(verifyWithOpenssl({ ...payload, scope: { once: false } }, sig)).toBe(false);
    expect(verifyWithOpenssl({ ...payload, note: "改过的备注" }, sig)).toBe(false);
  });

  // 部署路径只能走 base64：.env 不支持多行值，PEM 原文进去只剩第一行 —— 服务能起，
  // 批准键却一直 503。这条钉住「两种形态签出同一把钥匙」。
  it("私钥可用 PEM 的 base64 提供（部署经 .env 注入时的唯一可行形态）", () => {
    const savedPem = process.env.HARNESS_CONSOLE_SIGNING_KEY!;
    const fromPem = signDecision(CASES[0]);
    process.env.HARNESS_CONSOLE_SIGNING_KEY = Buffer.from(savedPem, "utf8").toString("base64");
    const fromB64 = signDecision(CASES[0]);
    process.env.HARNESS_CONSOLE_SIGNING_KEY = savedPem;
    expect(fromB64).toBe(fromPem);                       // Ed25519 确定性签名
    expect(verifyWithOpenssl(CASES[0], fromB64)).toBe(true);
  });

  it("未配置私钥时抛错而非静默产出空签名（fail-closed）", () => {
    const saved = process.env.HARNESS_CONSOLE_SIGNING_KEY;
    delete process.env.HARNESS_CONSOLE_SIGNING_KEY;
    expect(() => signDecision(CASES[0])).toThrow(/HARNESS_CONSOLE_SIGNING_KEY/);
    process.env.HARNESS_CONSOLE_SIGNING_KEY = saved;
  });
});

describe("signHarnessPayload", () => {
  const modeIntent: HarnessModeIntentPayload = {
    intent_id: "intent-001",
    repo_key: "github.com/acme/tokenizer",
    expected_head_sha: "0123456789abcdef0123456789abcdef01234567",
    desired: {
      execution: {
        profile: "heterogeneous",
        role_assignments: { evaluator: "reviewer-kimi", generator: "builder-codex" }
      },
      autonomy: {
        enabled: true,
        expires_at: "2026-07-28T12:00:00Z",
        auto_cross: ["B", "A"],
        budget: { max_wakes: 8, max_tokens: 50_000, max_fix_rounds: 2, max_cost_usd: 10 },
        wake_interval_s: { verifying: 120, building: 60 },
        notify_on: ["done", "halt"]
      }
    },
    issued_by: "人类@example.test",
    issued_at: "2026-07-27T11:00:00Z",
    intent_expires_at: "2026-07-29T12:00:00Z"
  };

  it("canonicalizes a nested mode intent exactly like the harness Python verifier", () => {
    expect(canonicalJson(modeIntent)).toBe(pythonCanonical(modeIntent));
  });

  it("produces the same deterministic Ed25519 bytes as OpenSSL for a mode intent", () => {
    const payloadPath = join(dir, "mode-intent.bin");
    const opensslSigPath = join(dir, "mode-intent-openssl.sig");
    writeFileSync(payloadPath, Buffer.from(canonicalJson(modeIntent), "utf8"));
    execFileSync(openssl, [
      "pkeyutl",
      "-sign",
      "-inkey",
      priv,
      "-rawin",
      "-in",
      payloadPath,
      "-out",
      opensslSigPath
    ]);

    const nodeSignature = Buffer.from(signHarnessPayload(modeIntent), "base64");
    expect(nodeSignature).toEqual(readFileSync(opensslSigPath));
    expect(() =>
      execFileSync(openssl, [
        "pkeyutl",
        "-verify",
        "-pubin",
        "-inkey",
        pub,
        "-rawin",
        "-in",
        payloadPath,
        "-sigfile",
        opensslSigPath
      ])
    ).not.toThrow();
  });

  it("keeps signDecision as a behavior-preserving wrapper", () => {
    expect(signDecision(CASES[0])).toBe(signHarnessPayload(CASES[0]));
  });
});
