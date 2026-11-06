# OpenAPI → SDK：接口与事件的代码生成调研（2026-11-06）

> 问题：`gateway-paths.json` / `openapi.json` / `runtime-contract.json` 已经导出，能否进一步用
> OpenAPI 生成 `@mafw/sdk` 的**接口类型**和**事件类型**？哪些能生成、哪些不能、代价是什么。
>
> 结论先行：**接口可以生成（而且仓库已经生成了 path 类型，只差 response schema）；事件不该用
> OpenAPI 生成**——OpenAPI 3.0/3.1 没有 SSE 事件模型，3.2 的 `itemSchema` 工具链未跟齐，
> 事件面应该走「独立 JSON Schema → TS」或 AsyncAPI 作为人类可读层。

---

## 1. 仓库现状（事实与数据）

### 1.1 HTTP 接口链路（已在生产）

```
route-catalog.ts (事实源, RouteRegistry)
  → npm run emit:openapi            # gateway 脚本
  → packages/gateway-sdk/contract/gateway-paths.json   # 只有 paths，无 components
  → merge-contract.mjs
      + overrides.json              # 手写 summary/description/responseSchema（JSON Schema）
  → contract/openapi.json           # openapi: 3.1.0
  → openapi-typescript              # @mafw/sdk gen:api
  → src/api-schema.gen.ts           # paths / operations / components
```

实测数量（2026-11-06，本仓库）：

| 指标 | 数值 |
|---|---|
| paths | 234 |
| operations | 261 |
| 带 `parameters`（path/query） | 129 |
| **带 200 响应 JSON Schema** | **11**（session.list/get/messages、goals.list/get/sessions、memory.search、approvals.list、triage.list、questions.list、automations.list） |
| `overrides.json` 手写 operation 条目 | 20 |
| `api-schema.gen.ts` | 8,970 行（绝大部分是 path/method 脚手架） |
| `client.ts` / `types.ts`（手写） | 1,647 / 1,752 行 |

现状的关键事实：

1. **生成物只被用来做路径漂移守卫**：`src/api-path.ts` 从 `paths` 派生 `ApiPath`，让
   `request()/fetchPath()` 的 path 参数编译期收窄；响应/请求体类型全部来自手写
   `types.ts` / `view-dto.ts`，**没有**从 OpenAPI 生成。
2. 261 个 operation 里只有 11 个有响应 schema，其余生成结果是 `unknown`——所以即便现在
   想「全量生成 DTO」，输入本身也不完整。
3. `MafwClient` 是手写 façade：命名空间方法、`MethodNotSupportedError`（能力缺失的 503
   语义）、SSE 订阅、错误体解析，这些都不是通用生成器能表达的。

### 1.2 事件链路（手写 + 契约元数据）

```
packages/gateway-sdk/src/events.ts     # RUNTIME_EVENT_TYPES / FLAT_EVENT_TYPES（手写 const 数组）
                                       # MafwEventData.properties?: any  ← 事件载荷完全无类型
gateway/src/runtime/mafw-vocabulary.ts # 服务端镜像（vocabulary-sync.test.ts 双向钉扎）
packages/gateway-sdk/contract/runtime-contract.json
                                       # 33 条 events：type/family/requiredFields/consumers/producers
```

事件载荷目前只有「字段名清单」（`requiredFields`），没有 JSON Schema，所以
`properties` 只能是 `any`。desktop/TUI 的穷尽检查只覆盖**事件名**，不覆盖**载荷形状**。

### 1.3 仓库已验证的第三种形态（值得复用）

View DTO 走的是「TS 单一源 → 生成 JSON → 生成镜像」：

```
packages/gateway-sdk/src/view-dto.ts          # 单一事实源（TS 接口 + 字段清单）
  → npm run emit:view-dto                     # contract/view-dto.json（check-in）
  → npm run sync:view-dto                     # gateway/src/runtime/view-dto.generated.ts
freshness: emit --check / 契约测试
```

