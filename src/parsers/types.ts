import { UsageEventInput } from "@/shared/usage";
import { ParserCursor } from "@/cli/cursor";

export type ParserConfig = {
  homeDir: string;
  projectRoots: string[];
  // Optional cursor. Parsers that receive one will skip files whose
  // fingerprint matches and (for SQLite-backed sources) filter rows newer
  // than the cutoff. Parsers also write the new fingerprint back into the
  // cursor in-place — the caller is responsible for persisting the cursor
  // only after a successful sync.
  cursor?: ParserCursor;
};

export type ParserResult = {
  events: UsageEventInput[];
  warnings: string[];
};
