# Mobile Gateway P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为移动端远端暴露铺路的四个 gateway 先行修复：鉴权顺序、source 枚举、配对 URL 配置键、Tech Lead 模型可配置。

**Architecture:** 全部是 gateway（Node/TS，jest）小改动，遵循「纯函数/适配器抽取 + 组合根接线」的仓库惯例。P0-1 把内联的 registry dispatch 抽成带鉴权门的可测函数；P0-3/P0-4 各自仿照现有先例（`detectReachableHost`、`resolveNodeModel`/`bindModel`）。

**Tech Stack:** TypeScript (CJS)、jest、现有 RouteRegistry / config.ts / model-config 路由。

**Spec:** `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md` §5（Phase 0）；证据行号见 `docs/research/2026-11-05-mobile-tailscale-pod-research.md` §2。

## Global Constraints

- gateway 全量测试须 `--forceExit`（kernel zeromq 句柄拖住进程，AGENTS §W1 已知）
- 鉴权语义不放松：`空 apiToken + 非 loopback = 全拒`（core/auth.ts:43 既有行为，含 registry 路由）
- `/a2a`、terminal WS、file-history 的 loopback-only 硬约束不动
- dispatch 移位不改变已认证客户端的任何行为（CORS/OPTIONS 顺序保持现状：在 auth 之前）
- 每个 task 一个 commit，消息前缀 `fix(gateway):` / `feat(gateway):`

## Review Focus

1. 非.loopback 无 token 打 registry 路由（如 `POST /api/pods/x/goals`）→ 401（Task 1 测试）
2. 空 apiToken 时 registry 路由对远端全拒（不是放行）（Task 1 测试）
3. loopback 桌面客户端零回归——dispatch 移位后全量套件绿（Task 1 Step 5）
4. `mobile.tailscaleUrl` 优先级：env > config > 自动探测（Task 3 测试）
5. `goal.techLeadModel` 半空对不半用——回落身份内置模型（Task 4 测试）

---

### Task 1: registry dispatch 鉴权门（P0-1）

**Files:**
- Create: `gateway/src/routes/registry-dispatch.ts`
- Modify: `gateway/src/index.ts:5258-5295`（删内联 dispatch 块 5266-5272，auth 之后调用新函数）
- Test: `gateway/tests/unit/routes/registry-dispatch.test.ts`

**Interfaces:**
- Produces: `export async function dispatchAuthorized(deps: { registry: RouteRegistry; apiToken: string }, req: IncomingMessage, res: ServerResponse): Promise<boolean>` — 返回 true 表示已处理（含 401 短路）；false 表示无匹配落回内联链。内部复用 `core/auth.ts` 的 `isLoopbackAddr` + `authorizeRequest`。

- [ ] **Step 1: 写失败测试**

四个用例（fake req/res，参照仓库既有 route 测试的 fake 风格）：
① 非 loopback（`remoteAddress:'100.1.2.3'`）+ 无 token + registry 命中带 handler 的路由 → 断言 res 收到 401 + `{"error":"unauthorized"}` 且返回 true、handler 未被调用；
② 同上但带 `Authorization: Bearer <token>` → handler 被调用、返回其结果；
③ loopback（`'127.0.0.1'`）无 token → handler 被调用（豁免保持）；
④ registry 无匹配 → 返回 false，res 未写任何东西。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/routes/registry-dispatch.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `dispatchAuthorized`**

逻辑：`registry.match` → 无匹配 return false → `authorizeRequest`（loopback/token）→ 未过：`res.writeHead(401); res.end(JSON.stringify({error:'unauthorized'})); return true` → 过：`await handler(req, res, params)`，`handled !== false` 则 return true，否则 false。

- [ ] **Step 4: 接线 index.ts**

请求处理器内：删除 5266-5272 的内联 dispatch 块；在 `authorizeRequest` 判断（5291-5295）之后、CORS/OPTIONS 之后紧跟 `if (await dispatchAuthorized({ registry: this.routeRegistry, apiToken }, req, res)) return;`。注意：authorizeRequest 所需的 `apiToken` 变量声明保持在原位（移到 dispatch 调用之前）。

- [ ] **Step 5: 跑测试 + 全量回归**

Run: `cd gateway && npx jest tests/unit/routes/registry-dispatch.test.ts && npx jest --forceExit`
Expected: 新测试 PASS；全量绿（重点观察 routes/desktop 相关既有套件无回归）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/registry-dispatch.ts gateway/src/index.ts gateway/tests/unit/routes/registry-dispatch.test.ts
git commit -m "fix(gateway): route registry dispatch now gated by apiToken auth (P0-1)"
```

### Task 2: GOAL_SOURCES 扩 `mobile`（P0-2）

**Files:**
- Modify: `gateway/src/routes/pods.ts:605-617`（`GOAL_SOURCES` 集合）
- Test: `gateway/tests/unit/routes/pods.test.ts`（跟随现有 source 校验用例位置；若无则新增 describe）

**Interfaces:**
- Consumes: `GoalAuthorization['source']` 类型（`core/goal/goal-identity.ts` 或其定义处——扩枚举时同步该 union）

- [ ] **Step 1: 写失败测试**

用例：`source: 'mobile'` 创建讨论型 Goal 的校验路径不再 400（走现有校验函数断言通过；若测试在 handler 层则断言非 400）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/routes/pods.test.ts -t mobile`
Expected: FAIL

- [ ] **Step 3: 实现**

`GOAL_SOURCES` Set 增加 `'mobile'`；`GoalAuthorization['source']` union 同步加 `'mobile'`。

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `cd gateway && npx jest tests/unit/routes/pods.test.ts`
```bash
git add gateway/src/routes/pods.ts gateway/tests/unit/routes/pods.test.ts
git commit -m "feat(gateway): accept source 'mobile' in GOAL_SOURCES (P0-2)"
```

