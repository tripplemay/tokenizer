import { UsageEventInput } from "@/shared/usage";

export type ParserConfig = {
  homeDir: string;
  projectRoots: string[];
};

export type ParserResult = {
  events: UsageEventInput[];
  warnings: string[];
};