这说明仓库接受「生成物 check-in + 新鲜度测试」，不依赖运行时生成。事件 codegen 应沿用同一形态。

---

## 2. OpenAPI 能生成什么、不能生成什么

### 2.1 接口（REST 请求/响应）

| 工具 | 输出 | 类型来源 | OpenAPI 3.1 | 适配本仓库 |
|---|---|---|---|---|
| **openapi-typescript**（已在用，devDep） | 纯类型（`paths`/`operations`/`components`） | 文档里的 schema | ✅ | 已接；补 schema 即可见效，零客户端改动 |
| openapi-fetch | 运行时 typed fetch（配 openapi-typescript） | 同上 | ✅ | 可选 transport；社区对比表称其已进入 maintenance（2026 快照），采用前需复核 |
| @hey-api/openapi-ts | types + 每 operation 的 SDK 函数 + fetch client + 插件（zod/query） | 文档 schema | ✅ | 生成物会与手写 `MafwClient` façade 竞争；适合作为内部 transport 试点 |
| orval | types + 每 operation 函数 + hooks + MSW mocks | 文档 schema | ✅ | 同上；仓库不用 React Query，收益低 |
| Kubb | 插件化（types/client/schemas） | 文档 schema | ✅ | 同上；生态较新 |
| openapi-generator / kiota | 多语言完整 SDK | 文档 schema | 3.1 支持参差 | 过重，不适合 TS-only 仓库 |

**判断**：本仓库的正确增量不是换生成器，而是**把 OpenAPI 的响应 schema 补全**。已有
`openapi-typescript` + `ApiPath` 守卫，补 schema 后立刻能在 `components.schemas` / 每
operation 的响应类型上获得编译期收益，且不会与手写 façade 冲突。等 schema 覆盖到一定比例，
再评估是否用 `openapi-fetch` 或 hey-api 生成内部 transport（façade 仍保留）。

补 schema 的两种来源：

1. 手写 `overrides.json`（现状，20 条）——可控但重复。
2. 从 TypeScript 类型反生成 JSON Schema（`ts-json-schema-generator`）→ 写回 `overrides.json`，
   单一源仍是 `types.ts` / `view-dto.ts`。这与 View DTO 的「TS 单一源」哲学一致，避免
   TS 与 schema 双写漂移。

### 2.2 事件（SSE）

OpenAPI 侧：

- **3.0 / 3.1**：**没有 SSE 流的一等模型**——不能像 3.2 那样用 `itemSchema` 描述「逐帧」。
  `callbacks` 描述的是服务端回调（out-of-band），`webhooks` 描述的是「对方提供的回调端点」，
  都不是长连接 SSE 流。
  **但事件 union 仍可搭车**：JSON Schema 2020-12 的 `contentSchema`（字符串字段的解码后 schema）
  可以挂在 `V2EventEncoded` 这类 `type: string` 字段上——opencode 的当前源码正是这么做的
  （见 §6.2）。生成器是否消费 `contentSchema` 取决于工具：openapi-typescript 会生成被引用的
  `V2Event` 联合类型，但帧字段本身仍是 `string`（不会自动把 `data` 改成 `V2Event`）。
- **3.2（新）**：`text/event-stream` 响应支持 `itemSchema`——逐事件 schema 的一等支持；
  还引入 `prefixEncoding`/`itemEncoding` 覆盖 JSONL/SSE/multipart。但本仓库
  `merge-contract.mjs` 产出的是 `3.1.0`，且主流工具链（含 openapi-typescript 7.x）对 3.2
  的跟进尚早，短期不能作为生成依据。

AsyncAPI 侧：

- **AsyncAPI 3.x** 是事件驱动 API 的对口标准（`channels` / `messages` / `operations`），
  SSE 可以作为 `http` server + `text/event-stream` message contentType 表达。
- 工具：`@asyncapi/modelina`（Apache-2.0，多语言模型生成）、Scalar SDK Generator
  （AsyncAPI 输入仍标 experimental）。生态比 OpenAPI 小，TS 生成质量/维护度需实测。
