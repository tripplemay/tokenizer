import { readFileSync } from "node:fs";

export type JsonlLine = {
  text: string;
  lineNumber: number;
  // Byte offset immediately after this line, including its newline. Byte
  // offsets keep cursor comparisons correct when a line contains UTF-8 text.
  endOffset: number;
};

export type JsonlFile = {
  lines: JsonlLine[];
  byteLength: number;
};

export function readJsonlFile(path: string): JsonlFile {
  const bytes = readFileSync(path);
  const lines: JsonlLine[] = [];
  let start = 0;
  let lineNumber = 1;

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const textEnd = index > start && bytes[index - 1] === 0x0d ? index - 1 : index;
    lines.push({
      text: bytes.subarray(start, textEnd).toString("utf8"),
      lineNumber,
      endOffset: index + 1
    });
    start = index + 1;
    lineNumber += 1;
  }

  // Keep an unterminated final line. If it is incomplete and fails JSON.parse,
  // the next append crosses the saved byte offset and retries the whole line.
  if (start < bytes.length) {
    lines.push({
      text: bytes.subarray(start).toString("utf8"),
      lineNumber,
      endOffset: bytes.length
    });
  }

  return { lines, byteLength: bytes.length };
}
