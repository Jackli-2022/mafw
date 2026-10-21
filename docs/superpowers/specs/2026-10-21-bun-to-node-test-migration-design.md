# Bun → Node 测试与脚本迁移设计

日期：2026-10-21
状态：已批准立项（spike 验证完成）

## 1. Intent（为什么）

项目编译链本来就不用 Bun（tsc / esbuild / electron-vite），Bun 只剩两个角落：**四个包的测试运行器**（`bun test`，~120 个测试文件）和**一批开发/发布脚本**（`Bun.$` / `Bun.file` 等，~10 个文件）。

动机：

1. **消灭已实证的不稳定源**：2026-10-11 新版 Bun 改变 solid-js 导出解析（jsxDEV 丢失）导致 desktop 测试全红，CI 被迫 pin `bun@1.3.14`（见 `.github/workflows/ci.yml` 注释）。
2. **运行时对齐**：包最终跑在用户的 Node 上（npm 全局安装、CJS、engines>=18），测试却跑在 Bun 上。spike 已抓到活例：`packages/desktop/src/main/ui-plugins.ts` 裸 `require()` 仅在 CJS 产物可用，bun 的全局 `require` 让测试假性通过（fail-open 加载器吞掉错误），Node 下立刻暴露。
3. **工具链收敛**：npm + node + tsc + esbuild + electron-vite + bun → 去掉 bun，CI 少 setup-bun 与 pin 维护，贡献者零额外安装。

## 2. 决策记录（用户已定的部分）

- **路线：纯 Node**（`node --test` + tsx + bun:test shim），**不上 Vitest**。依据：2026-10-21 spike 全量实测（desktop 1033/1041、gateway-sdk/session-ui/ui 与 bun 完全一致），且仓库已有 TUI `node --test` 成功样板。
- **分层 shim 策略**：不逐文件改写 `from "bun:test"` 导入（~120 文件），而是用 shim + loader 钩子承接 bun:test API，测试文件主体零改动。
- 可移植 codemod 已在 spike 中落盘且 bun 全绿：`import.meta.dir→import.meta.dirname`（10 文件）、`__dirname`（1）、`Bun.file/Bun.write/$`→`node:fs`（3）、内联 `require("node:fs")`→顶层 import（1）。

## 3. Goals

- G1：四个包（desktop / gateway-sdk / session-ui / ui）的 `npm test` 走 `node --test`，全部用例通过（desktop 基线 1041、gateway-sdk 133、session-ui 71、ui 8；其中 gateway-sdk 有 2 个**存量失败**（contract 无漂移、SSE envelope 解包）在 bun 下同样红，不在本项修复范围但需记录）。
- G2：shim 从 spike 临时产物扶正为正式共享 dev 基建（单文件、双形态 ESM/CJS、有自身冒烟测试）。
- G3：`ui-plugins.ts` 的裸 `require` 修复（`createRequire` 或等价），使 desktop 全绿。
- G4：desktop/packages-ui 的 Bun 脚本批迁移（`Bun.$`/`Bun.file`/`Bun.env`/`Bun.argv` → `node:fs`/`child_process`/`process`），`native:build` 的 `bun install` → `npm install`。
- G5：CI 清理——删除 setup-bun 与 pin 注释（ci.yml、desktop-release.yml），desktop-release 的 stage-gateway 改用 node 运行。
- G6：根 `test:desktop` 等 script 与 AGENTS.md 表述同步更新。
- G7：**gateway-sdk / session-ui / ui 三包测试加入 CI**；gateway-sdk 的 2 个存量失败（contract 无漂移、SSE `opencode_event` envelope 解包——bun 下同样红）**本项修复**，CI 零豁免。

## 4. Non-goals

- N1：不改编译链（tsc/esbuild/electron-vite 维持）。
- N2：~~不修复 gateway-sdk 的 2 个存量失败~~（**2026-10-21 修订：取消——用户决定本项顺手修掉**，见 G7）
- N3：不引入 happy-dom/jsdom——spike 证实组件测试几乎不触 DOM（95 文件仅 1 处 `document.`）；若未来新增真 DOM 测试再评估。
- N4：`--only-failures`（session-ui/ui 在用）无 node 等价物，接受损失，不自建。
- N5：`mock.module` 不实现——两个包零使用，shim 中显式 throw。