- 价值主要在**文档与生态**（AsyncAPI 渲染器、mock server），对本仓库的 TS 类型收益不如
  直接 JSON Schema → TS。

**判断**：事件不要塞进 OpenAPI。最省事、最可控的路径是：

```
contract-events.ts（或 runtime-contract.json）
  + payloadSchema（JSON Schema，33 条事件）
  → json-schema-to-typescript / quicktype
  → packages/gateway-sdk/src/events.gen.ts（零 import，check-in + freshness 测试）
  → events.ts 的 MafwEventData 改为判别联合
```

生成物零 import 是硬约束（`events.ts` 顶部注释：gateway jest 直接 import，desktop/TUI 经
`@mafw/sdk` import，不允许运行时依赖）。

如果未来要对外发布事件文档，再从同一份 payloadSchema 生成 AsyncAPI 3.1 文档（单向派生，
不作为事实源）。

---

## 3. 推荐方案（按 ROI 排序）

### P0：补 OpenAPI 响应 schema（接口类型的第一步）

- 目标：把 11/261 提升到「SDK 方法覆盖到的 operation 全部有 schema」。
- 做法：优先补 `client.ts` 实际调用的 operation；schema 从 `types.ts` 反生成或用
  `overrides.json` 手写。
- 收益：`api-schema.gen.ts` 的响应类型从 `unknown` 变成真实 DTO；可在 `client.ts` 里加
  `satisfies` 断言，让手写 DTO 与生成类型编译期对齐。
- 门禁：`emit:openapi` → `merge-contract` → `openapi-typescript` 全链已在 CI 外可跑；
  `api-contract.test.ts` 与新鲜度测试继续把守。

### P1：事件载荷 schema → `events.gen.ts`

- 在 `gateway/src/runtime/contract-events.ts` 增 `payloadSchema?: JsonSchema`（或从
  `view-dto`/事件构造点反生成）。
- 新增 `packages/gateway-sdk/scripts/emit-events.mjs`：
  - 输入 `contract/runtime-contract.json`（含 `payloadSchema`）
  - 用 `json-schema-to-typescript`（MIT）或 `quicktype-core`（Apache-2.0）生成
  - 输出 `src/events.gen.ts`：`export interface PartUpdatedEvent { type:'part.updated'; properties: {...} }`
    + `export type MafwRuntimeEvent = ...`（判别联合）
- `events.ts` 保持零 import：`import type { MafwRuntimeEvent } from './events.gen'` 是类型导入，
  编译后消失，满足约束。
- 新鲜度：生成物 check-in；`emit-events --check` 在 CI 比对。
- 兼容：`MafwEventData.properties` 从 `any` 收窄为联合；desktop/TUI 的穷尽检查不变，
  额外获得载荷字段的编译期保护。

### P2（可选）：AsyncAPI 文档派生

- 从同一份 `payloadSchema` 生成 `contract/asyncapi.json`（纯文档/工具生态用）。
- 不进构建关键路径；不替代 `runtime-contract.json`。

### 非目标

- 不生成 `MafwClient` 全量 façade（能力门、SSE、错误语义、DTO 中立性无法由通用生成器表达）。
- 不把 `openapi.json` 升级到 3.2 只为 SSE（工具链未跟齐；事件已走独立 schema）。
- 不引入运行时校验（zod/ajv）到 SDK 热路径（体积与依赖约束）。

---

## 4. 可执行迁移步骤

1. 统计 `client.ts` 实际调用的 operation，生成缺失清单（脚本读 `api-path` 使用点 +
   `openapi.json`）。
2. 为 P0 清单补 `overrides.json` 的 `responseSchema`；重跑 `gen:api`；`tsc` 必须绿。
3. 在 `client.ts` 对 2-3 个高频方法加 `satisfies` 断言（手写 DTO ↔ 生成类型），先验证链路。
4. 在 `contract-events.ts` 增 `payloadSchema`（先覆盖 8 个高频事件：`turn.*`、`part.*`、
   `message.updated`、`permission.asked`）。
