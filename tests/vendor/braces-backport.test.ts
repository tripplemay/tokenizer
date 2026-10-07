import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const braces = require("braces") as {
  (input: string, options?: Record<string, unknown>): string[];
  parse(input: string, options?: Record<string, unknown>): unknown;
  compile(input: string | Ast, options?: Record<string, unknown>): string;
  expand(input: string | Ast, options?: Record<string, unknown>): string[];
  stringify(input: string | Ast, options?: Record<string, unknown>): string;
};

type Ast = {
  type: "root";
  nodes: Ast[];
};

const nestedAst = (depth: number): Ast => {
  let ast: Ast = { type: "root", nodes: [] };
  for (let index = 0; index < depth; index += 1) {
    ast = { type: "root", nodes: [ast] };
  }
  return ast;
};

const expectDepthError = (invoke: () => unknown) => {
  try {
    invoke();
    throw new Error("expected braces depth guard to reject input");
  } catch (error) {
    expect(error).toBeInstanceOf(SyntaxError);
    expect(error).toMatchObject({
      code: "ERR_BRACES_MAX_DEPTH",
      message: "AST nesting depth exceeds the maximum of 100"
    });
  }
};

describe("vendored braces depth backport", () => {
  it.each(["compile", "expand", "stringify"] as const)(
    "accepts direct AST depth 100 and rejects 101 in %s",
    (operation) => {
      expect(() => braces[operation](nestedAst(100))).not.toThrow();
      expectDepthError(() => braces[operation](nestedAst(101)));
    }
  );

  it.each(["parse", "compile", "expand", "stringify"] as const)(
    "accepts string container depth 100 and rejects 101 in %s",
    (operation) => {
      const atLimit = "{".repeat(100) + "x" + "}".repeat(100);
      const overLimit = "{".repeat(101) + "x" + "}".repeat(101);
      expect(() => braces[operation](atLimit)).not.toThrow();
      expectDepthError(() => braces[operation](overLimit));
    }
  );

  it("guards the default API and parenthesis nesting", () => {
    const overLimitBraces = "{".repeat(101) + "x" + "}".repeat(101);
    const atLimitParens = "(".repeat(100) + "x" + ")".repeat(100);
    const overLimitParens = "(".repeat(101) + "x" + ")".repeat(101);

    expectDepthError(() => braces(overLimitBraces));
    expect(() => braces.parse(atLimitParens)).not.toThrow();
    expectDepthError(() => braces.parse(overLimitParens));
  });

  it("does not count quoted, escaped, or bracket-class delimiters as containers", () => {
    expect(() => braces.parse(`"${"{".repeat(101)}"`)).not.toThrow();
    expect(() => braces.parse("\\{".repeat(101))).not.toThrow();
    expect(() => braces.parse(`[${"{".repeat(101)}]`)).not.toThrow();
  });

  it("preserves representative glob, range, alternative, and escape behavior", () => {
    expect(braces.compile("app/{reading,writing}/**/*.{js,jsx}")).toBe(
      "app/(reading|writing)/**/*.(js|jsx)"
    );
    expect(braces.expand("page-{1..3}.js")).toEqual([
      "page-1.js",
      "page-2.js",
      "page-3.js"
    ]);
    expect(braces.expand("a\\{b,c\\}")).toEqual(["a{b,c}"]);
    expect(braces.compile("./{app,src}/**/*.{js,ts,jsx,tsx,mdx}")).toBe(
      "./(app|src)/**/*.(js|ts|jsx|tsx|mdx)"
    );
    expect(braces.compile(braces.parse("a/{b,c}/d") as Ast)).toBe("a/(b|c)/d");
  });
});
