import { createPrivateKey, sign as edSign } from "node:crypto";

/**
 * harness 闸门决策的 Ed25519 签发。
 *
 * 为什么要签名：`pending_gate.decision` 是「人类批准」在机器侧仓库里的唯一表示。
 * 决策经 device agent 中继落到机器上，属于**本地写入**——若不签名，写代码的 agent
 * 也能走同一条路给自己盖章，「阶段推进键归人」就退化成自觉。
 * 服务端持私钥、公钥入项目仓库 `.claude/console/console.pub`：agent 读得到公钥，伪造不了签名。
 *
 * 校验方：机器侧 `.claude/console/validate-pending-gate.sh guard`（openssl 验签）。
 * Ed25519 是确定性签名，Node 与 openssl 对同一载荷产出逐字节相同的结果。
 */

/** 决策里参与签名的字段（`sig` 自身除外）。字段名用 snake_case，与 progress.json 一致。 */
export type HarnessDecisionPayload = {
  gate_id: string;
  action: "approve" | "reject";
  by: string;
  at: string;
  note?: string;
  scope?: { once?: boolean; expires_at?: string };
};

/**
 * 规范化 JSON：键**递归**排序 + 紧凑分隔符。签验双方必须逐字节一致。
 *
 * ⚠️ 必须递归：`scope` 是嵌套对象，只排顶层键会在它有多个键时（如同时带 once 与
 * expires_at）与校验侧的 Python `json.dumps(sort_keys=True)` 产生不同字节串，验签必失败。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export class HarnessSigningKeyMissingError extends Error {
  constructor() {
    super(
      "HARNESS_CONSOLE_SIGNING_KEY 未配置 —— 无法签发闸门决策。" +
        "用 gen-console-key.sh 生成密钥对，私钥经环境变量注入服务端，公钥提交进各项目的 .claude/console/console.pub。"
    );
    this.name = "HarnessSigningKeyMissingError";
  }
}

/**
 * 读私钥。接受两种形态的同一把 PEM：
 *   ① PEM 原文（本地开发直接 `export ...="$(cat console.key)"`）
 *   ② PEM 的 base64（**部署路径必须用这个**）
 *
 * 为什么要 ②：PEM 是多行的，而部署把环境变量写进 `.env` 交给 docker compose——
 * `.env` 不支持多行值，PEM 原文塞进去只会读到第一行 `-----BEGIN PRIVATE KEY-----`，
 * 表现为服务起来了、批准键却一直 503。压成单行 base64 是绕开这个限制的最短路径，
 * 也不必让部署脚本去做转义。
 */
function loadKey() {
  const raw = process.env.HARNESS_CONSOLE_SIGNING_KEY?.trim();
  if (!raw) throw new HarnessSigningKeyMissingError();
  const pem = raw.includes("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return createPrivateKey(pem);
}

/** 对任意 harness 载荷的递归 canonical JSON 签名，返回 base64。 */
export function signHarnessPayload<T>(payload: T): string {
  const key = loadKey();
  return edSign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64");
}

/** 对决策载荷签名，返回 base64。载荷 = 除 `sig` 外的全部字段。 */
export function signDecision(payload: HarnessDecisionPayload): string {
  return signHarnessPayload(payload);
}

/** 服务端自检：密钥是否已配置且可用。没配就别让人在 UI 上按下批准键。 */
export function signingKeyReady(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}
