import frameworkReleasesManifest from "../../framework/harness/framework-releases.json";

// harness 框架版本的比较与「落后几版」判断。
//
// 已发布版本清单来自受管 framework 镜像中的 manifest。服务端没有框架仓库，无法读 tag；
// 而「落后几版」问的是**发布次数**，不是数值差。
export const FRAMEWORK_RELEASES = Object.freeze(
  frameworkReleasesManifest.releases.map((release) => release.version)
);

export const LATEST_FRAMEWORK_VERSION = FRAMEWORK_RELEASES[FRAMEWORK_RELEASES.length - 1];

/**
 * 解析 "1.4.0" → [1,4,0]。非法输入（含字面量 "unknown"）返回 null，绝不猜。
 *
 * 🔴 前导零属非法（`01.0.3` / `1.00.3`）。第一版只校验「全是数字」，`Number()` 随后把
 * 前导零吞掉，`join(".")` 又正好命中发布清单 —— 于是一个非法版本号会被报成「落后 9 版」。
 * 外部 evaluator（Codex）实测抓到这条：BL-FWDRIFT fix_round 1。
 */
const SEGMENT = /^(0|[1-9]\d*)$/;

export function parseFrameworkVersion(version: string | null | undefined): number[] | null {
  if (!version) return null;
  const parts = version.trim().replace(/^v/, "").split(".");
  if (parts.length !== 3) return null;
  if (!parts.every((p) => SEGMENT.test(p))) return null;
  return parts.map(Number);
}

/** 语义比较：a < b 返回负数，相等 0，a > b 正数。任一不可解析返回 null。 */
export function compareFrameworkVersion(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = parseFrameworkVersion(a);
  const right = parseFrameworkVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export type FrameworkStandingKind = "latest" | "behind" | "ahead" | "unknown";

export type FrameworkStanding = {
  kind: FrameworkStandingKind;
  /** 距最新版隔了几次发布；只在 kind==="behind" 时有值 */
  behind: number | null;
  latest: string;
};

/**
 * 一个项目上报的框架版本处在什么位置。
 *
 * 四种结果对应四种完全不同的处置，混淆任何两种都会误导人：
 *   latest  什么都不用做
 *   behind  可以 sync，且知道隔了几次发布
 *   ahead   项目比服务端已知的最新还新（服务端没跟上发版）——**不能谎报落后**
 *   unknown 版本推断不出（adopt 时基准线未知）或压根没有账本——要先 adopt，不是升级
 */
export function frameworkStanding(version: string | null | undefined): FrameworkStanding {
  const latest = LATEST_FRAMEWORK_VERSION;
  const parsed = parseFrameworkVersion(version);
  if (!parsed) return { kind: "unknown", behind: null, latest };

  const cmp = compareFrameworkVersion(version, latest);
  if (cmp === null) return { kind: "unknown", behind: null, latest };
  if (cmp > 0) return { kind: "ahead", behind: null, latest };
  if (cmp === 0) return { kind: "latest", behind: null, latest };

  // 落后几版 = 清单里排在它之后的发布次数。版本号在清单外（例如某个内部构建）时
  // 不硬凑一个数字——宁可只说「落后」，也不给一个编出来的次数。
  const normalized = parsed.join(".");
  const idx = (FRAMEWORK_RELEASES as readonly string[]).indexOf(normalized);
  if (idx < 0) return { kind: "behind", behind: null, latest };
  return { kind: "behind", behind: FRAMEWORK_RELEASES.length - 1 - idx, latest };
}

/** 落后几版；不适用（最新/超前/未知/清单外）一律 null，调用方据此决定显示什么。 */
export function versionsBehind(version: string | null | undefined): number | null {
  return frameworkStanding(version).behind;
}
