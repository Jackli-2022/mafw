# @mafw/test-shim

bun:test 兼容层——让四个包的测试套件跑在 `node --test` 上，测试文件零改写。

## 用法

**ESM 包**（desktop / session-ui / ui / 本包）：

```
node --import tsx --import <repo>/packages/test-shim/register.mjs --test "<globs>"
```

`register.mjs` 注册三个 ESM 钩子：`bun:test` → shim、`.css` 导入 → 空模块、`?url`/`?raw` 资产 → 路径字符串 stub。

**CJS 包**（gateway-sdk 及任何无 `"type": "module"` 的包）：

```
node --import tsx --require <repo>/packages/test-shim/require-hook.cjs --test "<globs>"
```

tsx 会把无 `"type": "module"` 包的 `.ts` 编译为 CJS，`require("bun:test")` 由 `require-hook.cjs` 拦截。

## 约束（改动前必读）

- **CJS 包的 `"type"` 字段是模式开关**：若给消费方包加上 `"type": "module"`，`require-hook.cjs` 会静默失效（不再有 CJS 编译产物走 require），必须同时换成 ESM 的 `register.mjs`。
- **shim 的 mock 用 jest-mock**：node:test 的 mock fn 是 Proxy，其 `.mock` 属性不可覆写，包装它必然失败。`expect` 同理用 jest 官方独立包（`expect@29` 的 ESM 入口没有 default 导出——必须命名导入）。
- `mock.module` 不实现（本仓库零使用），调用即 throw。
- 类型：typechecked 的包把 tsconfig `paths` 的 `"bun:test"` 指向 `bun-test.d.ts`，替代 `@types/bun`。

## 自测

```
npm test -w @mafw/test-shim
```

冒烟用例覆盖：核心 matcher / `toBeTypeOf` / jest matcher 识别 jest-mock / spyOn 拦截与恢复 / `test.each` 展开 + CJS 侧 require 拦截。
