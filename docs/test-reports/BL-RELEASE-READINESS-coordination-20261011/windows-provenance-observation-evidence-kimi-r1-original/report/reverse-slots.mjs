// r1 analyst script: reverse the exact candidate slot edits (S1-S6) line-by-line and
// prove the result is byte-exact the 712 baseline git blob. No git apply, no whitespace
// normalization: hunks are parsed for exact positions; '+' lines dropped, '-' lines restored.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [candidatePath, diffPath, baselinePath, outPath] = process.argv.slice(2);
const candidate = readFileSync(candidatePath, 'utf8').split('\n');
const baseline = readFileSync(baselinePath);
const diffLines = readFileSync(diffPath, 'utf8').split('\n');

const hunks = [];
let cur = null;
for (const line of diffLines) {
  const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (m) {
    cur = { oldStart: +m[1], newStart: +m[3], body: [] };
    hunks.push(cur);
    continue;
  }
  if (cur && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
    cur.body.push(line);
  } else if (cur && line.startsWith('\\')) {
    // "\ No newline at end of file" marker: ignore, no such case expected here
  }
}

// Reverse-apply: rebuild the original file content from the candidate by replacing each
// hunk's new-file range with its old-file content (lines prefixed '-' or ' ', in order).
const out = [];
let cursor = 1; // 1-based line number into candidate
const hunkReport = [];
for (const h of hunks) {
  while (cursor < h.newStart) out.push(candidate[cursor++ - 1]);
  let added = 0, removed = 0;
  const oldContent = [];
  for (const b of h.body) {
    if (b[0] === '+') { added++; cursor++; }
    else if (b[0] === '-') { removed++; oldContent.push(b.slice(1)); }
    else { oldContent.push(b.slice(1)); cursor++; }
  }
  for (const l of oldContent) out.push(l);
  hunkReport.push({ oldStart: h.oldStart, newStart: h.newStart, added, removed });
}
while (cursor <= candidate.length) out.push(candidate[cursor++ - 1]);
// candidate ends with trailing newline -> split produces final empty string; keep join symmetric
const reconstructed = Buffer.from(out.join('\n'), 'utf8');
writeFileSync(outPath, reconstructed);

const sha = b => createHash('sha256').update(b).digest('hex');
const result = {
  hunks: hunkReport,
  hunkCount: hunks.length,
  reconstructedBytes: reconstructed.length,
  baselineBytes: baseline.length,
  reconstructedSha256: sha(reconstructed),
  baselineSha256: sha(baseline),
  byteExact: reconstructed.equals(baseline),
};
console.log(JSON.stringify(result, null, 2));
if (!result.byteExact) process.exitCode = 1;
