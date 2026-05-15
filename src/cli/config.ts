import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type TokenizerConfig = {
  serverUrl: string;
  apiKey: string;
  projectRoots: string[];
  sources: {
    claude: boolean;
    codex: boolean;
    opencode: boolean;
  };
};

export const configPath = join(homedir(), ".tokenizer", "config.json");
export const queuePath = join(homedir(), ".tokenizer", "queue.jsonl");

export function defaultConfig(): TokenizerConfig {
  return {
    serverUrl: "http://localhost:3000",
    apiKey: "change-me",
    projectRoots: [join(homedir(), "project")],
    sources: { claude: true, codex: true, opencode: true }
  };
}

export function ensureConfig(): TokenizerConfig {
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  }
  return readConfig();
}

export function readConfig(): TokenizerConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Missing config. Run: tokenizer init`);
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as TokenizerConfig;
}
