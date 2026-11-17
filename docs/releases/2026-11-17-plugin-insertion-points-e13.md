# E13 插入点补完 + 无 manifest 边界交付记录（2026-11-17）

- 版本：gateway **4.17.0**（`4.16.1` → `4.17.0`；契约新增可选字段，公开 API 无破坏）
- 性质：三件事收口 —— ① `observers` 成为第五个可声明的 gateway plane；② 诊断去噪 + 不可强制的 desktop 声明可见；
  ③ **无 manifest 的包**（单文件 `.js` 与缺 `plugin.json` 的目录）不再能贡献 `tools` / `observers` / `http`。
- spec：`docs/superpowers/specs/2026-11-17-plugin-insertion-points-e13-design.md`
- plan：`docs/superpowers/plans/2026-11-17-plugin-insertion-points-e13.md`
- 前置：E12（`docs/releases/2026-11-16-plugin-insertion-points.md`）已交付并上线。

## 波次与提交

| commit | 任务 | 一句话 |
|---|---|---|
| `137f7112` | E13 声明面 | `feat(plugin)`: `PluginGatewayContributes.observers?: string[]`；`enforceDeclared` 增加 observer 比对（`observer "<id>" is not declared …`）；契约 +2、validator +2 |
| `6a79fc72` | E13 诊断 | `chore(plugin)`: `enforceDeclared` 在已有形状错误时早退（派生「未声明」不再掩盖首因）；doctor 新增 `contributes-desktop: warn`；validator +2、doctor +2 |
| `9f82af4a` | E13 边界 | `feat(plugin)`: 无 manifest 包不得贡献 `tools` / `observers` / `http`；doctor 单文件文案点明被拒面；host +4、doctor +3、validator +1 |
| `c29d7ccb` | E13 终审修复 | `fix(plugin)`: 判据从「文件形态」改为 **manifest 缺失**（目录形态同样受限）；文案改为 `packages without plugin.json …`；`gateway.md` 补第五个 plane；补 ws-only / 未知键 / v1-observers / 无 manifest 目录 等 5 条用例；README_CONTENT 补边界 |
| `da89afe7` | E13 文案纠偏 | `docs(plugin)`: http 违例单独先报的措辞、doctor 只对 `.js` 提示的措辞、`@param declared` 补 `observers` |
| 本记录 | E13 收尾 | 版本号 + 交付记录 + spec/plan 入库 |

## 1. `contributes.gateway` 的五個 plane

`actions` / `events` / `tools` / `observers` / `http` 每面独立判定，规则与 E12 相同：

| 情形 | 行为 |
|---|---|
| 注册集合 ⊆ 声明集合 | 激活成功 |
| 注册了未声明的条目 | 整包激活失败（逐字文案见下） |
| 声明的 plane 未注册任何条目 | **合法**（上界不是清单） |
| 未声明的 plane | 完全不受约束 |
| `http: false` | 任何一次 `ctx.http.route()` / `ws()` 都让激活失败 |

逐字文案：

- `action "<name>" is not declared in plugin.json contributes.gateway.actions`
- `event "<type>" is not declared in plugin.json contributes.gateway.events`
- `tool "<name>" is not declared in plugin.json contributes.gateway.tools`
- `observer "<id>" is not declared in plugin.json contributes.gateway.observers`
- `http routes are not declared (contributes.gateway.http is false)`

`observers` 声明的是 **id 列表**，不是 descriptor：`onEvent` / `filter` / `timeoutMs` 只能来自
`activate()`，声明的作用是让安装审查能看到包会订阅哪些事件，而不是复制实现。

## 2. 诊断顺序

- `actions` / `events` / `tools` / `observers` 的上界在形状 / 身份校验**之后**由 `enforceDeclared` 检查：
  包已有形状错误时只报形状错误，修好后才报越界。判决不变（两种都是激活失败），好处是首因不被派生错误掩埋。
- `contributes.gateway.http === false` 的检查在派生贡献构建**之前**执行，因此 http 违例**单独先报**，不夹带形状错误。
- doctor 新增两类可见性：`manifest-warnings`（`legacy-permissions` / `legacy-contributes`）、
  `contributes-desktop: warn`（声明了 desktop 面但本 host 无执行点）。两者都是 `warn`，不翻转 `report.ok`。

