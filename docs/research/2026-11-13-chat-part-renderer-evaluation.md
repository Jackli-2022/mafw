# Chat Part Renderer 评估（Phase 4 / 4.7）

- 日期：2026-11-13
- 状态：评估完成，**决定暂不实现**
- 范围：插件包能否为 chat transcript 的 part 贡献自定义渲染
- 相关：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md`、`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 结论落点：Phase 4 的 `chat part renderer` 槽位以「评估 + 明确边界」关闭，不新增 contract / gateway / desktop 代码。

## 1. 结论

**Phase 4 不实现 chat part renderer。** 当前 chat part 渲染保持宿主独占：

1. 工具 part 已经有声明式扩展点 `ui.toolCards`：插件包只提供 `viewAction`，desktop 在工具 settled 后调用它，并用 `PluginViewRenderer` 渲染受限 Widget 树；失败/过期/空结果回退原工具卡。
2. 非工具 part 中，`data-<name>` 已经有通用渲染：`DataPartCard` 显示名称、`transient` 标记和 pretty JSON。数据本身由 gateway 校验（名字白名单、≤64KB、JSON 可序列化）并持久化到 `session_data_parts` overlay。
3. 通用 `PART_MAPPING` / `registerPartComponent` 是 renderer 内部 API，不是插件契约；插件包无法访问，也不应通过 IPC 接收 Solid 组件。
4. 真正缺少的只有「把某个 `data-<name>` 渲染成结构化卡片」这一种能力；目前没有已安装包或第一方功能被它阻塞，提前开槽会增加 contract、冲突裁决、流式更新和生命周期四类复杂度。

**如果未来出现真实需求，唯一建议的实现形状是 `ui.dataPartCards`：**

```ts
interface PluginDataPartCardDescriptor {
  id: string
  /** `data-<name>` 的 name 部分，例如 `swarm-progress`。 */
  name: string
  viewAction: string
}

interface PluginUiContribution {
  // ...
  dataPartCards?: PluginDataPartCardDescriptor[]
}
```

语义：desktop 把 `data-<name>` part 的 `{ name, data, partID, messageID, sessionID, transient, truncated }` 作为 action input 交给同包 `viewAction`，用现有 `PluginViewRenderer` 渲染返回的 `PluginView`；失败、非法输出、revision 过期、没有声明者时一律回退 `DataPartCard`。

**不接受的形状**：插件注册 Solid/原生组件、通用 `partRenderers` 覆盖 `text`/`reasoning`/`tool`/`file`/`compaction`、每个 part 一个 sandboxed webview、插件源码在 renderer 执行。

## 2. 现状：part 是怎么到屏幕上的

### 2.1 类型与分发

`MafwPart` 是判别联合（`packages/gateway-sdk/src/view-dto.ts:111`），现役变体：

- `text`
- `reasoning`
- `tool`
- `file`
- `step-start` / `step-finish`
- `compaction`
- `agent`
- `data-${string}`（`packages/gateway-sdk/src/view-dto.ts:156`）

session-ui 的分发只有一条链：

```ts
// packages/session-ui/src/components/message-part.tsx:1529
const component = createMemo(() =>
  PART_MAPPING[props.part.type]
  ?? (isDataPartType(props.part.type) ? DataPartCard : undefined))
```

- `PART_MAPPING` 是可变的模块级表（`message-part.tsx:275`）。
- `registerPartComponent(type, component)` 是 renderer 内部注册函数（`message-part.tsx:987`），当前只有 desktop 的 `ThinkingBlock` 用它覆盖 `reasoning`。
- 未知 part 不渲染；`data-*` 先过 `isDataPartType`（`data-part-model.ts` 的 `^data-[a-z0-9][a-z0-9_-]{0,31}$`）。
- `renderable()` 明确放行 `data-*`（`packages/session-ui/src/components/parts-rules.ts:54`）。

这条链的事实含义：**part 渲染器是宿主代码，不是数据。** 插件即使能发任意 JSON，也无法让 renderer 执行自己的组件。

### 2.2 非工具 part：`DataPartCard` 是唯一通用兜底

`DataPartCard`（`packages/session-ui/src/components/data-part.tsx:7`）渲染：

- `data` 徽标 + part 名称
- `transient` 标记
- 最多 8KB 的 pretty JSON（`data-part-model.ts`，超出截断）
- 空数据 / 不可序列化数据有专门文案

gateway 侧的数据面（`gateway/src/core/data-parts/data-part-service.ts`）：

- 名字：`[a-z0-9][a-z0-9_-]{0,31}`，落库为 `data-<name>`
- 数据：JSON 可序列化，≤64KB（`DATA_PART_MAX_BYTES`）
- id：`data_` 前缀、session 作用域
- 持久化：`session_data_parts` overlay，按会话保留最近 KEEP 条
- 更新：同 id 原地更新并广播 `part.updated`
- 进入历史：与 runtime 历史按 id 合并