## 5. Anti-goals（做成这样也算失败）

- A1：测试文件被迫大规模改写（shim 的目的就是零改写；codemod 只允许 spike 已验证的可移植小改动）。
- A2：迁移后丢失用例——每包迁移完成的验收标准是**用例数与 bun 基线一致**（desktop 1041 / sdk 133 / session-ui 71 / ui 8）。
- A3：保留任何对 bun 的隐性依赖（`@types/bun`、bun.lock、setup-bun、文档中的 bun 指令）却声称迁移完成。
- A4：为迁就 Node 而删除/跳过有价值测试（ui-plugins 必须修复而非 skip）。

## 6. 约束

- C1：Node 版本基线 = 仓库实际使用 v24.9.0；`engines` 声明 >=18 但测试基建可要求 >=22（CI 用 22/24）。`import.meta.dirname` 需 >=20.11，已满足。
- C2：shim 必须同时覆盖 ESM（desktop/session-ui/ui，tsx 加载）与 CJS（gateway-sdk，tsx 编译为 CJS，`require("bun:test")` 走 `Module._resolveFilename` 拦截）两种模式。
- C3：已知陷阱（spike 实证，必须绕开）：
  - `node:test` 的 mock fn 是 Proxy，`.mock` 不可覆写——**不要包装 node:test mock**，直接用 `jest-mock` 的 `fn`/`spyOn`。
  - jest `expect@29` 的 ESM 入口无 default 导出——用命名导入 `import { expect } from "expect"`；CJS 侧 `require("expect").expect ?? .default`。
  - tsx 的 esbuild 版本与 workspace hoist 的 `@esbuild/win32-x64` 可能不匹配（spike 中 0.25.12 vs 0.28.2）——安装时需在 lock 中固定或升级对齐。
  - PowerShell 做文件 codemod 会毁 UTF-8 编码——codemod 一律用 node 脚本。
- C4：bun 专属 API 清单（spike 全量盘点）：`toBeTypeOf`（1 处）、`import.meta.dir`（10，已修）、`Bun.file/write`（3，已修）、`import { $ } from "bun"`（desktop scripts + packages/ui scripts）、test 内联 `require`（1，已修）、`?url` 导入（silero.ts 1 处，loader stub）、`.css` 导入（组件源码，loader stub）。

## 7. 方案（builder 可读）

### 7.1 共享 shim 包（新，或归入现有 dev 基建）

位置建议 `packages/test-shim/`（npm workspace，private），导出：

- `bun-test-shim.mjs`（ESM）：重导出 `node:test` 的 `test/it/describe/beforeEach/afterEach` + `before as beforeAll` / `after as afterAll`；`expect`（jest `expect` 包命名导入 + `expect.extend({ toBeTypeOf })`）；`mock`/`spyOn`（jest-mock 的 `fn`/`spyOn`，`mock.module` 显式 throw）；`test.each`/`describe.each`（`%s`/`%p` 格式化）；`jest.fn`、`xtest/xdescribe` 兼容出口。
- `bun-test-shim.cjs`（CJS 同构）。
- `register.mjs` + `resolve-hook.mjs`（ESM：`bun:test`→shim、`.css`→空 stub、`?url`/`?raw`→路径字符串 stub）。
- `require-hook.cjs`（CJS：`Module._resolveFilename` 拦截 `bun:test`）。
- 冒烟测试：用 shim 自身跑 3-5 个覆盖 mock/spyOn/test.each/toBeTypeOf 的用例。
- **类型入口**（我的决定，2026-10-21 builder 检查 Q1）：附带 `bun-test.d.ts` ambient 声明（`declare module "bun:test"`，类型从 shim 实现导出）。session-ui/ui 的 tsconfig 当前为 `"types": ["vite/client", "bun"]` 且纳入测试文件——移除 `@types/bun` 后 `"bun"` 改为指向 shim 类型入口（types 或 paths），保证 79 个测试文件的 `from "bun:test"` 导入在 `tsgo --noEmit` 下仍有类型。desktop/gateway-sdk 的 tsconfig 不纳入测试文件，不受影响。
- 依赖声明：`expect@^29`、`jest-mock@^29`、`tsx`（devDep 落实到使用方包，不能只靠传递依赖）。

