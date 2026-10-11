import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sha = b => createHash('sha256').update(b).digest('hex');
const report = 'docs/test-reports/BL-WINDOWS-P1-CHECKOUT-generator-20261011';
const parent = '/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008';
const authPath = 'docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/windows-checkout-dependency-network-clarification.json';
const authorityBytes = fs.readFileSync(`${parent}/${authPath}`);
assert(authorityBytes.equals(execFileSync('git', ['-c', 'core.fileMode=false', '-C', parent, 'show', `1cc8e459daf04d5592f7590638028457046a0946:${authPath}`])));
const references = [
  ['node_modules/better-sqlite3/package.json', /repository|WiseLibs|"install"/],
  ['node_modules/prebuild-install/util.js', /github\(opts.pkg\).*releases\/download/],
  ['node_modules/prebuild-install/bin.js', /opts.token|startDownload\(util.get/],
  ['node_modules/@prisma/engines/scripts/postinstall.js', /require\(postInstallScriptPath\)/],
  ['node_modules/@prisma/engines/dist/scripts/postinstall.js', /download|binaryPaths|version|enginesVersion/],
  ['node_modules/@prisma/fetch-engine/dist/chunk-FQ2BOR66.js', /PRISMA_BINARIES_MIRROR|PRISMA_ENGINES_MIRROR|binaries.prisma.sh|return `\$\{baseUrl\}/],
];
const scripts = references.map(([path, pattern]) => {
  const b = fs.readFileSync(path);
  const selectedLines = b.toString().split('\n').flatMap((text, i) => pattern.test(text) ? [{ line: i + 1, text }] : []);
  assert(selectedLines.length, path);
  return { path, sha256: sha(b), selectedLines };
});
const logs = ['raw/19-npm-ci-debug-original.log', 'raw/20-swc-npm-debug-original.log'].map(p => fs.readFileSync(`${report}/${p}`, 'utf8'));
const httpLines = logs.flatMap(s => s.split('\n').filter(line => /http fetch (?:GET|POST)/.test(line)));
const observedOrigins = [...new Set(httpLines.flatMap(line => [...line.matchAll(/https:\/\/[^\s]+/g)].map(m => new URL(m[0]).origin)))].sort();
assert.deepEqual(observedOrigins, ['https://registry.npmjs.org']);
const cache = '/Volumes/ORICO/project/.wp1cg-20261011/npm-cache/_prebuilds';
const ownedPrebuildCache = fs.existsSync(cache) ? fs.readdirSync(cache).map(path => ({ path, bytes: fs.statSync(`${cache}/${path}`).size })) : [];
console.log(JSON.stringify({ authorityCommit: '1cc8e459daf04d5592f7590638028457046a0946', authoritySha256: sha(authorityBytes),
  scripts, observedHTTPLogLines: httpLines.length, observedOrigins, ownedPrebuildCache,
  installCommandUnchanged: true, packageOwnedBinaryDownloadsPermitted: true,
  prismaOrGitHubBinaryRequestURLsActuallyLogged: false, externalBinaryRequestsPacketCaptured: false,
  boundary: 'Static package references and owned cache artifacts are not HTTP traces. No install rerun, manual download, authenticated API, credentials or arbitrary egress performed.' }, null, 2));
