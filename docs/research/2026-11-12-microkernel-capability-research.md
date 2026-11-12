# 固定核心 + 可替换能力：调研与 spike

- 日期：2026-11-12
- 目标：把 gateway / desktop 从“功能单体内聚、零散扩展点”改造成“固定核心 + 可替换能力 provider”
- 结论：方向成立；应采用**逻辑微内核**（ISA / 内核 / driver / 用户态四层），先做能力注册表与一个真实 provider 的 spike，不整体重写 `MafwScheduler`

## 1. 调研问题

1. gateway / desktop 当前真正的固定核心是什么？
2. 现有扩展点里，哪些是真实契约，哪些只是内部 seam 或死代码？
3. 要做到“除核心外都可换”，还缺哪些能力面？
4. 业界（DSH/Cordis、OSGi、VS Code、微内核）哪些模式可借，哪些不能借？
5. 第一个可执行 spike 选谁，能证明什么、不能证明什么？

## 2. 现状：gateway

`gateway/src/kernel.ts` 仍是 6,906 行的组合根（`class MafwScheduler` 起于 :413，约 135 个字段、120 个方法）；`gateway/src/index.ts` 只有 39 行，`boot.ts` 27 个 boot step。也就是说，“入口薄了”，但域逻辑和依赖仍集中在 kernel。

### 2.1 MafwScheduler 实际拥有

| 域 | 代表成员 | 类型 |
|---|---|---|
| transport / serve | `serveInstance`、`wsHub`、MCP 端点、serve 退避 | 中心 |
| HTTP / routing | `routeRegistry`、`apiRouteDeps()`、约 50 个 attach 调用 | 中心胶水 |
| sessions / queue | `sessionRegistry`、`busySessions`、`sessionQueue`、`taskService` | 中心（进程表） |
| runtime | `runtime`、`runtimeHost`、`runtimeLoader`、激活/切换 | 中心 |
| events | `eventTaps`、`eventStore`、`eventHub`、`handleRuntimeEvent`、20+ 段 `DISPATCH_STAGES` | 中心 |
| memory | `gatewayDb`、`memoryService`、`workerPool`、consolidation、turn pipeline | 中心 |
| goals / pod | `goalDriver`、`activeGoals`、`registeredProjects`、pod/lead | 中心 |
| automation / standing | `automationEngine`、`eventLayer`、`standingGoals`、`pushGateway` | 中心 |
| media / python / terminal | `mediaService`、`mediaAgent`、`kernels`、`terminalService` | 叶子偏多 |
| TTS / ASR | `ttsRegistry`、`voiceAsrRegistry`、`ttsPluginLoader` | **叶子** |
| usage | `usagePoller`、`usageStatsProvider`、`pluginLoader` | **叶子** |
| plugins | `pluginHost`、`packageManager`、`pluginWebTickets` | 半叶子 |
| persistence / resources | `gatewayDbInstance`、`trajectoryStore`、`quotas`、`governor` | 中心 |

**判断**：约 8 个中心域（runtime、events、sessions、memory、goals、pod、automation、persistence/resources）+ 4 个叶子域（usage、TTS、ASR/voice、media）。中心域不能先动；叶子域适合做 seam。

### 2.2 已有真实能力接口

| 能力 | 接口 | 注册路径 | 消费者 | 生命周期 |
|---|---|---|---|---|
| Runtime | `RuntimeDefinition`（`@mafw/runtime-contract`） | builtin / 文件 / 统一包 runtime contribution | `kernel.ts` 激活 | 热切换时 dispose |
| 统一插件包 | `PluginPackageContext` + `PluginContributions` | `PluginHost.activate` → commit | usage/media/runtime/tts + actions/events | `RegistrationBag` LIFO |
| Usage | `UsageProvider` / `ExternalAdapter` | 内置 / legacy 目录 / 包 | `UsagePoller`、routes | loader stop |
| Media | `PromptFn` / `MediaEngine` | 内置 / legacy / 包 | `MediaService` | loader stop |
| TTS | `TtsEngine` + `TtsProfile` | 内置 / legacy / 包 | `routes/tts.ts`、sentence adapter | loader stop |
| ASR | `AsrEngine` | **仅 builtin** | voice runtime | sidecar stop |
| Commands | `MafwCommandDef` + handler | builtin + markdown 目录 | routes / discovery | unregister |
| MCP tools | `ToolRegistry` | **静态 `DEFINITIONS` + handler map** | MCP server | 无 |
| Embedding | `EmbeddingProvider` | **硬编码 enum factory**（off/local/dashscope） | process singleton | `setEmbeddingRuntime(null)` |
| Automation | `ActionHandler` | 内核注册 + provider rebuild | engine | stop |
| 记忆 | 无接口，具体 `MemoryService` | kernel 直接构造 | MCP/routes/recall | db close |