5. 新增 `emit-events.mjs` + `events.gen.ts` + `--check` 门禁；`MafwEventData` 切判别联合。
6. 跑 `gateway` / `sdk` / `desktop` / `tui` 全量；补 `contract.test.ts` 的生成物新鲜度断言。

---

## 5. 风险与开放问题

- **schema 覆盖率是瓶颈**：生成器再好，输入只有 11/261 有 schema 也只能产出 `unknown`。
  先补 schema，再谈换工具。
- **双写漂移**：`types.ts` 与 `overrides.json` 同时手写会漂移；优先走「TS → JSON Schema」
  反生成，或至少在 CI 加形状断言。
- **OpenAPI 3.2 时机**：`itemSchema` 是长期正解；等 openapi-typescript/hey-api 支持后再评估
  是否把事件并回 OpenAPI。当前不阻塞。
- **AsyncAPI 工具成熟度**：Modelina 生成 TS 的可用性需 spike 验证；不作为 P1 前置。

---

## 6. 实证：用 opencode 的 `openapi.json` 试生成（2026-11-06）

输入不是仓库文件，而是运行中的 serve 经 gateway 反代暴露的规格：

```bash
# gateway 反代会注入 serve 的 Basic auth，直接取得到
curl -s http://127.0.0.1:3000/openapi.json -o /tmp/opencode-api.json

cd packages/gateway-sdk
npx openapi-typescript /tmp/opencode-api.json -o /tmp/opencode-types.gen.ts
npx tsc --noEmit --skipLibCheck --target es2022 --module esnext /tmp/opencode-types.gen.ts
```

### 生成能力：OK

| 指标 | 结果 |
|---|---|
| 规格 | OpenAPI 3.1.0，`opencode HttpApi`，350,880 B |
| paths / operations / schemas | 138 / 169 / 363 |
| 生成耗时 | 264 ms |
| 生成物 | 15,062 行 / 499,701 B |
| `tsc --noEmit` | rc=0 |

### 与 `@mafw/sdk` 的一致性：不一致（且不应该一致）

| 对比项 | 结果 |
|---|---|
| operationId 交集（opencode 169 vs gateway 261） | **13**（`session.list/create/get/fork/switchAgent/switchModel/prompt/command/diff/background`、`project.list`、`event.subscribe`、`config.get`） |
| 类型名交集（opencode 363 schemas vs SDK 190 exports） | **5**（`Project`、`PermissionRequest`、`FileDiffInfo`、`ModelRef`、`PermissionRule`） |
| `Session.Info` vs SDK `Session` 字段 | 共享 7；opencode-only 9（`fork/cost/tokens/outcome/subpath/metadata/permissions/revert/location`）；SDK-only 3（`directory/status/reverted`） |
| 列表响应信封 | opencode `{ data, cursor }`；gateway `{ sessions }`（messages 是 `{ data, nextCursor }`） |

原因不是「生成器不行」，而是**两边不是同一个 API**：

1. opencode 的 spec 描述的是它自己的原始面（169 ops，含 `server.*`/`plugin.*`/`location.*` 等），
   gateway 的 261 ops 里大部分是 MAFW 自己的（goals/pods/memory/approvals/automations…），交集只有 13。
2. SDK 的 DTO 是**刻意中立**的（View DTO 边界：客户端不读 `{info,parts}` / `revert` / 原生枚举）。
   直接把 opencode 的 16 字段 `Session.Info` 生成进 SDK 会破坏这条架构不变量。
3. 事件仍然不行：`/api/event` 的 SSE 帧 schema 是 `{id?, event, data: V2EventEncoded}`，
   而 `V2EventEncoded = { type: 'string', contentMediaType: 'application/json' }` —— 生成结果是
   `V2EventEncoded: string`。opencode 的 431 个 `Event*` 类型在 **OpenAPI 之外**（SDK 自己的
   代码生成），不在 spec 里。这直接印证了 §2.2 的结论。
