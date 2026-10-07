#!/usr/bin/env node
'use strict';

const path = require('node:path');

const originalPath = process.argv[2];
const patchedPath = process.argv[3];
if (!originalPath || !patchedPath) {
  console.error('usage: node probe-braces-compat.cjs <original-module-path> <patched-module-path>');
  process.exit(2);
}

const original = require(path.resolve(originalPath));
const patched = require(path.resolve(patchedPath));

const cases = [
  ['default', '{src,app}/**/*.{js,ts,jsx,tsx,mdx}', {}],
  ['compile', 'app/{reading,writing}/**/*.{js,jsx}', {}],
  ['expand', 'page-{1..3}.js', {}],
  ['expand', 'a\\{b,c\\}', {}],
  ['expand', '{a,b}{1,2}', { nodupes: true }],
  ['stringify', '{a,{b,c}}', {}],
  ['compile-parsed', 'a/{b,c}/d', {}]
];

let mismatch = false;
for (const [operation, input, options] of cases) {
  const invoke = implementation => (
    operation === 'default'
      ? implementation(input, options)
      : operation === 'compile-parsed'
        ? implementation.compile(implementation.parse(input, options), options)
        : implementation[operation](input, options)
  );
  const before = invoke(original);
  const after = invoke(patched);
  const equal = JSON.stringify(before) === JSON.stringify(after);
  mismatch ||= !equal;
  process.stdout.write(`${JSON.stringify({ operation, input, options, equal, before, after })}\n`);
}

if (mismatch) process.exitCode = 1;