### 2.3 真实 seam vs 伪 seam

**真实（消费者只依赖接口）**：`TtsEngine`、`ExternalAdapter`、`PromptFn`、`RuntimeDefinition`、`PluginActionRegistry`/`PluginEventRegistry`、`SessionRegistry`、`Scheduler`、`RuntimeAccess`、`RouteRegistry`。

**伪/死/未接线**：

- `HookManager`（`gateway/src/core/hooks/hook-manager.ts`）全仓无 `new HookManager`；`core/hooks/*` 无 importer。
- `StorageBackend`（`core/storage/types.ts`）有实现、无消费者。
- `RuntimeBus.subscribe` 只有 `neutral-runtime` 使用，kernel 不订阅。
- `ttsService` 只作为 readiness flag，实际合成走 `ttsRegistry`，两条 TTS 路径并存。
- `PluginContributions.uiTools` 只登记、不激活；真正 legacy UI 卡在 desktop 的 `~/.mafw/ui-plugins`。

### 2.4 缺口矩阵（“除核心外都可换”还缺什么）

| 能力 | 现状 | 缺口 |
|---|---|---|
| 插件给 agent 加工具 | 统一包没有 `tools` contribution；agent 工具是静态 `TOOL_DEFS` | `tools` contribution + 命名空间 + 会话作用域 |
| canonical 事件订阅/拦截 | 包只能发 `plugin:<pkg>:*`；canonical 名被拒绝 | `observe` / `waterfall` / `serial` / `bail` 契约 + 生命周期 |
| ASR provider | registry 有 `register`，但只有 builtin，`list()` 写死 source | 包贡献 + sidecar 所有权/ledger |
| Embedding/reranker | enum factory + process singleton | name→provider registry + 维度/model-tag + 回填 |
| Automation trigger/action | 闭合 union + 规则文件 | trigger/action contribution + schedule 所有权 |
| Goal node/eval | 闭合 union + 字面分支 | node registration + eval hook |
| Model provider | runtime-owned；网关没有 registry | provider/transport registry 或明确“不换” |
| Commands/skills contribution | builtin + FS scan / 目录 | 包贡献 + 冲突/优先级 |
| Storage backend | 死接口；kernel 直接用 better-sqlite3 | 真 storage port + migration/tx 语义 |
| Notification channel | 类硬编码（MilestonePushNotifier / PushGateway） | `notify()` port + 去重/TTL |

## 3. 现状：desktop

Desktop 的固定壳比 gateway 清楚：Electron 生命周期、窗口/IPC/preload、managed gateway、renderer 布局/路由/focus/session store/SSE、主题 token、命令分发。

### 3.1 现有 UI 扩展点

| 槽位 | 契约 | 信任级别 | 说明 |
|---|---|---|---|
| `panels` | `PluginPanelDescriptor` | 声明式数据 | 右工作台 L2 tab；`viewAction` 拉取 `PluginView` |
| `toolCards` | `PluginToolCardDescriptor` | 声明式数据 | 工具卡；`override:true` 才覆盖内置 |
| `configPages` | `PluginConfigPageDescriptor` | 声明式数据 | schema 表单，load/save 走 action |
| `messageWindows` | `PluginMessageWindowDescriptor` | 声明式数据 | 插件事件触发的小窗/模态 |
| `webSurfaces` | `PluginWebSurfaceDescriptor` | 沙箱 `<webview>` | 自带 HTML/JS；bridge allowlist；可加左栏 rail |
| plugin actions | `PluginActionDescriptor` | 网关进程内可信代码 | UI → gateway action，JSON in/out |
| plugin events | `PluginEventDescriptor` | 数据 | `plugin:<pkg>:*`，只允许本包命名空间 |
| web bridge | `window.mafwPlugin` | 沙箱页面 | `context/invoke/onEvent/setBadge/setTitle/openExternal/onThemeChange/onContextChange` |

### 3.2 并行/legacy 体系

- `~/.mafw/ui-plugins/*.js`：main 进程 `require` 可信 CJS，返回声明式 Widget 树；可覆盖内置工具卡。
- `session-ui` 的 `ToolRegistry`：全局 mutable registry，宿主内部 seam，不是第三方契约。
- `PART_MAPPING` / `registerPartComponent`：聊天 part 类型 → Solid 组件；内部，无包作用域。
- `DataProvider` / `MarkedProvider` / `FileComponentProvider` / `DialogProvider`：内部组合 seam。

### 3.3 目前关闭的 UI 能力

composer 动作、右键菜单项、标题栏/状态项、聊天 part 渲染器、设置 section、左 dock face、原生 panel 的 rail 入口、文件预览 provider、终端/浏览器 provider、主题/图标贡献。

### 3.4 信任边界

