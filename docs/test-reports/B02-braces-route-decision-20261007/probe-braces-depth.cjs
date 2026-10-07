'use strict';

const path = require('node:path');

const moduleRoot = path.resolve(process.env.BRACES_MODULE);
const braces = require(moduleRoot);
const version = require(path.join(moduleRoot, 'package.json')).version;

function result(name, fn) {
  try {
    const value = fn();
    console.log(JSON.stringify({ name, result: 'return', type: typeof value }));
  } catch (error) {
    console.log(JSON.stringify({ name, result: 'throw', error: error.name, message: error.message }));
  }
}

function pattern(depth) {
  return '{'.repeat(depth) + 'x' + '}'.repeat(depth);
}

function ast(depth) {
  let node = { type: 'text', value: 'x' };
  for (let index = 0; index < depth; index++) {
    node = { type: 'root', nodes: [node] };
  }
  return node;
}

console.log(JSON.stringify({ moduleRoot, version, node: process.version }));
for (const depth of [1, 100, 101, 4000]) {
  result(`default-string-depth-${depth}`, () => braces(pattern(depth)));
}
result('compile-direct-ast-depth-4000', () => braces.compile(ast(4000)));