4. opencode 用 vendor extension `x-effect-stream: { encoding: 'sse', causeSchema }` 描述流语义；
   openapi-typescript 会忽略它，只生成 `content.schema`（单帧对象）。

### 6.1 和 opencode 自己的 SDK 对得上吗（v2 实测）

opencode 的 SDK 是 `@hey-api/openapi-ts` 生成的（`dist/v2/gen/{types,sdk}.gen.d.ts`）。
用本机 serve（CLI v2.2.5）的 `openapi.json` 与 `@opencode-ai/sdk@1.19.5`（当前安装 1.18.30）的 v2 类型对比：

| 项 | spec（serve） | SDK 1.19.5 v2 | 结论 |
|---|---|---|---|
| 类型数 | 363 schemas | 1,409 exports | 命名/内联策略不同，不能按数量对齐 |
| 方法数 | 169 ops | 188 methods | SDK 含 v1/v2 双份 |
| 列表响应 | `SessionsResponse { data, cursor }` | `V2SessionListResponses[200] = SessionsResponse` | ✅ 一致 |
| `Session.Info` | 16 字段 | `SessionV2Info` 12 字段 | 共享 12；spec 多 `fork/outcome/metadata/permissions` |
| `Provider.Info` | 10 字段 | `ProviderV2Info` 6 字段 | 共享 3；双方各有增量（spec: `canonical/settings/...`；sdk: `disabled/api/request`） |
| `Agent.Info` | 12 字段 | `AgentV2Info` 11 字段 | 共享 11；spec 多 `name` |
| `Permission.Request` | 8 字段 | `PermissionV2Request` 7 字段 | 共享 7；spec 多 `message` |
| `Project` | `canonical` | `worktree` | 字段名不同 |
| **SSE 事件** | 帧 `{ id?, event, data: V2EventEncoded }`，`V2EventEncoded = string` | `V2Event` 联合 **88** 个变体 | ❌ 生成不出来 |

结论：

- **接口**：大体对得上（同一套 schema 源）。差异主要是**版本差**（serve 2.2.5 比 SDK 1.19.5 新）
  与个别字段命名；用 `openapi.json` 生成得到的是**更接近当前 serve** 的形状，对写 runtime 插件有用。
- **事件**：按**本机运行中的旧 spec** 对不上——SSE 的 `data` 是纯 JSON 字符串
  （`contentMediaType: application/json`，没有 `contentSchema`），`openapi-typescript` 只能生成
  `string`；SDK 的 88 个 `V2Event` 变体在 spec 之外。
  **但仓库当前源码不是这样**：`packages/protocol/openapi.json` 的 `V2EventEncoded` 带
  `contentSchema → V2Event`（98 变体），生成器能产出联合类型（见 §6.2）。所以“能不能生成事件”
  取决于用的是哪份 spec：运行中的旧实例不能，仓库当前 spec 能（帧字段仍需手动接线）。

### 6.2 opencode 的 OpenAPI 是怎么生成的（源码级，2026-11-06 查证）

仓库：`anomalyco/opencode`（dev）。生成入口在 `packages/protocol`：

```ts
// packages/protocol/script/generate-openapi.ts
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

const document = format(JSON.stringify(stabilizeOpenApi(OpenApi.fromApi(ClientApi)), null, 2), {
  parser: "json", printWidth: 120,
})
await Bun.write("packages/protocol/openapi.json", document) // --check 只比对不写
```

链路：

```
packages/protocol/src/api.ts + groups/*.ts   (Effect HttpApi)
  → OpenApi.fromApi(ClientApi)                (Effect 官方 HttpApi → OpenAPI 3.1)
  → stabilizeOpenApi()                        (后处理：匿名 Union_N/Objects_N 按内容哈希重命名、
                                               折叠重复 _N 副本、components 排序 → diff 稳定)
  → packages/protocol/openapi.json            (check-in；CI 用 --check 防陈旧)
```