- Renderer：`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`，只暴露命名 `window.api`。
- Web surface：独立 partition + ticket + 路径白名单 + 强制 preload；这是**真正的沙箱**。
- Gateway 插件：在 gateway 进程内执行可信代码；**不是安全沙箱**。
- 如果允许原生 Solid 组件注入，插件会直接获得整个 preload 权限，跨包调用、revision guard、主题/焦点不变量都会失效；不建议作为第一批扩展点。

## 4. 业界模式

### 4.1 DSH / Cordis

- 固定宿主仍在：launcher、profile/bundle/patch、loader/HMR、host/API authz、sandbox/approval、session log、agent-loop 等 required entries。
- 换的是能力实现：LLM adapter、tools、persistence、sandbox、storage、client modules、slots。
- 核心机制：service key + `inject`、`ctx.effect()` 可逆副作用、typed events（emit/waterfall/parallel/serial/bail）、fiber 生命周期、scope/isolate、profile/patch 分层。
- 关键教训：**“everything is a plugin” 也需要 required spine**；不要把它当成“无内核”。

### 4.2 OSGi

- 强项：显式生命周期、服务注册/排序/过滤、包版本与依赖解析。
- 弱项：per-package semver + `uses` 约束 + classloader 在 Node 不可复制；动态更新依赖 JVM class unloading，Node 没有可靠等价物。
- 借概念（状态机、resolve-before-activate、service ranking），不借 classloader/semver 代数。

### 4.3 VS Code

- 静态 manifest + contribution points + activation events + extension host 进程隔离。
- extension host 与 VS Code 同权限，不是安全边界；真正防护靠 marketplace/签名/workspace trust。
- 借“声明式贡献 + 懒激活 + 宿主渲染”，不借“每个扩展一个进程”的成本。

### 4.4 微内核

- 固定：hosting、discovery、lifecycle、contracts/versioning、shared services、policy/authz。
- 可换：drivers/plugins。
- 关键：**逻辑微内核**优先；物理隔离只给不可信代码。Node 进程内调用是 ns 级，进程 RPC 是 0.1–1ms+。

## 5. 目标架构

### 5.1 四层

```text
用户态    desktop shell + UI 插件（panels/tool cards/web surfaces）
  ↑
driver    可替换 provider（runtime/memory/tools/models/media/tts/asr/usage/automation）
  ↑
内核      lifecycle / registry / event bus / policy / persistence primitives / scopes
  ↑
ISA       canonical events / DTO / capability interfaces / manifest / versioning
```

### 5.2 能力三元组

每个能力必须同时设计：

1. **Service Definition**：接口 + 版本 + 语义 + 错误模型。
2. **Provider**：默认实现 + 可替换实现；声明依赖/资源/健康。
3. **Consumer**：只依赖接口，不 import 实现。

一个包可以同时承担多个角色，但单一角色不构成 seam。

### 5.3 注册表能力

生产内核至少需要：

- `defineService<T>(id, version)`：能力定义。
- `registerProvider(manifest, factory)`：provider 注册。
- `inject` / `requires`：拓扑激活，循环失败。
- `effect` / `dispose`：LIFO 可逆生命周期，失败隔离。
- `revision` / `health` / `fallback`：替换、降级、回滚。
- `scope`：global / workspace / session / agent。
- `priority`：同名 provider 的解析顺序。
- `diagnostics`：谁加载了什么、失败原因、最后已知良好。

### 5.4 替换分级

| 级别 | 语义 | 适用 |
|---|---|---|
| L1 安装时替换 | 改配置/装包，重启生效 | 大多数 provider |
| L2 作用域选择 | 项目/会话解析不同 provider | memory/model/tool 策略 |
| L3 热插拔 | prepare → health → switch → drain → dispose | 无状态 provider |
| 不换 | session log、memory schema、Goal/Pod 状态机、authz/acceptance、scheduler | 核心不变量 |

### 5.5 信任分级

| 级别 | 执行 | 强制 |
|---|---|---|
| core | gateway 进程内 | 代码评审 + 不变量 |
| trusted | gateway 进程内 | manifest 权限 + audit + kill switch |
| untrusted | worker/child 或 sandboxed renderer | 白名单 RPC + 显式授权 |

Desktop：shell 固定；UI 插件保持声明式或沙箱 webview，不把原生 Solid 组件注入宿主。

## 6. 首批 seam 排序

| 优先级 | Seam | 理由 |
|---|---|---|
| 1 | Usage provider | 接口已存在、消费者少、状态低、端到端可观测 |
| 2 | TTS engine | 真实行为（流式/abort/sample rate）、已有三级优先级、包贡献路径 |
| 3 | ASR engine | 能验证“provider 拥有子进程”的生命周期/ledger |
| 4 | Media prompt | 已 90% 抽出，低收益，适合对照 |
| 5 | Desktop context menu / composer / panel rail | UI 侧最小闭环；先做声明式，不做原生组件注入 |

