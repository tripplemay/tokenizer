#!/usr/bin/env node
'use strict';

const path = require('node:path');

const modulePath = process.argv[2];
if (!modulePath) {
  console.error('usage: node probe-braces-depth.cjs <braces-module-path>');
  process.exit(2);
}

const braces = require(path.resolve(modulePath));

const nestedAst = depth => {
  let ast = { type: 'root', nodes: [] };
  for (let index = 0; index < depth; index += 1) {
    ast = { type: 'root', nodes: [ast] };
  }
  return ast;
};

const record = (kind, operation, depth, invoke) => {
  try {
    const value = invoke();
    return {
      kind,
      operation,
      depth,
      result: 'accepted',
      outputType: Array.isArray(value) ? 'array' : typeof value
    };
  } catch (error) {
    return {
      kind,
      operation,
      depth,
      result: 'rejected',
      errorName: error && error.name,
      errorCode: error && error.code || null,
      errorMessage: error && error.message
    };
  }
};

const results = [];
for (const depth of [100, 101, 4000]) {
  const pattern = '{'.repeat(depth) + 'x' + '}'.repeat(depth);
  for (const operation of ['default', 'parse', 'compile', 'expand', 'stringify']) {
    results.push(record('string', operation, depth, () => (
      operation === 'default' ? braces(pattern) : braces[operation](pattern)
    )));
  }

  for (const operation of ['compile', 'expand', 'stringify']) {
    results.push(record('direct-ast', operation, depth, () => braces[operation](nestedAst(depth))));
  }
}

for (const result of results) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
