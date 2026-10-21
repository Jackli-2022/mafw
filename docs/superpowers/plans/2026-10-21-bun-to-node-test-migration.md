# Bun → Node 测试与脚本迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 desktop / gateway-sdk / session-ui / ui 四个包的测试从 `bun test` 迁到 `node --test`，顺手修掉 gateway-sdk 2 个存量失败与 ui-plugins 的裸 `require`，并把 Bun 脚本与 CI 依赖一并清除。

**Architecture:** 新建 `packages/test-shim/` 共享包，用 shim（bun:test API 兼容层）+ ESM/CJS 双 loader 钩子承接全部 `from "bun:test"` 导入，测试文件零改写；各包只改 `package.json` 的 test script 与 tsconfig 类型指向。

**Tech Stack:** Node >=22（`node --test`）、tsx（TS/JSX 加载）、jest `expect@^29` + `jest-mock@^29`（bun:test 同款 API 本体）。

**Spec:** `docs/superpowers/specs/2026-10-21-bun-to-node-test-migration-design.md`

## Global Constraints

- 测试文件主体零改写（spec A1）；只允许 spec §2 已列的可移植 codemod（spike 已落盘）。
- 每包验收用例数 == bun 基线：desktop **1041**、gateway-sdk **133**、session-ui **71**、ui **8**；迁移后全部 0 fail（spec A2、G7）。
- 不引入 happy-dom/jsdom（spec N3）；`mock.module` 显式 throw 不实现（spec N5）；`--only-failures` 直接删除不替代（spec N4）。
- 已知陷阱（spec C3，违者必踩）：①`node:test` mock fn 是 Proxy，`.mock` 不可覆写——用 `jest-mock`，不包装 node mock；②`expect@29` ESM 无 default 导出——`import { expect } from "expect"`（命名导入）；③tsx 的 esbuild 与 workspace hoisted `@esbuild/*` 版本必须对齐，装完立即跑一个测试文件验证；④codemod 一律用 node 脚本，禁止 PowerShell 写文件（毁 UTF-8）。
- 所有提交遵循仓库惯例（conventional commits）；TDD：先写/先有失败验证，再实现。

## Review Focus

1. **CI Linux 上 tsx/esbuild 平台二进制不匹配**——spike 在 Windows 撞过 hoist 版本错位（0.25.12 vs 0.28.2）；Linux CI 可能以不同组合复现。Task 1 装依赖后必须在 Linux（CI）与本地各验证一次单文件测试可跑。
2. **Node 版本差**：CI 用 Node 22，本地 24.9——`import.meta.dirname`（>=20.11）与 `node --test` glob（>=22）在 22 上可用，但 Task 3/4/6 的 CI 步骤是真实验证点，本地绿不算数。
3. **新测试文件位置漂移**：node 无 bun 的自动发现，desktop 的 glob 是显式清单（`src/**`、`tests/`、根级 `electron-builder.*.test.ts`、`gateway-update/`）——未来在非常规位置新增的测试文件会静默漏跑。Task 6 的验收步骤含"文件数 == 98"断言钉住这一点。
4. **`--watch` TDD 循环**：`node --test --watch` 与 tsx loader 组合未在 spike 验证。Task 6 加一步手动验证 watch 模式可用（desktop 是 TDD 高频包）。
5. **gateway-sdk CJS 模式回归**：tsx 把无 `type` 字段包的 `.ts` 编译为 CJS，`require("bun:test")` 走 `Module._resolveFilename` 拦截——未来若给 gateway-sdk 加 `"type": "module"`，require-hook 会静默失效。Task 3 在 shim README 与 package.json 注释中标注此约束。

---

### Task 1: packages/test-shim 共享基建包

**Files:**
- Create: `packages/test-shim/package.json`、`packages/test-shim/bun-test-shim.mjs`、`packages/test-shim/bun-test-shim.cjs`、`packages/test-shim/register.mjs`、`packages/test-shim/resolve-hook.mjs`、`packages/test-shim/require-hook.cjs`、`packages/test-shim/bun-test.d.ts`、`packages/test-shim/README.md`
- Test: `packages/test-shim/smoke/smoke.test.mjs`（ESM 侧）、`packages/test-shim/smoke/smoke-cjs.test.cjs`（CJS 侧）
- 基础：`packages/desktop/.spike/` 下的 spike 产物为已验证蓝本（可拷贝后按本任务调整）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 包名 `@mafw/test-shim`（private，workspace）。后续任务依赖：
  - `@mafw/test-shim/register.mjs`（ESM 钩子入口，供 `node --import`）
  - `@mafw/test-shim/require-hook.cjs`（CJS 拦截入口，供 `node --require`）
  - `@mafw/test-shim/bun-test.d.ts`（ambient `declare module "bun:test"`，供 tsconfig `paths` 指向）
  - shim 导出面（与 bun:test 对齐）：`test/it/describe/beforeEach/afterEach/beforeAll/afterAll/expect/mock/spyOn/jest/xtest/xdescribe/setSystemTime`

