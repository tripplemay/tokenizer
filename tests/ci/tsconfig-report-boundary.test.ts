import { relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("TypeScript application roots", () => {
  it("typechecks source, routes, and tests without compiling historical report probes", () => {
    const root = process.cwd();
    const configPath = resolve(root, "tsconfig.json");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(config.error).toBeUndefined();

    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    expect(parsed.errors).toEqual([]);
    const roots = new Set(parsed.fileNames.map((file) => relative(root, file).split(sep).join("/")));

    for (const file of [
      "src/cli/sync.ts",
      "app/api/events/route.ts",
      "tests/ci/tsconfig-report-boundary.test.ts"
    ]) {
      expect(roots.has(file), `${file} must remain a TypeScript root`).toBe(true);
    }

    const reportScripts = ts.sys.readDirectory(resolve(root, "docs/test-reports"), [".ts", ".tsx"]);
    expect(reportScripts.length).toBeGreaterThan(0);
    expect([...roots].filter((file) => file.startsWith("docs/test-reports/"))).toEqual([]);
  });
});
