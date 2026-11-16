# E12 插件插入点标准化交付记录（2026-11-16）

- 版本：gateway 4.16.1（**无版本号变更**；SDK / desktop / mobile 不变）
- 性质：把「固定核心 + 标准插入点」从口号变成可执行约束，只用两处改动：
  ① `plugin.json.contributes` 从「契约里躺着、解析时被丢掉」变成**注册面上界**，
  trusted 与 untrusted worker 两条激活路径都接线；
  ② tools / observers 两个插入点**默认生效**，env 变量从 opt-in 改为 **kill switch**。
  另补一条零 observer 快路径（`db4025ce`）：没有 observer 时不构造 canonical event。
- spec：`docs/superpowers/specs/2026-11-16-plugin-insertion-points-design.md`
- plan：`docs/superpowers/plans/2026-11-16-plugin-insertion-points.md`
- 架构现状：`docs/architecture/gateway.md` §「kernel-v2」Phase 3.5 / Phase 3.6；
  `docs/architecture/plugin.md` §「插件插入点默认生效（2026-11-16）」；
  作者指引 `docs/guides/plugin-authoring.md` §1.1
- TDD：每批先写失败断言 → 红 → 最小实现 → 一个 commit。

## 波次与提交

| commit | 任务 | 一句话 |
|---|---|---|
| `c4ff3e47` | E12 纯层 | `feat(plugin)`: `parsePackageManifest()` 读取并归一化 `contributes`（v2 非法 = error，v1 非法 = `legacy-contributes` warning），`buildActivatedContributions()` 加第 4 个可选参数 `declared` 并逐面比对；9 条纯层用例 |
| `f187bb30` | E12 接线 | `feat(plugin)`: trusted（`package-host.ts` 原地路径）与 worker 路径都把 `parsed.manifest.contributes` 传进校验；host 内补 `http: false` 的 recorder 比对；5 条 host 用例（含 worker 2 条） |
| `c08c9918` | E12 默认生效 | `feat(plugin)`: `readKernelV2LiveFlags()` 改为「显式 `0` / `false` 才关闭」，未设置即开启；`kernel-v2-plugin-host` 集成用例去掉显式 flag；4 条 switch 层用例（含 2 条重写） |
| `db4025ce` | E12 零 observer 快路径 | `fix(plugin)`: `observe()` 在 `observers.size === 0` 时直接返回，跳过 `toCanonicalEvent` 的深度脱敏；2 条用例 |
| 本记录 | E12 修复波 | 终审 A–H：两条激活路径的 trusted 侧补测试、`http: false` 零路由补测试、v1 合法块补测试、kill switch trim/大小写、docs 与 release 记录；+3 条用例 +1 条断言 |
| `76d376d6` | E12 minor 收尾 | `chore(plugin)`: `PackageManifest.contributes` 类型、`validateUnifiedContributions` 认识 `declared`、doctor 新增 `manifest-warnings` 检查（`legacy-contributes` 不再只写不读）、http 错误断言收紧到全文、guide 补两条边界、`kernel.ts` / `event-dispatch.ts` 注释纠偏；+3 条用例 |

## 1. `contributes` 语义：上界，不是清单

对 `contributes.gateway` 的每个 plane 独立判定（`actions` / `events` / `tools` / `http`）：

| 情形 | 行为 |
|---|---|
| 声明的 plane：`activate()` 注册集合 ⊆ 声明集合 | 激活成功 |
| 声明的 plane：注册了未声明的条目 | **整包激活失败**（`action "x" is not declared…` / `event "…" is not declared…` / `tool "x" is not declared…`） |
| `http: false` | 任何一次 `ctx.http.route()` / `ctx.http.ws()` 都让激活失败（`http routes are not declared (contributes.gateway.http is false)`），即使 `activate()` 正常返回 |
| 未声明的 plane | 完全不受约束（向后兼容） |
| 声明了但没注册 | **合法**——包可以按配置 / 能力 / host 版本条件注册 |
| `apiVersion 2` 且 `contributes` 非法 | 激活失败（错误进 Hub state 与 doctor） |
| `apiVersion 1` 且 `contributes` 非法 | 激活成功，`legacy-contributes: <error>` warning，视为未声明、不构成约束 |
| `apiVersion 1` 且 `contributes` 合法 | 与 v2 一样**存储并构成约束** |
| `contributes.desktop.*` | 只做契约校验，**尚未强制**（desktop 进程侧加载不变） |

violation 丢弃的是整次 candidate：已记录的 http 路由、actions/events 与 tool/observer 声明随该 revision 的
`RegistrationBag` 一起退役，旧 revision 保持在线。

## 2. kill switch（不是 opt-in）

| 变量 | 未设置 | `0` / `false` | 其它值 |
|---|---|---|---|
| `MAFW_KERNEL_V2_OBSERVERS` | 开启 | 关闭 | 开启 |
| `MAFW_KERNEL_V2_TOOLS` | 开启 | 关闭 | 开启 |

- 解析是 `trim + toLowerCase` 后比对（与 `gateway/src/voice/config.ts#bool` 同规则），
  `' FALSE '` / `' 0 '` 同样算关闭——拼写大小写不再让它静默保持开启。
- plane 被 kill 时 `registerObserver()` / `registerTool()` **抛带 env 名称的错误**，不是静默 no-op；
  `toolFactory()` 返回 `undefined`。
- 两个 plane 都关闭 → `createKernelV2Live()` 返回 **`null`**，v1 事件链 / tool factory 与 Phase 3.5 之前一致。

## 3. 运维可见的行为变化（plainly）

