# 2026-11-18 · 插件 legacy plane 声明（runtime / media / tts / usage）

- **分支**：`main`
- **版本**：gateway `4.18.0` → `4.19.0`
- **设计**：`docs/superpowers/specs/2026-11-18-plugin-legacy-planes-design.md`
- **计划**：`docs/superpowers/plans/2026-11-18-plugin-legacy-planes.md`
- **规范正文**：`docs/guides/plugin-standard.md` §2 / §4.6 / §6 / §7 / §8 / §10
- **架构现状**：`docs/architecture/plugin.md`（「插件插入点默认生效」段）

## 提交

| commit | 内容 |
|---|---|
| `0d2b388e7` | 契约 + 解析器 + manifest schema：`contributes.gateway` 接受四个 legacy 键；`untrusted` 声明即拒绝；schema parity 矩阵补四组 |
| `cf11cce25` | host 在 legacy 组装处按名字 / 模态对齐；`check` 的 `declared` / `registered` 渲染四个面 |
| `9aab4cde8` | `POST /api/plugins/check` 契约 + SDK 类型（手写 schema / 类型 + 重新生成的 openapi / gateway-paths / api-schema） |
| 本文件所在 commit | `docs(plugin): document the legacy contribution planes`（规范正文、架构现状、本文件、`gateway/package.json` 版本号；`git log -1 --format=%h -- docs/releases/2026-11-18-plugin-legacy-planes.md`） |
| 本文件的 fix 轮 | `fix(plugin): keep legacy inventory truthful and make the media bound unambiguous`（`registered` 预填、`media.modalities: []` 拒绝 + schema `minItems` / 模态枚举、文档精度、补测） |

## 语义

四个 legacy 面每包最多一个实例，所以声明是**对象**而不是数组；规则是名字 / 模态对齐，不是 `registered ⊆ declared`：

| 面 | 声明形状 | 实际值 | 违规条件 |
|---|---|---|---|
| `runtime` | `{ name?: string }` | `spec.name ?? 包名` | 实际名字 ≠ 声明名字 |
| `media` | `{ name?: string; modalities?: string[] }` | 同上 + `spec.modalities` | 名字不等，或实际模态 ⊄ 声明列表（列表本身必须非空且只含 `image` / `video` / `audio`） |
| `tts` | `{ name?: string }` | `spec.name ?? 包名` | 实际名字 ≠ 声明名字 |
| `usage` | `{ name?: string }` | `spec.name ?? 包名` | 实际名字 ≠ 声明名字 |

- **未声明 = 不受约束**：存量包零影响；`check` 也不渲染未声明面（不会凭空造出上界）。
- **声明了但没注册 = 合法**：包可以按配置 / host 版本条件注册；只出现在 `note: declared but not registered: …`。
- **名字缺省 = 包名**：两边都按 `name ?? 包名` 解析，`runtime: {}` 与 `runtime: { name: "<package>" }` 等价；`name` 必须非空白。
- **`media` 的模态子集**：`modalities` 省略 = 不限；给了列表时实际服务的模态必须是声明的子集（多一个即失败）。列表必须是 `image` / `video` / `audio` 的**非空**子集：显式 `[]` 与拼错的模态名都在 manifest 阶段被拒，不再等到激活。
- **`untrusted` 不能声明**：worker 只支持 actions / events / config，四个面永远无法满足；manifest 解析阶段即整包拒绝，一个面一条 `untrusted packages cannot declare contributes.gateway.<plane>`。

逐字错误（`check` 的 `error:` 行；共同前缀 `invalid contributions: `，所以都归类 `contribution_bound`）：

```text
invalid contributions: runtime "x" is not declared in plugin.json contributes.gateway.runtime
invalid contributions: media "x" is not declared in plugin.json contributes.gateway.media
invalid contributions: media modality "video" is not declared in plugin.json contributes.gateway.media.modalities
invalid contributions: tts "x" is not declared in plugin.json contributes.gateway.tts
invalid contributions: usage "x" is not declared in plugin.json contributes.gateway.usage
```

`media.modalities` 的清单错误在 manifest 阶段拒绝（`check` 的 `error[manifest_invalid]` 里带 `contributes: ` 前缀）：

