import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const reports = dirname(fileURLToPath(import.meta.url));
const entries = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function scan(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const path = join(directory, name), stat = fs.lstatSync(path);
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) scan(path);
    else {
      const name = relative(reports, path);
      if (['manifest.json', 'SHA256SUMS'].includes(name)) continue;
      const bytes = fs.readFileSync(path); entries.push({ path: name, bytes: bytes.length, sha256: hash(bytes), mode: (stat.mode & 0o777).toString(8) });
    }
  }
}
scan(reports);
const manifest = { format: 'generator-report-payload-manifest-v1', excludes: ['manifest.json', 'SHA256SUMS'],
  files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries };
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(join(reports, 'manifest.json'), manifestBytes);
const sums = entries.map(entry => entry.sha256 + '  ' + entry.path).join('\n') + '\n';
fs.writeFileSync(join(reports, 'SHA256SUMS'), sums);
process.stdout.write(JSON.stringify({ payload_files: manifest.files, payload_bytes: manifest.bytes,
  manifest_sha256: hash(manifestBytes), whole_directory_files: manifest.files + 2,
  whole_directory_bytes: manifest.bytes + manifestBytes.length + Buffer.byteLength(sums), self_hash_claim: false }) + '\n');
