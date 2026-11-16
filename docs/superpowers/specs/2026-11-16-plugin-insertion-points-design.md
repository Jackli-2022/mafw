# E12 插件插入点标准化：声明即约束 + 插入点默认生效

> 状态：设计已定，待实施
> 范围：只用两处改动把「固定核心 + 标准插入点」从口号变成可执行约束，不引入 DI / profile / bundle。
> 相关：`docs/architecture/plugin.md`、`docs/guides/plugin-authoring.md`

## 1. 问题（有证据，不是感觉）

统一插件包已经有一套很像插入点的贡献面（actions / events / tools / observers / http / ui / legacy），
但**声明与执行是两张皮，且两个插入点默认是死的**。

### 1.1 声明不构成约束

`packages/plugin-contract/src/validate.ts` 有完整的 `validatePluginManifestContributes`
（严格已知字段、类型、tool descriptor 形状）。但 `gateway/src/plugins/package-manifest.ts`
的 `parsePackageManifest()` 从不读 `raw.contributes`，`NormalizedPackageManifest` 也没有这个字段。

后果：

- 包可以在 `plugin.json` 里声明「我只提供 ping」，然后在 `activate()` 里注册 `pong`，host 照样提交。
- 安装时的权限/信任审查（human accept permissions）核对的是 manifest 声明，实际能力却由返回值决定，
  两者可以合法地不一致。
- `contributes` 唯一的作用是躺在契约里。

### 1.2 tools / observers 插入点默认 inert

`gateway/src/runtime/v2-live.ts#createKernelV2Live`：

```ts
if (!flags.observers && !flags.tools) return null;   // v2-live.ts:118
```

`readKernelV2LiveFlags()` 只把 `'1'` / `'true'` 当开启，未设置即关闭。
`kernel.ts:3906` 用 `process.env` 构造它，于是**默认路径下 bridge 为 null**：

- 包声明的 `tools[]` 通过校验、进入 `activated.tools`、被 `getState().contributions` 记为 `'tools'`，
  但 `kernelV2Cb` 永不触发 → agent 侧看不到 `plugin:<pkg>:<tool>`。
- 同理 observers 不注册，`MAFW_KERNEL_V2_OBSERVERS=1` 才有事件。
- `docs/guides/plugin-authoring.md:265/287` 已如实写明「需要 `MAFW_KERNEL_V2_TOOLS=1`」——
  也就是说这是一个**已知的、默认关闭的能力面**。

一个默认关闭的插入点不是插入点，是待办事项。

### 1.3 明确不做

| 不做 | 原因 |
|---|---|
| ServiceToken / DI / `inject` | 目前 0 个第三方插件，没有第二个消费者可验证抽象 |
| commands / hooks seam | 同上；等 contributes 约束跑顺再上 |
| profile / bundle 组合 | 要动 `boot.ts` 启动装配顺序，刚由 E1/E2 修稳，收益不足以承担风险 |
| 单文件 `.js` 包补 manifest / 签名的信任缺口 | 语义变更（会拒绝现有单文件包），需要单独决策 |
| 客户端快照暴露 capabilities | 观测性收益，不影响正确性；留待 E13 |

## 2. 目标

1. **声明即约束**：`plugin.json.contributes` 一旦声明，就成了该次激活的允许集合；超出集合的注册 fail-closed。
   未声明则维持现状（向后兼容）。
2. **插入点默认生效**：tools / observers 在默认配置下就工作，环境变量变成 opt-out 而非 opt-in。
3. 两件事都不改变已经正确的部分：actions / events 的 bag 生命周期、http 的 revision 退役、
   untrusted worker 的能力白名单。

## 3. 设计

### D1 声明即约束（contributes enforcement）

**归一化**。`parsePackageManifest()` 读取 `contributes` 并调用契约里已有的
`validatePluginManifestContributes`：

- `apiVersion >= 2` 且 contributes 非法 → **hard error**（包被判无效，不激活）。
- `apiVersion === 1` 且 contributes 非法 → **warning** `legacy-contributes: <error>`，contributes 视为未声明
  （v1 包此前从不校验该字段，不能让存量包因为一个新引入的校验而失效）。