- [ ] **Step 1: 建包骨架与失败冒烟测试**

创建 `packages/test-shim/package.json`（`"name": "@mafw/test-shim"`、`"private": true`、`"type": "module"`、exports 暴露 `./register.mjs`、`./require-hook.cjs`、`./bun-test.d.ts`；devDeps 声明 `expect@^29`、`jest-mock@^29`、`tsx`）。根 `package.json` workspaces 已含 `packages/*`，无需改。

写 `smoke/smoke.test.mjs`：经 shim 导入 `test/expect/mock/spyOn`，断言 ①`expect(1).toBe(1)` ②`expect("x").toBeTypeOf("string")` ③`mock()` 经 `toHaveBeenCalledWith` 识别 ④`spyOn(obj, "m")` 拦截并 `mockRestore` ⑤`test.each([[1,2,3]])("add %s+%s=%s", ...)` 展开 1 例。写 `smoke/smoke-cjs.test.cjs`：`require("bun:test")` 后断言 `mock`/`expect` 可用。

- [ ] **Step 2: 运行冒烟测试确认失败**

Run: `node --import tsx --import ./packages/test-shim/register.mjs --test packages/test-shim/smoke/smoke.test.mjs`
Expected: FAIL（`bun:test` 无法解析 / register.mjs 尚不存在）

- [ ] **Step 3: 实现 shim 与钩子**

以 `packages/desktop/.spike/bun-test-shim.mjs`、`bun-test-shim.cjs`、`resolve-hook.mjs`、`register.mjs`、`require-hook.cjs` 为蓝本拷贝进包（spike 已验证：desktop 1033/1041、gateway-sdk 131/133、session-ui 71/71、ui 8/8）。要点：`expect` 用命名导入并 `expect.extend({ toBeTypeOf })`；`mock`/`spyOn` 来自 `jest-mock`；`mock.module` throw；`test.each`/`describe.each` 支持 `%s`/`%p`。

新建 `bun-test.d.ts`：`declare module "bun:test"`，从 `node:test`/`expect`/`jest-mock` 重导出类型（`mock` 声明为 `typeof fn & { fn: typeof fn; module: (...a: unknown[]) => never; restore(): void; clearAllMocks(): void }`）。

- [ ] **Step 4: 运行冒烟测试确认通过 + Linux/CI 等价验证**

Run（仓库根）: `node --import tsx --import ./packages/test-shim/register.mjs --test packages/test-shim/smoke/*.test.mjs` 与 `node --import tsx --require ./packages/test-shim/require-hook.cjs --test packages/test-shim/smoke/*.test.cjs`
Expected: 两侧全 PASS（5 + 1 用例）。同时单跑一个 desktop 测试文件确认 esbuild 平台二进制无版本错位（spec C3③；若撞版本错，先修 lock 对齐再继续）。

- [ ] **Step 5: Commit**

```bash
git add packages/test-shim
git commit -m "feat(test-shim): bun:test compatibility shim for node --test migration"
```

---

### Task 2: gateway-sdk 修复 2 个存量失败（G7）

**Files:**
- Modify: `packages/gateway-sdk/src/client.test.ts`（contract 测试）或 contract 清单所在文件（先定位）
- Modify: `packages/gateway-sdk/src/sse.test.ts`
- Test: 同文件

**Interfaces:**
- Consumes: 无
- Produces: gateway-sdk 套件 133/133 的绿基线（Task 3 切换后的验收基准）

- [ ] **Step 1: 定位 contract 清单与两个失败的确切断言**

运行 `bun test`（gateway-sdk 目录）确认当前 2 fail：①`SDK 调用 contract（无漂移）`——client.ts:627/631 的 `GET /api/goals/{}/timeline`、`POST /api/goals/{}/nodes/{}/retry` 不在清单；②`SSEConnection.onmessage unwraps gateway 'opencode_event' envelope`。读两处代码，确定正确行为（contract 应补登两新端点；envelope 名 v2 起为 `mafw_event`，见 AGENTS.md §5.6 wire 契约——断言很可能仍在期待旧名或解包层级错误）。

- [ ] **Step 2: 修 contract 清单（先改测试/清单使其反映正确行为，跑红确认是清单缺口而非代码 bug，再修）**

