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
  },
};
