import { UsageEventInput } from "@/shared/usage";
import { ParserCursor } from "@/cli/cursor";

export type ParserConfig = {
  homeDir: string;
  projectRoots: string[];
  // Optional cursor. Parsers that receive one skip unchanged files, emit only
  // appended JSONL records, and (for SQLite-backed sources) filter rows newer
  // than the cutoff. Parsers write the new position into the cursor in-place;
  // the caller persists it only after resulting events enter the durable queue.
  cursor?: ParserCursor;
};

export type ParserResult = {
  events: UsageEventInput[];
  warnings: string[];
};