### Task 3: `mobile.tailscaleUrl` 配置键（P0-3）

**Files:**
- Create: `gateway/src/mobile/tailscale-url.ts`
- Modify: `gateway/src/config.ts`（server/mobile 段新增 `mobile: { tailscaleUrl?: string }` 默认 `''`，仿现有段）；`gateway/src/index.ts:4699-4717`
- Test: `gateway/tests/unit/mobile/tailscale-url.test.ts`

**Interfaces:**
- Produces: `export function resolveMobileBaseUrl(env: string | undefined, configUrl: string | undefined, detectedHost: string, port: number): string` — 优先级 env > config（非空）> `http://<detectedHost>:<port>`。

- [ ] **Step 1: 写失败测试**

三用例：env 覆盖一切；config 非空次之；两者皆空回落 `http://host:port`。含 config 值带尾斜杠的 normalize（去尾 `/`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/mobile/tailscale-url.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现纯函数 + 接线**

`resolveMobileBaseUrl` 实现；index.ts:4715-4716 改为 `const tailscaleUrl = resolveMobileBaseUrl(process.env.MAFW_MOBILE_TAILSCALE_URL, config.raw.mobile?.tailscaleUrl, detectReachableHost(), this.apiPort)`。config 变更热更路径已存在（`pairingService.updateConfig`），确认 config watcher 调用点把新键传进去（若无则在该调用点补一行）。

- [ ] **Step 4: 跑测试 + Commit**

Run: `cd gateway && npx jest tests/unit/mobile/tailscale-url.test.ts`
```bash
git add gateway/src/mobile/tailscale-url.ts gateway/src/config.ts gateway/src/index.ts gateway/tests/unit/mobile/tailscale-url.test.ts
git commit -m "feat(gateway): mobile.tailscaleUrl config key with env>config>detect precedence (P0-3)"
```

### Task 4: `goal.techLeadModel` 可配置（P0-4）

**Files:**
- Create: `gateway/src/core/pod/pod-tech-lead-runtime-adapter.ts`
- Modify: `gateway/src/index.ts:4348-4352`（runtime adapter 换成工厂产物）；`gateway/src/config.ts`（goal 段加 `techLeadModel?: { providerID: string; modelID: string } | null`）；`gateway/src/routes/model-config.ts:28/129/170`（镜像 nodeModel 的校验与持久化）
- Test: `gateway/tests/unit/core/pod/pod-tech-lead-runtime-adapter.test.ts` + `gateway/tests/unit/model-config.test.ts`（追加）

**Interfaces:**
- Consumes: `resolveNodeModel(identityModel, configModel)`（`core/goal/node-model.ts:14`）；`PodTechLeadRuntime`（`pod-tech-lead-service.ts:41-51`）
- Produces: `export function createTechLeadRuntimeAdapter(deps: { createSession(opts: { projectDir: string }): Promise<{ id: string }>; switchModel?(opts: { sessionID: string; model: { providerID: string; modelID: string } }): Promise<unknown>; promptAsync: PodTechLeadRuntime['promptAsync']; messages: PodTechLeadRuntime['messages']; identityModel?: { providerID: string; modelID: string } | null; configModel?: { providerID: string; modelID: string } | null; }): PodTechLeadRuntime` — `createSession` 在建会话后 fail-open 调 `switchModel`，模型 = `resolveNodeModel(identityModel, configModel)`。

- [ ] **Step 1: 写失败测试（adapter）**

三用例（fake createSession/switchModel）：① config 完整对 → switchModel 收到 config 对；② config 空/半空 → switchModel 收到 identity 对（半空不半用）；③ switchModel reject → createSession 仍返回 id（fail-open）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/core/pod/pod-tech-lead-runtime-adapter.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 adapter + 接线**

工厂实现如 Interfaces；index.ts:4348 起的 inline `runtime: {...}` 换成 `runtime: createTechLeadRuntimeAdapter({ createSession: async ({ projectDir }) => this.runtime!.session.create({ directory: projectDir }), switchModel: this.runtime?.session.switchModel?.bind(this.runtime.session), promptAsync: (opts) => this.runtime!.session.promptAsync(opts as any), messages: ..., identityModel: this.identityRegistry.get(TECH_LEAD_AGENT)?.model, configModel: config.raw.goal?.techLeadModel })`（messages 闭包照抄现状 4354-4357）。

- [ ] **Step 4: model-config 路由扩展测试（先 RED 后 GREEN）**

`gateway/tests/unit/model-config.test.ts` 追加：POST `goal.techLeadModel` 完整对 200 且 GET 返回；半对 400（复用 nodeModel 文案格式）；空对清空。路由实现镜像 nodeModel 三处（28/129/170）。

- [ ] **Step 5: 跑测试 + 全量 + Commit**

Run: `cd gateway && npx jest tests/unit/core/pod tests/unit/model-config.test.ts && npx jest --forceExit`
```bash
git add gateway/src/core/pod/pod-tech-lead-runtime-adapter.ts gateway/src/index.ts gateway/src/config.ts gateway/src/routes/model-config.ts gateway/tests/unit/core/pod/pod-tech-lead-runtime-adapter.test.ts gateway/tests/unit/model-config.test.ts
git commit -m "feat(gateway): configurable goal.techLeadModel with fail-open bind (P0-4)"
```

---

## 交付汇报要求

完成后汇报：新增测试数（预计 4+1+3+3+3≈14）、全量通过数、commit 哈希；`mafw update` 或 deploy:local 部署 + `GET /health` 200 验证；用 `curl -H "Host: x" http://<LAN-IP>:3000/api/pods/x/goals`（无 token）从另一台设备实测 401（真机验证鉴权洞闭合）。
