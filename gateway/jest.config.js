module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/jest-setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tests/tsconfig.json',
      diagnostics: false,
    }],
    // @modelcontextprotocol/sdk ships ESM-only dist; transpile for ts-jest CJS.
    '^.+\\.js$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jose|@a2a-js|@langchain|@modelcontextprotocol)/)',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // @opencode-ai/sdk ships the /v2 subpath as ESM-only ("import" condition);
    // map to a CJS-friendly stub so jest can resolve it (tests jest.mock it).
    '^@opencode-ai/sdk/v2$': '<rootDir>/tests/mocks/opencode-sdk-v2-stub.ts',
    // The gateway runtime still reaches the extracted driver through one-release
    // re-export shims (`src/runtime/opencode-*.ts`). Resolve the package to its
    // TypeScript source in Jest so gateway tests (a) run on a clean checkout
    // where `adapters/opencode/dist` has not been built yet, (b) see adapter
    // source edits immediately instead of a stale bundle, and (c) share one
    // module instance with suites that import `adapters/opencode/src/*` directly.
    // The packaging contract (CJS bundle + typings) is still covered by
    // `opencode-package.test.ts`, which require()s the built entry in a child
    // process; the root build gate is unchanged.
    '^@mafw/adapter-opencode$': '<rootDir>/../adapters/opencode/src/index.ts',
  },
};
