// Gateway modules resolve '@langchain/langgraph' from gateway/node_modules
// (ESM); tests resolve the root copy. This moduleNameMapper target unifies
// both to the gateway copy and stubs `interrupt` (which throws outside a real
// graph context). Node 24 can require(esm) synchronously.
const real = require("../../../gateway/node_modules/@langchain/langgraph/dist/index.js");

module.exports = {
  ...real,
  interrupt: jest.fn(),
};