命令：`cd packages/protocol && bun run generate` / `bun run check:generated`。

事件是怎么进 spec 的（`packages/protocol/src/groups/event.ts`）：

```ts
const EventSchema = Schema.Union([...definitions, rpcEvent, serverConnected])
  .annotate({ identifier: "V2Event" })

HttpApiEndpoint.get("event.subscribe", "/api/event", {
  query: /* types?: 字面量联合 */,
  success: HttpApiSchema.StreamSse({ data: EventSchema }),
})
```

Effect 的 OpenAPI 导出器把它写成：

```json
"V2EventEncoded": {
  "type": "string",
  "contentMediaType": "application/json",
  "contentSchema": { "$ref": "#/components/schemas/V2Event" }
}
```

**实测**（本机用 openapi-typescript 7.13 跑仓库的 `packages/protocol/openapi.json`，879,732 B）：

| 指标 | 结果 |
|---|---|
| components.schemas | **497**（运行中 serve 的旧 spec 只有 363） |
| `V2Event` | **存在**，`anyOf` **98** 个变体 |
| `V2EventEncoded` | `type: string` + `contentSchema → V2Event` |
| 生成物 | 16,864 行；`V2Event` 联合被完整生成；`tsc --noEmit` rc=0 |
| 帧字段 | `data` 仍是 `string`（openapi-typescript 不消费 `contentSchema`） |

补充：本机运行中的 serve 暴露的 `/openapi.json` 是**旧构建**（363 schemas、`V2EventEncoded`
没有 `contentSchema`），所以之前「没有事件聚合」的结论只对那份旧 spec 成立；仓库当前源码
（protocol 2.2.5）是**有聚合**的。

### 但它是很好的**适配器层**校验输入

- 可以拿 `Session.Info` / `Session.Message.Info` / `Provider.Info` 等 schema 与
  `gateway/src/runtime/opencode-adapter.ts` 的投影做字段覆盖 diff：升级 opencode 时先看
  spec 增删了哪些字段，再决定 adapter 是否要跟进（比跑起来看 UI 空白更早）。
- 也可以作为 `plugin-audit` 的姊妹工具：`mafw adapter-check --spec <opencode-api.json>`，
  只校验 adapter 输出是否覆盖 spec 的 required 字段，**不**生成 SDK DTO。

### 结论

`openapi.json` 可以生成、生成物可编译，但**不能生成与 `@mafw/sdk` 一致的接口**——两者的 API 面、
DTO 中立性约束、事件模型都不同。它适合当「上游 runtime 的 contract fixture」用于适配器校验，
不适合当 SDK 的生成源。SDK 的生成源仍应是 gateway 自己的 `openapi.json` + 事件 `payloadSchema`。

## 7. 参考

- Speakeasy, *Server Sent Events in OpenAPI*（3.2 `itemSchema`）：
  https://www.speakeasy.com/openapi/content/server-sent-events
- OAI/OpenAPI-Specification Discussion #4171（SSE proposal，3.1 的限制）：
  https://github.com/OAI/OpenAPI-Specification/discussions/4171
- specmatic Discussion #2381（3.1 无法干净建模 SSE 的实证讨论）：
  https://github.com/specmatic/specmatic/discussions/2381
- Pavel Bodiachevskii, *Comparing OpenAPI and AsyncAPI for SSE*：
  https://pavelon.dev/posts/sse-documentation
- Kubb, *Kubb vs orval, HeyAPI, openapi-typescript*（工具对比，含 openapi-fetch 维护状态）：
  https://kubb.dev/docs/5.x/guide/comparison
- DEV Community, *Which OpenAPI Codegen Should You Choose?*（2026-05 对比与生成物体量）：
  https://dev.to/nyaomaru/which-openapi-codegen-should-you-choose-openapi-typescript-vs-hey-api-vs-orval-vs-kubb-100p
- AsyncAPI 3.0 结构（channels/messages/operations）：
  https://www.restguide.info/asyncapi