## 3. 无 manifest 的包（本波唯一的破行为）

判据是 **manifest 缺失**（`parsedManifest?.manifest === undefined`），不是文件形态：

| 形态 | 判定 |
|---|---|
| `~/.mafw/plugins/foo.js` | 无 manifest → 受限 |
| `~/.mafw/plugins/foo/`（无 `plugin.json`，只有 `index.js`） | 无 manifest → 受限 |
| `~/.mafw/plugins/foo/`（有合法 `plugin.json`） | 正常，按 `contributes` 上界约束 |
| `~/.mafw/plugins/foo/`（有非法 `plugin.json`） | 激活前就在 manifest 处失败 |

受限形态：**不得贡献** `tools` / `observers` / `http`，否则整包激活失败，文案
`packages without plugin.json cannot contribute <planes>; ship a directory package with plugin.json`
（plane 按 `tools` → `observers` → `http` 顺序列出实际命中的）。

不受影响：`ui` / `actions` / `events` / legacy（`usage` / `media` / `tts` / `runtime`）照常可用，
单文件包仍以 trusted 在主进程 `require`。

**运维可见影响**：此前能把单文件包当「轻量插件」用的人，如果它贡献了 tools/observers/http，
下次 reload 会失败。当前 `~/.mafw/plugins` 无安装包（仅 README），实际影响为零；
`~/.mafw/plugins/README.md` 已加一句边界说明，但该文件只在目录首次创建时写入，存量安装需删掉才会重新生成。

## 4. 验证

| 门 | 命令 | 结果 |
|---|---|---|
| 契约 | `npm run test:plugin-contract` | **47 tests 全绿** |
| gateway 定向（修复波） | `npx jest --runInBand --forceExit tests/unit/plugins/{package-host,package-validator,plugin-doctor,plugin-http}.test.ts tests/integration/kernel-v2-plugin-host.test.ts` | **5 suites / 114 tests 全绿** |
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json` | **exit 0** |
| gateway 全量（controller 跑，最终 HEAD `da89afe7`） | `npx jest --runInBand --forceExit` | **1010 suites / 8049 tests：8047 passed、2 skipped、0 failed** |

## 5. 新增测试（对 E12 终值）

| 文件 | 变化 | 增量 | 依据 |
|---|---|---|---|
| `gateway/tests/unit/plugins/package-validator.test.ts` | 45 → **50** | **+5** | observers 越界、声明未见、跨平面抑制、同一条目只报形状错 |
| `gateway/tests/unit/plugins/package-host.test.ts` | 30 → **38** | **+8** | 单文件 tools/http/三面全中、无 manifest 目录、单文件与目录的正向回归、ws-only、v1-observers e2e |
| `gateway/tests/unit/plugins/plugin-doctor.test.ts` | 8 → **13** | **+5** | `contributes-desktop` 触发/不触发/空块/非法块、单文件文案 |
| `packages/plugin-contract/src/validate.test.ts` | 44 → **47** | **+3** | observers 接受数组、拒绝非数组、`gateway` 内未知键仍拒绝 |

**本波新增 test case：21**（声明面 4 + 诊断 4 + 边界 8 + 终审修复 5）。另有 1 条既有断言被收紧（非数组 observers 断言失败原因）。

## 6. 已知边界 / 未修

1. **单文件包仍是「无授权的主进程代码」**：本波只收回能力面，没有加安装时授权或签名。
   彻底收口（drops-in 的 JS 也要 human consent）属于 P3/P4，不在 E13 范围。
2. **单文件包仍可贡献 `runtime`**（可替换整个 agent 循环）与 `usage` / `media` / `tts`：
   这些是 legacy 通道，spec 明确保留；能力上比 tool 更大，若要收紧需单独决策。
3. **`contributes.desktop.*` 只校验不强制**：本 host 无执行点，doctor 用 `warn` 把这条差距显式化。
4. **doctor 对无 manifest 的目录包**只报 `plugin.json not found`，不会像 `.js` 那样点名三个被拒面。
5. **`~/.mafw/plugins/README.md` 只在目录首次创建时写入**，存量安装看不到新增的边界说明。
6. **observer 声明只按 id 比对**，不校验 `filter` / `timeoutMs`；未来若要校验需要新键而不是改语义。
