import { describe, expect, it } from "vitest";
import { buildCronInstall, buildCronUninstall, tokenizerCronLines } from "../../src/cli/service-cron";

const BIN = "/home/u/.local/bin/tokenizer";
const LOG = "/home/u/.tokenizer/logs/agent.log";
const OPTS = { binPath: BIN, logPath: LOG, syncMinutes: 5 };

const RUN_LINE = `*/5 * * * * ${BIN} run >> ${LOG} 2>&1`;
const HARNESS_LINE = `*/2 * * * * ${BIN} harness --json >/dev/null 2>> ${LOG}`;
const USER_LINE = "0 3 * * * /usr/local/bin/backup.sh # tokenizer backup notes";
const OLD_SINGLE = `*/10 * * * * ${BIN} run >> ${LOG} 2>&1`;

function tokenizerRows(content: string): string[] {
  return content.split("\n").filter((row) => row.includes(BIN));
}

describe("buildCronInstall", () => {
  it("writes exactly the run + harness pair into an empty crontab", () => {
    const out = buildCronInstall("", OPTS);
    expect(out).toBe(`${RUN_LINE}\n${HARNESS_LINE}\n`);
  });

  it("upgrades an old single run entry to the dual entries", () => {
    const out = buildCronInstall(`${OLD_SINGLE}\n`, OPTS);
    expect(tokenizerRows(out)).toEqual([RUN_LINE, HARNESS_LINE]);
    expect(out).not.toContain("*/10");
  });

  it("keeps unrelated user rows intact, even ones mentioning the word tokenizer", () => {
    const out = buildCronInstall(`${USER_LINE}\n${OLD_SINGLE}\n`, OPTS);
    expect(out.split("\n")[0]).toBe(USER_LINE);
    expect(tokenizerRows(out)).toEqual([RUN_LINE, HARNESS_LINE]);
  });

  it("is idempotent over an already-dual crontab", () => {
    const once = buildCronInstall(`${USER_LINE}\n`, OPTS);
    expect(buildCronInstall(once, OPTS)).toBe(once);
  });

  it("pins the harness cadence to two minutes and the run cadence to syncMinutes", () => {
    const [run, harness] = tokenizerCronLines({ ...OPTS, syncMinutes: 15 });
    expect(run.startsWith("*/15 * * * * ")).toBe(true);
    expect(harness.startsWith("*/2 * * * * ")).toBe(true);
    expect(tokenizerCronLines({ ...OPTS, syncMinutes: 0 })[0].startsWith("*/1 ")).toBe(true);
  });
});

describe("buildCronUninstall", () => {
  it("strips every tokenizer entry while preserving user rows", () => {
    const installed = buildCronInstall(`${USER_LINE}\n`, OPTS);
    const out = buildCronUninstall(installed, BIN);
    expect(tokenizerRows(out)).toEqual([]);
    expect(out).toBe(`${USER_LINE}\n`);
  });

  it("also removes legacy single entries", () => {
    expect(tokenizerRows(buildCronUninstall(`${OLD_SINGLE}\n`, BIN))).toEqual([]);
  });
});