这是现成的「插件/工具 → 结构化数据 → transcript」通道，但 desktop 只把它当 JSON 看。它也是本评估里唯一值得扩展的缺口。

### 2.3 工具 part：`ui.toolCards` 已经解决

统一插件包的工具卡路径（`packages/desktop/src/renderer/mafw/plugins/PluginToolCard.tsx`）：

- descriptor：`PluginToolCardDescriptor { id, tools, override?, viewAction }`（`packages/plugin-contract/src/types.ts:85`）
- pending/running 时原卡继续渲染；settled 后调用一次 `viewAction`
- 输入是中性 `ToolCardModel`（tool / input / output / metadata / status / error / truncated），预算 256KB
- 输出必须是 `PluginView`，由 `PluginViewRenderer` 解释 Widget
- 无效输出 / action 失败 / generation 过期 → 回退原卡
- revision 变化时 controller 恢复原卡、释放 claim；`override: true` 才允许覆盖内置/legacy 卡
- `handlesError: true` 让错误 part 也能进入插件卡，同时 fallback 自己显示错误文本

`PluginViewRenderer`（`packages/desktop/src/renderer/mafw/plugins/PluginViewRenderer.tsx:21`）只接受声明式 Widget：

`text` / `code` / `kv` / `tags` / `list` / `row` / `image` / `link` / `markdown` / `progress` / `action`

- markdown 先转义再解析，链接只允许 `http(s)` / `mailto` / 受控相对路径，图片只允许 inline raster data URL
- 未知 Widget 降级为文本，不执行任意 HTML/CSS/JS
- `action` Widget 通过同包 action 调用，返回 `PluginView` 可替换当前视图

**结论：工具 part 的自定义渲染已经存在，而且正是本评估推荐的形状。** chat part 槽位不应重复建设。

## 3. 需求判断

### 3.1 现在有什么真实缺口

| 需求 | 现有能力 | 缺口 |
|---|---|---|
| 工具执行结果自定义展示 | `ui.toolCards` + `PluginViewRenderer` | 无 |
| 工具卡覆盖内置卡 | `override: true` + claim/restore | 无 |
| 工具卡错误态 | `handlesError` + fallback | 无 |
| 非工具状态/进度卡片 | `data-*` + `DataPartCard` JSON | 无结构，但可读 |
| 流式中间态结构化展示 | `data-*` 原地更新 + JSON | 无自定义视图 |
| 插件在 transcript 内嵌任意 UI | 无 | 明确不允许 |
| 插件在 transcript 内嵌 web 页面 | 无 | 不推荐（见 §5） |

### 3.2 为什么现在不开槽

1. **没有消费者。** 当前仓库内没有统一插件包声明 data part 卡；第一方工具都用 `ui.toolCards`。为一个假设需求增加 public contract，成本高于收益。
2. **data part 的语义比 tool part 弱。** 它没有 `status`，没有明确的 settle 信号，同 id 会高频原地更新。要做对必须解决「何时调用 viewAction」：每次更新都调用会把 gateway action 变成流式热点；只在某个时间点调用又没有权威 settle 标记。
3. **冲突裁决不可回避。** `data-<name>` 是全局名字空间；两个包声明同一个 name 时必须有确定性规则（first claim wins / revision order / 诊断），否则 transcript 会随安装顺序变化。
4. **收益可以用更小的改动拿到。** 多数「结构化展示」需求可以做成工具（`ui.toolCards`），或者由工具 action 打开 panel / message window；chat 内只保留摘要。

### 3.3 重新开槽的触发条件

满足任意两条再启动实现：

- 至少两个真实插件包（或一个第一方功能）被 `DataPartCard` 的 JSON 视图阻塞；
- 需要展示的是「非工具产生的连续状态」，例如长任务进度、外部事件流、后台同步状态；
- 现有 `ui.toolCards` / panel / message window 无法合理承载；
- 能接受「流式更新时最多每 N ms 调用一次 viewAction」的额外 gateway 负载。

## 4. 推荐设计（未来实现时）

### 4.1 Contract

```ts
export interface PluginDataPartCardDescriptor {
  id: string
  /** `data-<name>` 的 name 部分；必须是合法 data part 名。 */
  name: string
  viewAction: string
}

export interface PluginUiContribution {
  // ...
  dataPartCards?: PluginDataPartCardDescriptor[]
}
```

限制建议：

