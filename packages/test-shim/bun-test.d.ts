// Ambient types for "bun:test" so typechecked packages can drop @types/bun.
// Point tsconfig `paths` at this file: "bun:test": ["<rel>/packages/test-shim/bun-test.d.ts"]
declare module "bun:test" {
  export { test, it, describe, beforeEach, afterEach } from "node:test";
  export { before as beforeAll, after as afterAll } from "node:test";
  export { expect } from "expect";
  import { fn as JestFn, spyOn as JestSpyOn } from "jest-mock";
  export const spyOn: typeof JestSpyOn;
  export const mock: typeof JestFn & {
    fn: typeof JestFn;
    module: (...args: readonly unknown[]) => never;
    restore: () => void;
    clearAllMocks: () => void;
  };
  export const jest: { fn: typeof JestFn };
  export const setSystemTime: (...args: readonly unknown[]) => never;
}
