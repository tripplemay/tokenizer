'use strict';

const fs = require('node:fs');
const Module = require('node:module');

const output = process.env.BRACES_TRACE_FILE;
const originalLoad = Module._load;
const wrapped = new WeakMap();

if (output) fs.writeFileSync(output, '', { flag: 'a' });

function describe(value) {
  if (typeof value === 'string') {
    return { type: 'string', length: value.length, sample: value.slice(0, 240) };
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, sample: value.slice(0, 8) };
  }
  return { type: typeof value };
}

function record(operation, args, parent) {
  if (!output) return;
  const stack = new Error().stack
    .split('\n')
    .slice(3, 9)
    .map(line => line.trim());
  fs.appendFileSync(output, `${JSON.stringify({
    operation,
    input: describe(args[0]),
    options: args[1] ?? null,
    parent: parent?.filename ?? null,
    stack
  })}\n`);
}

function wrap(fn, name, parent) {
  if (wrapped.has(fn)) return wrapped.get(fn);
  const proxy = new Proxy(fn, {
    apply(target, thisArg, args) {
      record(name, args, parent);
      return Reflect.apply(target, thisArg, args);
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value === 'function' && ['compile', 'expand', 'parse', 'stringify'].includes(String(property))) {
        return wrap(value, String(property), parent);
      }
      return value;
    }
  });
  wrapped.set(fn, proxy);
  return proxy;
}

Module._load = function load(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (request === 'braces' && typeof loaded === 'function') {
    return wrap(loaded, 'default', parent);
  }
  return loaded;
};