- `PLUGIN_UI_LIMITS.maxDataPartCards = 8`（每包）
- `name` 必须匹配 `^[a-z0-9][a-z0-9_-]{0,31}$`
- 每包内 `id` / `name` 唯一；`viewAction` 必须引用同包 action
- v1 不提供 `override`：只接管「没有声明者」的 data name；通用 JSON 卡是 fallback，不是可覆盖的内置卡
- 不允许声明 `text` / `reasoning` / `tool` / `file` / `compaction` 等现役 part 类型

gateway 复用 `validateClientDescriptor` + `buildClientDescriptor` 投影，不需要新的 action 通道。

### 4.2 Desktop 数据流

```text
committed descriptors
  → resolveDataPartCards()            纯函数：name → 唯一 claimant（first wins）
  → DataPartCardController            仿 plugin-tool-card-registry
      - revision 变化：先恢复 fallback，再注册新 claim
      - stale generation：响应回来时丢弃
      - remove：释放 name，回到 DataPartCard
  → session-ui DataPartRendererRegistry（新增宿主侧 registry，按 name 查组件）
      - 未命中：DataPartCard（现状）
      - 命中：DataPartCardProxy
  → Proxy:
      - 输入 model { name, data, partID, messageID, sessionID, transient, truncated }
      - 渲染 PluginViewRenderer
      - action widget → window.api.mafw.plugins.invoke(pkg, action, input, sessionID)
      - 失败 / 非 PluginView / 空 → DataPartCard
```

关键点：

- **session-ui 仍然不 import 插件代码。** 只新增一个 `DataPartRendererRegistry`（`name → Component`）；desktop 宿主注册 proxy，插件永远接触不到 registry。
- **不改 webview / preload。** proxy 只用现有 `window.api.mafw.plugins.invoke`。
- **不改通用 part 分发。** `PART_MAPPING` 继续只服务宿主内置 part；data part 走独立 registry，避免把 `data-*` 提升成可覆盖一切的第二套 `PART_MAPPING`。

### 4.3 流式与调用节流

data part 没有 `status`，建议 invocation key：

```text
key = `${part.id}:${fnv1a(stableStringify(part.data))}`
```

- 只在 key 变化时调用 viewAction；同一 payload 不重复调用。
- 更新间隔 < 150ms 时做 trailing debounce，只保留最后一次。
- 响应带回时检查 `pluginGeneration` + `partID` + key 仍然是当前值；否则丢弃。
- 正在飞行的请求不取消，但结果不落地，避免 gateway action 被中断成半成品。
- `transient: true` 的 part 不持久化，但渲染语义相同；proxy 不因 transient 跳过。

### 4.4 预算与安全

- data payload 已经 ≤64KB；action input 再按 `maxToolPayloadBytes`（256KB）做结构化裁剪，带 `truncated: true`。
- Widget 渲染继续走 `PluginViewRenderer` 的链接/图片/markdown 策略。
- action 调用继续受 `timeoutMs` / `maxActionTimeoutMs` / 网关 action registry 约束。
- 不接受 wildcard name、正则 name、`data-*` 全匹配。
- claim 是显式的；安装的包本来就能注册工具/action，data part 不构成新的机密边界，但仍应避免静默抢占。

### 4.5 测试清单（实现时）

- contract：合法 name/action/icon 拒绝规则、每包上限、重复 name、非法 name、跨包 action。
- 纯模型：claim 解析确定性、first wins、revision 恢复、remove 释放、无声明者回退。
- session-ui：registry 未命中回退 `DataPartCard`；命中时用 proxy；registry 清空后恢复。
- desktop proxy：成功渲染 PluginView、action widget 调用、失败回退、非法输出回退、stale generation 丢弃、payload 截断、debounce 只调用一次。
- 接线：`DataPartCardProxy` 不读取插件源码、不 import `PART_MAPPING`、不新增 preload 方法。

## 5. 被否决的方案

### A. 保持现状（只做评估，不实现）

- 优点：零风险；data part JSON 已经可读；工具卡已覆盖主要结构化需求。
- 缺点：复杂 data part 只能看 JSON。
- 结论：**本 phase 采用。** 这是有意识的 defer，不是遗漏；触发条件见 §3.3。

### B. `ui.dataPartCards` + 声明式 Widget（推荐，但暂不实现）

- 优点：复用现有 contract / gateway / PluginViewRenderer / action 通道；无插件代码进入 renderer；可按 revision 退订。
- 缺点：需要新增 session-ui registry、desktop controller、流式节流、冲突裁决。
- 结论：未来唯一推荐形状，本文档已给出可执行设计。

### C. 通用 `ui.partRenderers`（拒绝）

- 允许包声明 `part type → viewAction`，包括 `text` / `reasoning` / `tool`。
- 问题： transcript 的复制、TTS、diff、错误态、虚拟滚动、tool 专属动作都依赖这些 part 的宿主语义；一旦可覆盖，插件可以改变用户对消息的理解。
- 工具 part 已有 `ui.toolCards`，不需要第二套。

