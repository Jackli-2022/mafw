module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // zeromq@6 leaves two stdio-marked Socket handles behind after close()
  // (native bindings; verified minimal repro) which block node from exiting
  // after a real-kernel suite. All test results are asserted before exit, so
  // force-exiting is safe and keeps CI from hanging on that leak.
  forceExit: true,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {}],
    // jose (ESM-only) is a dependency of @a2a-js/sdk; transpile its JS too.
    '^.+\\.js$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: [
    // @a2a-js/sdk depends on jose (ESM-only); transpile both for ts-jest CJS.
    // @langchain/langgraph is ESM and must be transpiled too (the mock re-exports it).
    // @modelcontextprotocol/sdk ships ESM dist.
    'node_modules/(?!(jose|@a2a-js|@langchain|@modelcontextprotocol)/)',
  ],
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electron.ts',
    '^@opencode-ai/sdk$': '<rootDir>/tests/mocks/@opencode-ai/sdk.ts',
    // nodenext source uses `.js` specifiers for relative imports that resolve
    // to `.ts` files (gateway package); strip the extension for jest resolver.
    '^(\\.\\.?/.*)\\.js$': '$1',
    // Unify @langchain/langgraph to the gateway copy (ESM, require-able on
    // Node 24) so tests and gateway modules share one instance; the mock
    // stubs `interrupt` which throws outside a real graph context.
    '^@langchain/langgraph$': '<rootDir>/tests/mocks/@langchain/langgraph.js',
    // @langchain/core exists at both the repo root (1.2.1) and inside
    // gateway/node_modules (1.2.2); force one instance so `Document`
    // instanceof checks pass across test/gateway module graphs.
    '^@langchain/core(.*)$': '<rootDir>/node_modules/@langchain/core$1',
    // pi-coding-agent lives in gateway/node_modules (ESM); unit tests only
    // need the shape, so route it to a mock.
    '^@earendil-works/pi-coding-agent$': '<rootDir>/tests/mocks/@earendil-works/pi-coding-agent.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        paths: {
          '@opencode-ai/sdk': ['./tests/mocks/@opencode-ai/sdk.ts'],
        },
      },
    },
  },
  collectCoverageFrom: ['src/**/*.ts', 'gateway/src/**/*.ts'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