若是清单缺登：把两端点加入 contract 清单文件。Run: `bun test src/contract.test.ts` → 该测试转 PASS。

- [ ] **Step 3: 修 SSE envelope 断言**

按 v2 wire 契约（`mafw_event` 信封、扁平顶层）修正测试数据或解包断言；若发现是 `sse.ts` 源码 bug 则修源码（TDD：断言先写对）。Run: `bun test src/sse.test.ts` → PASS。

- [ ] **Step 4: 全量确认**

Run: `bun test`（gateway-sdk）→ Expected: **133 pass / 0 fail**。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk
git commit -m "fix(gateway-sdk): register goals timeline/retryNode in contract, fix SSE envelope assertion"
```

---

### Task 3: gateway-sdk 切换 node --test + 入 CI

**Files:**
- Modify: `packages/gateway-sdk/package.json`（test script）
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/test-shim/README.md`（CJS 约束标注）

**Interfaces:**
- Consumes: Task 1 的 `@mafw/test-shim`（register.mjs / require-hook.cjs）
- Produces: CJS 包切换模板（供同形态包参考）；ci.yml 中三包测试步骤的命名约定（`Test gateway-sdk` / `Test session-ui` / `Test ui`）

- [ ] **Step 1: 切换 test script**

`packages/gateway-sdk/package.json`：`"test": "node --import tsx --require ../../packages/test-shim/require-hook.cjs --test \"src/*.test.ts\""`，devDeps 加 `@mafw/test-shim: workspace:*`（与 tsx 对齐）。

- [ ] **Step 2: 本地验证**

Run: `npm test -w @mafw/sdk`
Expected: **133 pass / 0 fail**（Task 2 后基线）。

- [ ] **Step 3: CI 加步骤 + README 标注 CJS 约束**

`ci.yml` 在 desktop 测试步骤旁新增 `Test gateway-sdk`（`npm test -w @mafw/sdk`，双 OS matrix 内）。`packages/test-shim/README.md` 写明：CJS 模式包必须带 `--require require-hook.cjs`；若包改为 `"type": "module"`，须换 ESM 钩子（Review Focus 5）。

- [ ] **Step 4: Commit**

```bash
git add packages/gateway-sdk/package.json .github/workflows/ci.yml packages/test-shim/README.md
git commit -m "ci(gateway-sdk): run tests on node --test via test-shim, add to CI"
```

---

### Task 4: session-ui + ui 切换（含 tsconfig 类型承接）

**Files:**
- Modify: `packages/session-ui/package.json`、`packages/ui/package.json`（test script、删 `--only-failures`、删 `@types/bun`）
- Modify: `packages/session-ui/tsconfig.json`、`packages/ui/tsconfig.json`（`"types": ["vite/client", "bun"]` → 去掉 `"bun"`，`paths` 加 `"bun:test"` 指向 shim d.ts）
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1 的 `@mafw/test-shim`（register.mjs + bun-test.d.ts）
- Produces: tsconfig `paths` 指向 shim 类型的模板：`"paths": { "bun:test": ["../../packages/test-shim/bun-test.d.ts"] }`

- [ ] **Step 1: 先验证失败面**

删 `@types/bun` 前先跑 `npx tsgo --noEmit`（两包现有 typecheck 命令）确认基线绿；改 tsconfig 后预期 79 个 `from "bun:test"` 导入报 TS2307——先跑出这个失败再修。

- [ ] **Step 2: tsconfig 承接 + script 切换**

两包 tsconfig：`types` 去掉 `"bun"`；`compilerOptions.paths` 加 `"bun:test": ["../../packages/test-shim/bun-test.d.ts"]`。package.json：`"test": "node --import tsx --import ../../packages/test-shim/register.mjs --test \"src/**/*.test.ts\""`；删 `@types/bun` devDep；加 `@mafw/test-shim: workspace:*`。

- [ ] **Step 3: 验证测试 + typecheck**

Run: `npm test -w @mafw/session-ui` → Expected: **71 pass / 0 fail**；`npm test -w @mafw/ui` → Expected: **8 pass / 0 fail**；两包 `tsgo --noEmit` 绿。

- [ ] **Step 4: CI 加步骤 + Commit**

`ci.yml` 加 `Test session-ui` / `Test ui`。

```bash
git add packages/session-ui packages/ui .github/workflows/ci.yml
git commit -m "ci(session-ui,ui): migrate tests to node --test, drop @types/bun"
```

---

### Task 5: ui-plugins.ts 裸 require 修复（G3）

**Files:**
- Modify: `packages/desktop/src/main/ui-plugins.ts:31,97`
- Test: `packages/desktop/src/main/ui-plugins.test.ts`（现有 8 个失败用例即验收）

