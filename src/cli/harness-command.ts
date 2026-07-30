import { readConfig, type TokenizerConfig } from "./config";
import {
  discoverHarnessRepos,
  readHarnessSyncSnapshot,
  runHarnessSync,
  type HarnessRepo,
  type HarnessSyncResult
} from "./harness";
import { formatHarnessModeLine } from "./harness-modes-print";
import type { HarnessSyncSnapshot } from "@/shared/harness-health";

export type HarnessCommandOptions = {
  list?: boolean;
  modes?: boolean;
  status?: boolean;
  json?: boolean;
};

export type HarnessCommandDeps = {
  readConfig: () => TokenizerConfig;
  discoverHarnessRepos: (config: TokenizerConfig) => HarnessRepo[];
  formatHarnessModeLine: (repo: HarnessRepo) => string;
  runHarnessSync: (config: TokenizerConfig) => Promise<HarnessSyncResult>;
  readHarnessSyncSnapshot: () => HarnessSyncSnapshot | null;
  write: (line: string) => void;
};

const DEFAULT_DEPS: HarnessCommandDeps = {
  readConfig,
  discoverHarnessRepos,
  formatHarnessModeLine,
  runHarnessSync,
  readHarnessSyncSnapshot,
  write: (line) => console.log(line)
};

export async function runHarnessCommand(
  options: HarnessCommandOptions,
  deps: HarnessCommandDeps = DEFAULT_DEPS
): Promise<void> {
  if (options.status) {
    deps.write(JSON.stringify(deps.readHarnessSyncSnapshot()));
    return;
  }

  const config = deps.readConfig();
  const repos = deps.discoverHarnessRepos(config);
  if (options.modes) {
    if (repos.length === 0) {
      deps.write("No harness projects found under projectRoots (need both progress.json and harness-rules.md).");
      return;
    }
    for (const repo of repos) deps.write(deps.formatHarnessModeLine(repo));
    return;
  }
  if (options.list) {
    if (repos.length === 0) {
      deps.write("No harness projects found under projectRoots (need both progress.json and harness-rules.md).");
      return;
    }
    for (const repo of repos) deps.write(`${repo.name}  ${repo.repoKey}  ${repo.path}`);
    return;
  }

  if (!options.json) {
    if (repos.length === 0) {
      deps.write("No harness projects found under projectRoots (need both progress.json and harness-rules.md).");
      return;
    }
    for (const repo of repos) deps.write(`${repo.name}  ${repo.repoKey}  ${repo.path}`);
  }

  const result = await deps.runHarnessSync(config);
  if (options.json) {
    deps.write(JSON.stringify(result.snapshot));
    return;
  }

  deps.write(
    `Reported: ${result.reported}  Failed: ${result.failed}  Relayed: ${result.applied}  Mode intents: ${result.stagedIntents}`
  );
  for (const reason of result.skippedReports) deps.write(`  report skip ${reason}`);
  for (const reason of result.skippedAppliedAcks) deps.write(`  applied ACK skip ${reason}`);
  for (const reason of result.skipped) deps.write(`  relay skip  ${reason}`);
  for (const reason of result.skippedModeIntents) deps.write(`  mode skip   ${reason}`);
  for (const issue of result.issues) {
    deps.write(
      `  issue ${issue.operation} project=${issue.project ?? "-"} code=${issue.code} retryable=${issue.retryable}`
    );
  }
}