```text
manifest contributes.gateway.media.modalities must not be empty
manifest contributes.gateway.media.modalities[0] must be one of image, video, audio
```

## 测试

新增用例 / 数据集条目合计 **48**（原始 37 + fix 轮 11）：

| 来源 | 数量 | 说明 |
|---|---|---|
| Task 1 · 契约（`packages/plugin-contract/src/validate.test.ts`） | **+3 个测试块** | 套件 47 → 50（接受四键、接受 `{}`、拒绝错误形状）。 |
| Task 1 · 解析器（`gateway/tests/unit/plugins/package-manifest.test.ts`） | **+4 个测试块** | 该套件 28 → 32（归一化四键、untrusted × 每个面、每面一条错误、trusted 接受）。 |
| Task 1 · schema parity（`manifest-schema-parity.test.ts`） | **+15 条数据集用例** | 2 ACCEPTED / 1 REJECTED / 11 v2 矩阵 / 1 v1-lenient；运行在既有 `it` 内，jest 计数不变。 |
| Task 2 · host + CLI | **+14 个用例** | `package-check-inventory.test.ts` 10 个、`plugin-standard-command.test.ts` 4 个。 |
| Task 2b · 契约验收 | **+1 个用例** | `api-contract.test.ts` 的 `plugin check documents the legacy singleton planes as optional`。 |
| 本文档提交 | 0 | 只改文档与版本号。 |
| Fix round 1 · 契约 | **+1 个测试块** | `validate.test.ts` 50 → 51（空列表 + 未知模态 + 合法全集）。 |
| Fix round 1 · host + CLI | **+6 个用例** | `package-check-inventory.test.ts` 3 个（原始返回的 legacy inventory 不被早先失败抹掉、`runtime: {}` 负例、模态真子集）、`plugin-standard-command.test.ts` 3 个（legacy `note:`、空声明 = 不限、模态 `next:` 提示）。 |
| Fix round 1 · 文档 | **+1 个用例** | `standard-doc.test.ts` 8 → 9（五个 legacy 错误 + 两个模态清单错误逐字对齐）。 |
| Fix round 1 · schema parity | **+3 条数据集用例** | 空模态 / 未知模态各一条 v2 矩阵 + 一条 v1-lenient；jest 计数不变。 |

定向结果（来自各 task 报告 + 本次自跑）：

- `npm run test:plugin-contract`：**51/51**（fix 轮重跑）。
- `package-manifest` + `manifest-schema-parity` + `example-packages`：**32/32**（Task 1 报告）。
- E16 四个定向套件（package-check-inventory / plugin-standard-command / package-host / tts-plugin-loader）：**4 suites / 141 tests**（fix 轮重跑；原 135 + 6）。
- `gateway/tests/unit/plugins` + `tests/unit/cli` 宽扫：**45 suites / 550 tests**（fix 轮重跑；原 543 + 7）。
- `npx jest --runInBand tests/unit/plugins/standard-doc.test.ts`：**9/9**（fix 轮重跑）。
- `gateway: npx tsc --noEmit -p tsconfig.json` / `packages/gateway-sdk: npx tsc --noEmit -p tsconfig.json`：**0 errors**。
- `npx jest --runInBand tests/unit/api-contract.test.ts`：**253 passed / 10 failed**，全部是 `c89190ffe` 引入的 mobile write-op ledger 漂移（另一个 session 的活），本波未触碰。

## 全量门禁

| 门禁 | 结果 |
|---|---|
| gateway `npm test`（全量） | **1041 suites / 8343 tests**：8331 passed、2 skipped、**10 failed**，全部落在 `tests/unit/api-contract.test.ts` 的写操作台账（`writeOps.size` 期望 199、实际 200）。归因：另一会话的 `c89190ffe` 新增了 mobile 写操作但未更新台账；本波四个 commit 未触碰 `routes/` 的 operation 集合（E16 只动 `plugins.check` 的响应 schema）。 |
| root `npm run build` | **PASS**（契约重建 + stage + gateway emit:openapi + SDK 重生成与 tsc 均成功） |
| 本波定向 | `tests/unit/plugins` + `tests/unit/cli`：**45 suites / 550 tests 全绿**；`npm run test:plugin-contract`：**51 / 51**；gateway 与 SDK 的 `tsc -p` 均 exit 0 |

