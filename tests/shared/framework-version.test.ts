import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import frameworkReleasesManifest from "../../framework/harness/framework-releases.json";
import {
  FRAMEWORK_RELEASES,
  LATEST_FRAMEWORK_VERSION,
  compareFrameworkVersion,
  frameworkStanding,
  parseFrameworkVersion,
  versionsBehind
} from "@/shared/framework-version";

/**
 * 这组测试保护的是「控制台说的话可不可信」。四种状态各自对应完全不同的处置
 * （什么都不做 / 可以 sync / 服务端没跟上 / 得先 adopt），混淆任意两种都会误导人：
 * 把 unknown 当 latest → 项目永远不会被升级；把 ahead 当 behind → 谎报落后。
 */

const MANIFEST_RELEASE_VERSIONS = frameworkReleasesManifest.releases.map((release) => release.version);
const FRAMEWORK_VERSION_SOURCE = fileURLToPath(new URL("../../src/shared/framework-version.ts", import.meta.url));

describe("清单与常量一致性", () => {
  it("从 framework manifest 派生发布清单，manifest 最新版本是 1.6.2", () => {
    expect(FRAMEWORK_RELEASES).toEqual(MANIFEST_RELEASE_VERSIONS);
    expect(MANIFEST_RELEASE_VERSIONS.at(-1)).toBe("1.6.2");
    expect(LATEST_FRAMEWORK_VERSION).toBe("1.6.2");
  });

  it("不再维护手写的 FRAMEWORK_RELEASES 数组副本", () => {
    const source = readFileSync(FRAMEWORK_VERSION_SOURCE, "utf8");
    const implementation = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    expect(source).toContain("framework-releases.json");
    expect(source).not.toMatch(/FRAMEWORK_RELEASES\s*=\s*\[/);
    expect(implementation).not.toMatch(/=\s*\[\s*["']\d+\.\d+\.\d+["']/);
  });

  it("🔴 清单末位必须等于 LATEST_FRAMEWORK_VERSION", () => {
    // 漂移的表现是「明明最新却显示落后一版」，在页面上几乎看不出来，只能靠这条拦。
    expect(FRAMEWORK_RELEASES[FRAMEWORK_RELEASES.length - 1]).toBe(LATEST_FRAMEWORK_VERSION);
  });

  it("清单严格递增且无重复", () => {
    for (let i = 1; i < FRAMEWORK_RELEASES.length; i += 1) {
      expect(compareFrameworkVersion(FRAMEWORK_RELEASES[i - 1], FRAMEWORK_RELEASES[i])).toBeLessThan(0);
    }
  });
});

describe("parseFrameworkVersion", () => {
  it("解析三段式，允许 v 前缀", () => {
    expect(parseFrameworkVersion("1.4.0")).toEqual([1, 4, 0]);
    expect(parseFrameworkVersion("v1.0.3")).toEqual([1, 0, 3]);
  });

  it("非法输入一律 null，不猜", () => {
    for (const bad of ["unknown", "", null, undefined, "1.4", "1.4.0.1", "1.x.0", "abc"]) {
      expect(parseFrameworkVersion(bad)).toBeNull();
    }
  });

  // 🔴 fix_round 1：外部 evaluator（Codex）实测抓到的真 bug。原实现只校验「全是数字」，
  // Number() 吞掉前导零、join 后又命中发布清单 —— 一个非法版本号被报成「落后 9 版」。
  // 这一分支「三段全是数字」，前面那条用例的所有样例都覆盖不到它。
  it("🔴 前导零属非法：01.0.3 / 1.00.3 / 1.0.03 一律 null，且不得被算出落后次数", () => {
    for (const bad of ["01.0.3", "1.00.3", "1.0.03", "0001.4.0"]) {
      expect(parseFrameworkVersion(bad)).toBeNull();
      expect(versionsBehind(bad)).toBeNull();
      expect(frameworkStanding(bad).kind).toBe("unknown");
    }
    // 单个 0 是合法段，不能误伤
    expect(parseFrameworkVersion("1.0.0")).toEqual([1, 0, 0]);
    expect(parseFrameworkVersion("0.9.1")).toEqual([0, 9, 1]);
  });
});

describe("compareFrameworkVersion", () => {
  it("按段比较而非字符串比较", () => {
    expect(compareFrameworkVersion("1.0.3", "1.4.0")).toBeLessThan(0);
    expect(compareFrameworkVersion("1.4.0", "1.4.0")).toBe(0);
    expect(compareFrameworkVersion("1.5.0", "1.4.0")).toBeGreaterThan(0);
    // 字符串比较会把 1.10.0 判成小于 1.9.0 —— 回归保护
    expect(compareFrameworkVersion("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("任一侧不可解析 → null", () => {
    expect(compareFrameworkVersion("unknown", "1.4.0")).toBeNull();
    expect(compareFrameworkVersion("1.4.0", null)).toBeNull();
  });
});

describe("frameworkStanding 四种状态", () => {
  it("latest：与最新版一致", () => {
    expect(frameworkStanding("1.6.2")).toEqual({
      kind: "latest", behind: null, latest: "1.6.2"
    });
  });

  it("behind：1.6.1 比 manifest 最新 1.6.2 落后一版", () => {
    expect(frameworkStanding("1.6.1")).toEqual({
      kind: "behind", behind: 1, latest: "1.6.2"
    });
  });

  it("behind：给出**发布次数**而不是数值差", () => {
    const s = frameworkStanding("1.0.3");
    expect(s.kind).toBe("behind");
    // 断言必须**相对于清单**表达。第一版还写了 `toBe(9)`，结果发布 v1.4.1 当天就碎了——
    // 把「当前恰好隔几次发布」钉进测试，等于每次发版都要改测试，而它保护的根本不是这个。
    expect(s.behind).toBe(FRAMEWORK_RELEASES.length - 1 - FRAMEWORK_RELEASES.indexOf("1.0.3"));
    // 真正要钉的是语义：清单里排在它后面的每一次发布都算一次落后
    expect(s.behind).toBeGreaterThan(0);
  });

  it("ahead：项目比服务端已知的最新还新时，不得谎报落后", () => {
    expect(frameworkStanding("9.9.9")).toEqual({
      kind: "ahead", behind: null, latest: "1.6.2"
    });
  });

  it("unknown：adopt 推断不出基准线，或压根没有账本", () => {
    for (const v of ["unknown", null, undefined, "", "malformed", "1.5", "1.5.x", "v1.5"]) {
      expect(frameworkStanding(v).kind).toBe("unknown");
    }
  });

  it("清单外的旧版本：说「落后」但不编造次数", () => {
    const s = frameworkStanding("0.9.1");     // 有 tag 但不在已发布清单里
    expect(s.kind).toBe("behind");
    expect(s.behind).toBeNull();
  });
});

describe("versionsBehind", () => {
  it("只有真正落后且在清单内才有数字，其余一律 null", () => {
    expect(versionsBehind("1.0.3")).toBe(
      FRAMEWORK_RELEASES.length - 1 - FRAMEWORK_RELEASES.indexOf("1.0.3")
    );
    expect(versionsBehind(LATEST_FRAMEWORK_VERSION)).toBeNull();
    expect(versionsBehind("unknown")).toBeNull();
    expect(versionsBehind("9.9.9")).toBeNull();
    expect(versionsBehind("0.9.1")).toBeNull();
  });
});