### 7.2 各包切换（每包同一模板）

```jsonc
// package.json scripts
"test": "node --import tsx --import <shim>/register.mjs [--require <shim>/require-hook.cjs] --test <globs>"
```

- desktop（ESM）：globs 需显式覆盖 `src/**/*.test.ts`、`tests/*.test.ts`、根级 `electron-builder.*.test.ts`、`gateway-update/*.test.ts`（**node 无 bun 的自动发现**，spike 实测漏 3 文件 = 25 用例）。
- gateway-sdk（CJS）：`src/*.test.ts` + require-hook。
- session-ui / ui（ESM）：`src/**/*.test.ts`；`--only-failures` 参数删除。
- 验收：每包用例数 == bun 基线，0 fail（gateway-sdk 的 2 个存量失败经 G7 修复后同样 0 fail）。

### 7.3 ui-plugins.ts 修复（G3）

`loadModule`/`delete require.cache` 两处裸 `require` → `createRequire(import.meta.url)`（electron-vite CJS 产物中 `import.meta.url` 可用性需验证；若不可用则注入 `__filename` 兜底或改为构建期注入）。修后 desktop 应 1041/1041。

### 7.4 脚本批迁移（G4）

- `packages/desktop/scripts/*.ts`（finalize-latest-json / copy-metainfo / utils / stage-gateway / predev / prebuild 等）：`Bun.$`→`node:child_process`（或引入 execa，**倾向零新依赖用原生**）、`Bun.file/write`→`node:fs/promises`、`Bun.env`→`process.env`、`Bun.argv`→`process.argv`；package.json 中 `bun ./scripts/...` → `node --import tsx ./scripts/...`。
- `packages/ui/script/pack.ts`、`publish.ts`（`import { $ } from "bun"`）与 `generate:tailwind`/`generate:v2-oc2` 同理。
- `native:build` 的 `bun install --cwd native` → `npm install --prefix native`。
- `@types/bun` 从 desktop/session-ui/ui 的 devDependencies 移除。

### 7.5 CI 与文档（G5/G6/G7）

- `ci.yml`：删 setup-bun 步骤与 pin 注释；desktop 测试步骤改 npm script；**新增 gateway-sdk / session-ui / ui 三个测试步骤**（node 运行）。
- gateway-sdk 2 个存量失败修复（G7）：①contract 无漂移测试——client.ts:627/631 的 `goals.timeline`/`retryNode` 两个端点补登 contract 清单；②SSE `opencode_event` envelope 解包断言修正。均为小修，随迁移一并交付。
- `desktop-release.yml`：同；`bun stage-gateway` → node 运行。
- AGENTS.md §5.5/§6.6 等 bun 表述更新；根 `test:desktop` script 更新。

## 8. 留给 builder 的决定

- shim 放 `packages/test-shim/` 新包 vs 挂进现有包——建议新包（四包平等依赖，语义清晰）。
- 脚本批迁移用原生 `node:child_process` 还是 execa——建议原生（零新依赖），若读性太差局部再议。
- 迁移顺序——建议：shim 包 → gateway-sdk（最小）→ session-ui/ui → desktop（含 ui-plugins 修复）→ 脚本批 → CI/文档。
- 是否保留 bun 作为可选 runner 一段时间——建议不留（与动机 1/3 冲突），一次性切干净。

## 9. 验收总表

| 项 | 标准 |
|---|---|
| desktop | `npm test` = node，1041 用例全绿（含 ui-plugins 修复后） |
| gateway-sdk | 133 用例**全绿**（2 个存量失败已修，G7） |
| session-ui / ui | 71 / 8 用例全绿 |
| CI | 无 setup-bun，双 OS 绿；**含 gateway-sdk/session-ui/ui 测试步骤** |
| typecheck | session-ui/ui 移除 `@types/bun` 后 `tsgo --noEmit` 绿（shim d.ts 承接） |
| 依赖面 | 无 `@types/bun`、无 bun script 调用、无 `from "bun"` |
| 文档 | AGENTS.md / ci 注释无 bun 运行依赖表述 |