## Fix round 1

Review 发现两个 Important 缺陷 + 精度问题，均已修正：

1. **`registered` 不再被更早的校验失败抹掉**：四个 legacy 面在 `registeredFromRaw()` 里就从 `activate()` 的原始返回记录（名字按 `spec.name ?? 包名`，`media` 带返回的模态列表），不再依赖各自 validated 分支。复现（声明 `actions: ['a'] + runtime: {}`，返回 action `b` + 名为 `mixed-runtime` 的 runtime）现在显示 `registered: … runtime [+mixed-runtime]`，不再出现 `runtime []` 或 `declared but not registered: runtime`。
2. **`media.modalities: []` 只有一个含义**：契约拒绝显式空列表（`manifest contributes.gateway.media.modalities must not be empty`），schema 加 `minItems: 1`，未知模态名（如 `imag`）在 manifest 阶段被拒（`modalities[0] must be one of image, video, audio`）。因此 wire 上的 `[]` 只能是「清单省略」，CLI 的 `allowed.length === 0` = 不限成立；HTTP schema 描述、SDK 类型注释与本文档已同步。
3. **精度**：`untrusted` 的说法改为「现在给出指向 kind 的明确拒绝」并记录 v1 迁移（仅因四个 legacy 键而非法 v1 块现在合法，其余上界随之上线）；`--json` 改为「输出解析后形状」；模态错误的 `next:` 指向 `contributes.gateway.media.modalities`；§4 标题改为「声明式 plane」。
4. **补测**：`runtime: {}` 的负例、模态真子集、legacy `declaredOnly` 的 `note:` 行，以及 `standard-doc` 对五个 legacy 错误串的逐字校验。

## 已知边界

- **弱约束**：只比对实例名字与 `media` 的模态，不检查实现、能力或行为——价值在安装审查的可见性与声明漂移检测，不构成沙箱。`runtime` 仍然能替换整个 agent 循环，声明只是让它变得可审查。
- **`untrusted` 声明即拒绝给出的是明确指名的错误**：v2 下这四类键此前已作为未知键被拒（`contributes: manifest contributes.gateway has unknown field "<key>"`），并不是静默忽略；现在换成 `untrusted packages cannot declare contributes.gateway.<plane>`，直接点明 kind 与修法（删声明或改成 `trusted`）。
- **v1 的行为迁移**：v1 的非法 `contributes` 块一直是 warning `legacy-contributes: …` + 整块丢弃。一个**仅因**这四个键而非法（未知键）的 v1 块现在变成合法块，其 `actions` / `events` / `tools` / `observers` / `http` 上界随之生效：如果包注册了块外的名字，会从「无约束」变成激活失败。当前仓库内没有这类存量包。
- **inventory 的 `media.modalities` 是解析后形状，且 `[]` 只有一种含义**：`declared.media.modalities` 恒为数组，清单省略时填 `[]`（不限）。显式 `modalities: []` 在 manifest 阶段就被契约拒绝（`must not be empty`），所以 wire 上不存在「零上界」的空列表；CLI 的 `allowed.length === 0` = 不限也就不再有歧义。
- **未声明的面完全不可见**：`check` 不渲染未声明 legacy plane，即使实例真的注册了；这样不会把「没有上界」误读成「有上界且不匹配」。
- **worker 路径正常不带 legacy 面**：worker 只交付 actions / events，所以 `untrusted` 的 `registered` 里这四个键缺失是正常状态，不是空上界。如果 worker 真的返回了 legacy 键，包会以 `not allowed in untrusted worker: …` 被拒，而 inventory 会如实显示它（记录发生在校验之前）。
- **HTTP / SDK 契约镜像的是 host 形状**：`declared` / `registered` 里四个键全部可选，`registered` 的 `required` 仍是原来的五个数组 / 计数 plane；`media` 对象里 `modalities` 必填（`[]` = 清单省略、不限）。