## 7. Spike：CapabilityRegistry + TTS

### 7.1 选择

选 **TTS**，不选 usage：

- TTS 是单 provider `resolve()` 形态，不是 usage 的聚合列表。
- 现有 `TtsEngineRegistry` 已有 builtin/legacy/package 三级优先级，正好映射新注册表。
- 消费者（`routes/tts.ts`、sentence adapter、kernel）不需要改。
- 现有 30 个 TTS 测试是强 oracle。
- 流式/abort 留在 engine 内部，spike 不需要碰 SSE 生命周期。

### 7.2 设计

新增：

- `gateway/src/core/capability-registry.ts`：通用 `CapabilityRegistry<T>`，支持 tier、default、fallback、list、dispose。
- `gateway/tests/unit/core/capability-registry.test.ts`：12 条通用行为。
- `gateway/tests/unit/tts-registry-capability.test.ts`：TTS façade 行为。

修改：

- `gateway/src/tts/registry.ts`：内部改用 `CapabilityRegistry<TtsEngine>`，公开 API 不变；新增 additive `dispose()`。

不动：

- `routes/tts.ts`、`sentence-adapter.ts`、`kernel.ts`、`package-host.ts`、两个 TTS loader。

### 7.3 必须保持的行为

- `DEFAULT_ENGINE = 'mimo'`。
- 同名优先级 package > legacy > builtin。
- 未知名回退 default + 原 warn 文案。
- `resolve('')` 等价于 `resolve()` 且不 warn。
- `list()` 的 source/顺序与现状一致。
- `setLegacyEngines` / `setPackageEngines` 同步、不自动 dispose 被替换的 engine。

### 7.4 成功标准

- 新测试先 RED 后 GREEN。
- 原有 30 个 TTS 测试全绿。
- `npx tsc --noEmit -p tsconfig.json` 通过。
- 架构边界测试通过。
- 不改变任何 HTTP/DTO/公开 API。
- spike 可整体 revert（新增文件 + registry 单文件）。

### 7.5 执行结果（2026-11-12）

在隔离 worktree `spike-capability-registry`（branch `spike/capability-registry-tts`，commit `bbe6eadf`）执行：

- 新增 `gateway/src/core/capability-registry.ts`（~160 行）。
- 改造 `gateway/src/tts/registry.ts`（~65 行，公开 API 不变 + additive `dispose()`）。
- 新增 20 个测试：`capability-registry.test.ts` 13 个、`tts-registry-capability.test.ts` 7 个。
- TDD 过程：先看到 `Cannot find module` / `reg.dispose is not a function` 的 RED，再实现到 GREEN。
- 定向门禁：**88 tests / 88 pass**（6 个原 TTS 套件 30 + 新增 20 + 架构守卫 38）。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- `architecture-boundaries` + `kernel-split-guards`：38/38 通过。

全量 gateway 套件在 worktree 中的结果：

- 首次：853 套件中 3 失败、9 个测试失败。2 个 claude 套件是 worktree 缺 `adapters/claude/node_modules`（junction 后 2/2 通过）。
- 剩余 `tests/integration/plugin-package-e2e.test.ts` 4 个失败：worktree 的 `node_modules` junction 指向主 checkout，`@mafw/runtime-contract` 的 `dist` 与 worktree 源码不一致，`adapters/opencode` 重建时报 `RuntimeDiscoveryRoots` 不存在。这是隔离环境的构建产物问题，不是 spike 代码路径。
- 因此：**spike 定向门禁全绿；全量套件未能在该 worktree 取得干净基线**，不能据此宣称“gateway 全量通过”。

### 7.6 不能证明什么

- 真实资源销毁（当前 TTS engine 没有 dispose 资源）。
- 流式/abort/SSE 生命周期。
- PluginHost 的 candidate/pending/revision 事务。
- 多 provider 聚合（usage）。
- Desktop UI 槽位。
- 热插拔/状态迁移。
- 作用域（project/session/agent）与依赖注入。
- 健康检查与自动回滚。

## 8. 后续建议

1. 把 spike 的 `CapabilityRegistry` 提升为内核候选，但先不要接 `kernel.stop()`。
2. 下一个 spike 选 **ASR**：验证 provider 拥有子进程、ledger、健康/降级。
3. Desktop 先做 **context menu item** 或 **composer action** 的声明式槽位，不做原生组件注入。
4. 在契约层补 `tools` contribution 和只读 `observe` 事件，这是“插件真正能扩展 agent”的关键。
5. 保持四个不换：session log、memory schema/迁移、Goal/Pod 状态机与人类验收、authz/scheduler。