- 合法 → `NormalizedPackageManifest.contributes` 保留归一化结果。

**执行**。`buildActivatedContributions(packageName, contributions, canonicalTypes, declared?)`
增加第四个可选参数。激活后逐面比对：

| 声明 | 实际 | 结果 |
|---|---|---|
| `gateway.actions: ['ping']` | `{ ping, pong }` | error：`action "pong" is not declared in plugin.json contributes.gateway.actions` |
| `gateway.events: ['plugin:x:ping']` | 多出 `plugin:x:other` | error：同名式 |
| `gateway.tools: [{name:'echo',…}]` | `[{name:'nope',…}]` | error：`tool "nope" is not declared in plugin.json contributes.gateway.tools` |
| `gateway.tools: [{name:'ghost',…}]` | 未注册 | **允许**（条件注册合法，声明是上界不是清单） |
| `gateway.http: false` | `ctx.http.entries.length > 0` | error：`http routes are not declared (contributes.gateway.http: false)` |
| 未声明该面 | 任意 | 允许（兼容） |

`http` 的比对必须在 host 内做：只有 `createPluginHttpRecorder` 的 `entries` 知道实际注册了几条路由。

**两个激活路径都要传**：trusted（`package-host.ts:1325`）与 untrusted worker（`package-host.ts:1239`）。
worker 路径自带 actions/events 白名单，D1 是它上面的声明层，不替代它。

### D2 插入点默认生效（tools / observers）

`readKernelV2LiveFlags(env)` 语义改为：

```
显式 '0' 或 'false' → 关闭
其它（含未设置）    → 开启
```

理由：这两个 flag 是 Phase 3 渐进上线的开关，上线已经完成（工具注册、revision 同步、观察者
dispatch 均有测试覆盖）。保留变量名不变，改成 kill switch。

安全性核查（已确认）：

- `observer.ts#schedule()` 在 `queue.length === 0` 时直接返回，0 个 observer 时每条 canonical 事件
  的开销是一次空 Map 迭代 + 一次判空。
- observer 队列有上界（`maxQueue` 默认 1000），溢出丢最新并计数，不阻塞事件管线。
- `syncTools` / `syncObservers` 以 revision 为键 reconcile，包被删/禁用/换版都会撤销注册（有集成测试）。

## 4. 故障语义

| 场景 | 行为 |
|---|---|
| v2 包 contributes 非法 | 安装/激活失败，错误进 Hub state 与 doctor |
| v1 包 contributes 非法 | 激活成功，`legacy-contributes` 警告进 manifest warnings |
| 激活注册超出声明 | 激活失败，已记录的路由/注册随 candidate 的 bag 一起丢弃 |
| 声明了但没注册 | 激活成功（允许条件注册） |
| 运维设 `MAFW_KERNEL_V2_TOOLS=0` | 工具不注册；`registerTool` 抛错而不是静默 no-op（保留现有报错文案） |

## 5. 验证

- `packages/plugin-contract` 不改（`validatePluginManifestContributes` 已存在且被 44 个用例覆盖）。
- gateway 新增单元/集成用例覆盖 §4 全部 5 行，外加：
  - v1 无 contributes 的存量包仍激活（回归）；
  - 默认配置下 `createKernelV2Live({env:{}})` 非 null 且 `toolFactory()` 可用；
  - `kernel-v2-plugin-host` 集成用例去掉显式 flag，证明「默认就生效」。
- 门禁：`cd gateway && npx jest --runInBand`（全量，含 `--forceExit` 兜底）、
  `npx tsc --noEmit -p tsconfig.json`（gateway）、`npm run test:plugin-contract`。

## 6. 风险

- **行为变更**：默认开启 tools/observers 会让此前 inert 的声明开始真正生效。当前 `~/.mafw/plugins`
  无安装包（仅 README），真实影响为零；风险集中在测试与第三方草稿（`demo-card` 不含 tools/observers）。
- **v1 兼容**：contributes 校验失败降级为 warning，是刻意选择——宁可不约束，也不让存量包因新校验下线。
- **声明漂移**：包声明了 actions 却改了名字，会在激活期立刻失败而不是运行时 404。这是想要的失败时机。
