module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electron.ts',
    '^@mafw/sdk$': '<rootDir>/mafw-sdk/src/index.ts',
    '^@opencode-ai/sdk$': '<rootDir>/tests/mocks/@opencode-ai/sdk.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        paths: {
          '@mafw/sdk': ['./mafw-sdk/src/index.ts'],
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