**Interfaces:**
- Consumes: 无
- Produces: desktop 套件 1041/1041 的最后一块（Task 6 验收基准）

- [ ] **Step 1: 确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/main/ui-plugins.test.ts"`（desktop 目录）
Expected: 8 fail，根因 `require is not defined` 被 fail-open 吞掉（loaded 返回 `[]`）。

- [ ] **Step 2: createRequire 改造**

`loadModule`（:31）与 `delete require.cache[require.resolve(full)]`（:97）改为模块级 `const req = createRequire(import.meta.url)`。**先验证 electron-vite CJS 产物中 `import.meta.url` 的可用性**（esbuild CJS 输出通常 shim 为 `__filename` 转换；若验证不可用，用 `typeof __filename !== "undefined"` 兜底双写）。改法必须同时满足：ESM（node 测试）与 CJS（electron-vite main 产物）两形态。

- [ ] **Step 3: 验证**

Run: 同 Step 1 命令 → Expected: ui-plugins.test.ts 全部 PASS。再跑 `npx electron-vite build` 确认 CJS 产物构建无错。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/ui-plugins.ts
git commit -m "fix(desktop): createRequire in ui-plugins loader so ESM test runtime can load CJS plugins"
```

---

### Task 6: desktop 切换 node --test

**Files:**
- Modify: `packages/desktop/package.json`（test script、删 `@types/bun`）
- Modify: `package.json`（根 `test:desktop`）
- Delete: `packages/desktop/.spike/` 全目录、`packages/gateway-sdk/.spike-*.txt`、desktop devDeps 中 spike 残留的 `@vitest/expect`

**Interfaces:**
- Consumes: Task 1（shim）、Task 5（ui-plugins 修复后的绿基线）
- Produces: desktop 显式 glob 清单模板（Review Focus 3 的钉扎点）

- [ ] **Step 1: 切换 test script（显式 glob 清单）**

`packages/desktop/package.json`：`"test": "node --import tsx --import ../../packages/test-shim/register.mjs --test \"src/**/*.test.ts\" \"tests/*.test.ts\" \"electron-builder.config.test.ts\" \"electron-builder.resources.test.ts\" \"gateway-update/*.test.ts\""`。devDeps：删 `@types/bun`、删 spike 残留的 `@vitest/expect`（未使用），`tsx`/`expect`/`jest-mock`/`@mafw/test-shim` 落实为显式 devDep。

- [ ] **Step 2: 全量验证 + 文件数钉扎**

Run: `npm test -w @mafw/desktop`
Expected: **1041 pass / 0 fail**。另跑 `bun test` 对照（此刻 bun 仍可用）：确认两侧 `Ran ... tests across 98 files` 一致——node 侧若少于 98 文件/1041 用例，说明 glob 清单漏文件，先修再继续（Review Focus 3）。

- [ ] **Step 3: watch 模式验证（手动）**

Run: `npm test -w @mafw/desktop -- --watch`（或等价 node --test --watch 命令），改一个测试文件确认自动重跑正常。若 tsx+watch 有兼容问题，降级方案：文档注明 watch 用 `node --test --watch` 直跑纯 TS 子集。

- [ ] **Step 4: 清理 spike 痕迹 + 根 script**

删 `packages/desktop/.spike/`、`packages/gateway-sdk/.spike-*.txt`。根 package.json `test:desktop` 改为 `npm test -w @mafw/desktop`。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci(desktop): migrate 1041 tests to node --test, remove spike artifacts"
```

---

### Task 7: Bun 脚本批迁移（G4）

**Files:**
- Modify: `packages/desktop/scripts/`（finalize-latest-json.ts / copy-metainfo.ts / utils.ts / stage-gateway.ts / predev.ts / prebuild.ts 等所有含 `Bun.` 或 `from "bun"` 的文件）
- Modify: `packages/desktop/package.json`（predev/prebuild/package*/native:build 的 `bun ` 前缀）
- Modify: `packages/ui/script/pack.ts`、`packages/ui/script/publish.ts`、`packages/ui/package.json`（generate:* scripts）
- Test: `packages/desktop/tests/design-contract.test.ts`（已覆盖 electron.vite.config 引用面）；各脚本的手动冒烟

**Interfaces:**
- Consumes: 无（与 Task 1-6 独立，但排在后以免干扰测试基线）
- Produces: 仓库内 `from "bun"` / `Bun.` 零残留（spec A3 验收命令的通过条件）

- [ ] **Step 1: 盘点清单**

