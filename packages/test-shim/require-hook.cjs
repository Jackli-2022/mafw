// CJS entry: `node --import tsx --require @mafw/test-shim/require-hook.cjs --test ...`
// Intercepts require("bun:test") for packages tsx compiles to CJS
// (no "type": "module" in the consumer's package.json).
const Module = require("node:module");
const path = require("node:path");

const shim = path.resolve(__dirname, "bun-test-shim.cjs");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "bun:test") return shim;
  return orig.call(this, request, ...args);
};