1. **插件 tools 与 canonical observers 现在默认就是 live 的**。此前需要显式设
   `MAFW_KERNEL_V2_TOOLS=1` / `MAFW_KERNEL_V2_OBSERVERS=1`；现在不设也生效。已安装包声明的 tool
   会立刻出现在 agent 的工具面里（`plugin:<package>:<tool>`），observer 会开始收到脱敏后的 canonical 事件。
2. **已安装的 apiVersion-2 包，如果 `contributes` 非法，下一次 reload 会激活失败**。
   此前该字段被解析层直接丢掉、完全不校验，包能正常激活；现在会 fail-closed。
3. **apiVersion-1 包只要 `contributes` 是*合法*块，就开始受它约束**。以前 v1 的 `contributes` 无论
   内容如何都不生效；现在合法的 v1 块与 v2 同权，注册越界 = 激活失败（只有*非法*块才是 warning-only）。
4. 没有 observer 时事件管线少一次 canonical event 构造与深度脱敏（`db4025ce`），行为无差异。

## 4. 验证

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 定向 | `npx jest --runInBand --forceExit tests/unit/plugins/package-host.test.ts tests/unit/plugins/package-manifest.test.ts tests/unit/runtime/v2-live.test.ts tests/unit/plugins/package-validator.test.ts`（`gateway/`） | **4 suites / 94 tests passed**（0 fail，7.9s） |
| gateway 定向（minor 收尾后） | 同上 + `tests/unit/plugins/plugin-doctor.test.ts` | **3 suites / 83 tests passed**（doctor + host + validator） |
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors（exit 0）** |
| gateway 全量（controller 跑） | `npx jest --runInBand --forceExit` | **1001 suites / 7975 tests**：**7971 passed / 2 skipped / 2 failed**；两条红（`pod/goal-view-projector`、`lead/lead-outbox-read-ack`）源于另一会话在运行途中提交 `2094fb9c`（源码被中途替换），两者在稳定 HEAD 重跑 **2 suites / 11 tests 全绿**，且均不 import 本波任何模块 |

## 5. 新增测试（对 `c4ff3e47^` 的增量）

| 文件 | 基线 → 终值 | 增量 | 依据 |
|---|---|---|---|
| `gateway/tests/unit/plugins/package-validator.test.ts` | 38 → **45** | **+7** | 纯层：actions / events / tools 越界、未声明 plane 放行、声明多于注册合法、`http: false`；minor 收尾 ×1：`validateUnifiedContributions(..., declared)` 透传 |
| `gateway/tests/unit/plugins/plugin-doctor.test.ts` | 6 → **8** | **+2** | minor 收尾：`legacy-contributes` 进入 `manifest-warnings` 检查、干净 manifest 不产生该检查 |
| `gateway/tests/unit/plugins/package-manifest.test.ts` | 6 → **10** | **+4** | 纯层 ×3：合法块归一化、v2 非法 = error、v1 非法 = warning；修复波 ×1：v1 合法块被存储（可构成约束） |
| `gateway/tests/unit/plugins/package-host.test.ts` | 25 → **30** | **+5** | 接线 ×3：v1 无 contributes 回归、`http: false` 拒路由、`http: true` 放行；修复波 ×2：trusted 路径未声明 action 被拒、`http: false` 且零路由可激活 |
| `gateway/tests/unit/plugins/package-host-worker.test.ts` | 4 → **6** | **+2** | 接线：worker 未声明 action 被拒、声明匹配的 worker 放行 |
| `gateway/tests/unit/runtime/v2-live.test.ts` | 6 → **10** | **+4** | switch 层：无 env 即 live、单 plane `0` 只关一个、两 plane 全关 = `null`、零 observer 不构造 canonical event；修复波在既有 flag 用例里加一条 `' FALSE '` 断言（不新增 case） |

**本波新增可执行 test case：24** = 纯层 9 + 接线 5 + switch 层 4（18，初始交付）+ 修复波 3
（trusted 未声明 action、`http: false` 零路由、v1 合法块）+ minor 收尾 3（doctor 2、validator 1）。
另有 1 条既有用例新增断言（kill switch trim/大小写）。

## 6. 已知红 / 边界

1. **gateway 全量 2 条红（非本波）**：`tests/unit/pod/goal-view-projector.test.ts` 与
   `tests/unit/lead/lead-outbox-read-ack.test.ts`。运行途中另一会话提交了 `2094fb9c`（goal 状态发现与
   read receipts），源码被中途替换；两个文件都不 import 本波任何模块，在稳定 HEAD 上重跑
   **2 suites / 11 tests 全绿**。本波定向 suite 始终全绿。
3. **kill switch 错误文案两种措辞**：`v2-live.ts` 在单平面被关时抛 `(MAFW_KERNEL_V2_*=0)`；
   `kernel.ts` 只在两平面都关、bridge 为 `null` 时抛 `(set MAFW_KERNEL_V2_*=1)`。两者各自描述的是
   当前状态与唯一可行修复，均成立；保留原状以免改动已在用的错误文案。
2. **`contributes.desktop.*` 只校验、不强制**：desktop 贡献仍在桌面进程侧按 `ui` 快照加载，
   manifest 的静态 desktop 声明暂无执行点；后续接 desktop 侧校验时再收紧。
3. **worker 路径的声明层是叠加不是替代**：worker 自带 actions/events 白名单，`contributes` 是它上面的
   又一层上界；两层都过才提交。
4. **v1 非法块 = warning-only 是刻意选择**：不能让存量包因为新引入的校验而突然下线；但合法块必须生效，
   否则「声明即约束」在 v1 上就是空话。