Run: `grep -rn 'from "bun"\|Bun\.' packages/desktop/scripts packages/desktop/*.ts packages/ui/script` 与 `grep -rn '"bun \|bun \./' packages/*/package.json package.json`，列出全部命中文件（spike 预估 ~10 个脚本 + 若干 package.json script）。

- [ ] **Step 2: 用 node 脚本做机械替换（禁 PowerShell 写文件，spec C3④）**

映射表：`Bun.$`/`$\`...\``→`node:child_process` 的 `execFileSync`（**原生零依赖**，spec §8）；`Bun.file(x).text()`→`readFileSync(x, "utf8")`；`Bun.write`→`writeFileSync`；`Bun.env.X`→`process.env.X`；`Bun.argv.slice(2)`→`process.argv.slice(2)`。package.json 中 `bun ./scripts/x.ts`→`node --import tsx ./scripts/x.ts`、`bun install --cwd native`→`npm install --prefix native`、`bun run script/y.ts`→`node --import tsx script/y.ts`。

- [ ] **Step 3: 逐个冒烟**

desktop：`npm run prebuild -w @mafw/desktop`、`npm run package:win -w @mafw/desktop`（至少跑到 stage-gateway 完成，electron-builder 全打包可选）；`npx electron-vite build` 全绿。packages/ui：`npm run generate:tailwind -w @mafw/ui`。`design-contract.test.ts` 保持绿（Task 6 已验证的套件会兜住回归）。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop packages/ui package.json
git commit -m "refactor(scripts): replace Bun APIs with node:fs/child_process across dev and release scripts"
```

---

### Task 8: CI 清理与文档收尾（G5/G6）

**Files:**
- Modify: `.github/workflows/ci.yml`（删 setup-bun 与 pin 注释）
- Modify: `.github/workflows/desktop-release.yml`（删 setup-bun；stage-gateway 改 node 运行）
- Modify: `AGENTS.md`（§5.5 desktop 构建、§5.9b 测试、§6.6 CI 等 bun 表述）
- Modify: `CLAUDE.md` 或等效 contributor 文档（如有 bun 提及）

**Interfaces:**
- Consumes: Task 3/4/6（CI 中新测试步骤）、Task 7（脚本无 bun 后 stage-gateway 才能用 node 跑）
- Produces: spec §9 验收总表的全绿状态

- [ ] **Step 1: 先跑一次全绿 CI 基线**

push 前本地 `act` 不可用则直接推分支看 CI——确认 Task 3/4/6 加的测试步骤在双 OS 绿（Review Focus 1/2 的真实验证点）。

- [ ] **Step 2: 删 setup-bun + pin 注释 + desktop-release 改造**

`ci.yml`：删 `oven-sh/setup-bun@v2` 步骤与上方四行 pin 注释。`desktop-release.yml`：同删；`bun stage-gateway` 类调用改 `node --import tsx scripts/stage-gateway.ts`（对齐 Task 7 的 script 改法）。注意 desktop-release 还有 `bun_install_flags` matrix 值，一并清理。

- [ ] **Step 3: 文档更新**

AGENTS.md：§5.5「desktop 无 test script、不在 CI」表述已过期（desktop 测试 2026-09 已入 CI，本次又迁移——同步为 node 事实）；`bun test`/`bun ./scripts` 指令全部改为 npm script 形式；§6.6 CI 段落加三包测试步骤说明。

- [ ] **Step 4: 终验（spec §9 全表）**

逐项跑验收总表：四包用例数（1041/133/71/8 全绿）、CI 双 OS 绿含三包步骤、session-ui/ui `tsgo --noEmit` 绿、`grep -rn 'from "bun"\|@types/bun\|setup-bun' --include='*.{ts,json,yml}' packages .github` 零命中（`bun.lock` 若存在于一并删）。

- [ ] **Step 5: Commit**

```bash
git add .github AGENTS.md package.json
git commit -m "ci: remove bun toolchain; docs: update test/build instructions to node"
```

---

## Self-Review 记录

- **Spec coverage**：G1→Task 3/4/6；G2→Task 1；G3→Task 5；G4→Task 7；G5/G6→Task 8；G7→Task 2 + Task 3/4 的 CI 步骤；A1-A4 由各 Task 验收步骤与 Global Constraints 钉住；C3 陷阱 ①②③进 Task 1，④进 Task 7；Review Focus 5 条均已落到具体 Task 步骤。
- **Type consistency**：shim 导出面（Task 1 Produces）与 Task 3/4/6 消费的入口名一致；`@mafw/test-shim` 包名全文一致。
- **Proportion**：spike 已验证的实现细节（shim 内容）以蓝本引用代替复制，plan 不含大段实现代码。
