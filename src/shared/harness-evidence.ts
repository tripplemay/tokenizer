// BL-GATE-INBOX F003：闸门 evidence 路径分类纯函数。
// 输入已被服务端上报解析限幅（≤50 条、每条 ≤512 字符），此处仍做防御性收敛。

export type EvidenceKind = "repoDoc" | "path";

export interface EvidenceItem {
  raw: string;
  kind: EvidenceKind;
}

const MAX_EVIDENCE_LENGTH = 512;

/** docs/ 前缀 → 仓库取证文件（通道 A console/server.py 的可读域）；其余按普通路径呈现 */
export function classifyEvidence(value: unknown): EvidenceItem | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > MAX_EVIDENCE_LENGTH) return null;
  return { raw, kind: raw.startsWith("docs/") ? "repoDoc" : "path" };
}

export function classifyEvidenceList(values: unknown): EvidenceItem[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => classifyEvidence(value))
    .filter((item): item is EvidenceItem => item !== null);
}
