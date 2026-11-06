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

- **3.0 / 3.1**：只能声明 `content: text/event-stream` + `schema: type: string`，**无法把
  流拆成「逐事件类型 + 载荷 schema」**。`callbacks` 描述的是服务端回调（out-of-band），
  `webhooks` 描述的是「对方提供的回调端点」，都不是长连接 SSE 流。
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

## 6. 参考

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