### D. 每个 part 一个 sandboxed web surface（拒绝）

- 问题：每张卡一个 iframe/webview，滚动高度同步、焦点、主题、可访问性、内存都不可控；webview bridge 还会扩大攻击面（webview 永不拿 apiToken 的约束更难维持）。
- 如果确实需要富交互，正确做法是 action 打开 panel / message window，而不是把页面塞进 transcript。

### E. 插件注册 Solid/原生组件（拒绝）

- 违反 Phase 0 的不变量：插件只交付 data-only descriptor；renderer 不执行插件代码。
- 也无法做 revision 卸载、SSR/测试、供应链审计。

## 6. 对现有代码的边界确认

| 边界 | 现状 | 评估结论 |
|---|---|---|
| `PART_MAPPING` | renderer 内部可变表，只有 `ThinkingBlock` 覆盖 reasoning | 不暴露给插件 |
| `registerPartComponent` | session-ui 导出，desktop 内部使用 | 不作为插件 API |
| `DataPartCard` | 所有 `data-*` 的兜底 | 保持默认 |
| `ui.toolCards` | 工具 part 的声明式卡 | 已满足工具场景 |
| `PluginViewRenderer` | 受限 Widget 解释器 | 未来 data part 卡复用 |
| `PluginToolCard` controller | revision/claim/restore/stale 守卫 | 未来 data part controller 的模板 |
| preload / webview | 无变化 | 不新增桥 |

## 7. 决策记录

- **决策**：Phase 4 的 chat part renderer 槽位以评估关闭；不新增 `ui.dataPartCards`、不新增 session-ui registry、不新增 desktop 代码。
- **理由**：没有真实消费者；data part 缺少 settle 语义；工具卡已覆盖主要结构化需求；提前开槽会引入流式调用与全局名字冲突两类长期成本。
- **保留**：`data-<name>` + `DataPartCard` JSON 作为唯一通用兜底；`ui.toolCards` 作为工具 part 的声明式扩展。
- **触发实现的条件**：见 §3.3。
- **实现入口（未来）**：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md` 的 Task 4.7 设计段；contract 先从 `packages/plugin-contract` 开始，再走 gateway 投影、desktop controller、session-ui registry 四步。

## 8. 验证

本次评估只读代码，无生产代码变更。用现有测试确认评估依据：

- `npm run test:plugin-contract` → 44 / 44 pass
- session-ui 定向 `data-part.test.ts` + `parts-rules.test.ts` → 12 / 12 pass
- `npm run test:desktop` → 3758 / 3758 pass（Phase 4 最终基线；含本次新增的 1 个边界守卫）
- gateway 全量 → 7008 passed / 1 skipped / 7009 total（Phase 4 最终基线；本次无 gateway 变更）
- gateway / desktop typecheck 通过（desktop 使用 `tsc`；`tsgo` 依赖当前未安装）

**既存问题（不归因本 phase）**：session-ui 全量测试在当前 HEAD 上有一个既存的 architecture guard 失败——
`packages/session-ui/src/architecture.test.ts` 的 `runtime-literal` 规则（`/\b(?:opencode|claude)\b/i`）
会命中 `OpenCode` 主题名、`opencode-find` 高亮名、story 文案等 10 个文件（引入于 commit `5a171559`）。
本次评估只跑与该决策相关的定向测试；该守卫的收窄属于独立修复项。

## 9. 参考

- `packages/gateway-sdk/src/view-dto.ts:111` — `MafwPart` 判别联合
- `packages/session-ui/src/components/message-part.tsx:275` — `PART_MAPPING`
- `packages/session-ui/src/components/message-part.tsx:987` — `registerPartComponent`
- `packages/session-ui/src/components/message-part.tsx:1529` — `Part()` 分发
- `packages/session-ui/src/components/parts-rules.ts:54` — `data-*` renderable
- `packages/session-ui/src/components/data-part.tsx:7` — `DataPartCard`
- `packages/session-ui/src/components/data-part-model.ts` — 8KB JSON 截断
- `gateway/src/core/data-parts/data-part-service.ts` — 64KB / 持久化 / overlay
- `packages/plugin-contract/src/types.ts:85` — `PluginToolCardDescriptor`
- `packages/desktop/src/renderer/mafw/plugins/PluginToolCard.tsx:49` — 工具卡 proxy
- `packages/desktop/src/renderer/mafw/plugins/plugin-tool-card-registry.ts` — claim/restore/stale
- `packages/desktop/src/renderer/mafw/plugins/PluginViewRenderer.tsx:21` — Widget 解释器
- `docs/releases/2026-archive.md` — T2-3 data part 交付记录
