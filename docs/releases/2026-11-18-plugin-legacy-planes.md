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

## 语义

四个 legacy 面每包最多一个实例，所以声明是**对象**而不是数组；规则是名字 / 模态对齐，不是 `registered ⊆ declared`：

| 面 | 声明形状 | 实际值 | 违规条件 |
|---|---|---|---|
| `runtime` | `{ name?: string }` | `spec.name ?? 包名` | 实际名字 ≠ 声明名字 |
| `media` | `{ name?: string; modalities?: string[] }` | 同上 + `spec.modalities` | 名字不等，或实际模态 ⊄ 声明列表 |
| `tts` | `{ name?: string }` | `spec.name ?? 包名` | 实际名字 ≠ 声明名字 |
| `usage` | `{ name?: string }` | `spec.name ?? 包名` | 实际名字 ≠ 声明名字 |

- **未声明 = 不受约束**：存量包零影响；`check` 也不渲染未声明面（不会凭空造出上界）。
- **声明了但没注册 = 合法**：包可以按配置 / host 版本条件注册；只出现在 `note: declared but not registered: …`。
- **名字缺省 = 包名**：两边都按 `name ?? 包名` 解析，`runtime: {}` 与 `runtime: { name: "<package>" }` 等价；`name` 必须非空白。
- **`media` 的模态子集**：`modalities` 省略 = 不限；给了列表时实际服务的模态必须是声明的子集（多一个即失败）。
- **`untrusted` 不能声明**：worker 只支持 actions / events / config，四个面永远无法满足；manifest 解析阶段即整包拒绝，一个面一条 `untrusted packages cannot declare contributes.gateway.<plane>`。

逐字错误（`check` 的 `error:` 行；共同前缀 `invalid contributions: `，所以都归类 `contribution_bound`）：

```text
invalid contributions: runtime "x" is not declared in plugin.json contributes.gateway.runtime
invalid contributions: media "x" is not declared in plugin.json contributes.gateway.media
invalid contributions: media modality "video" is not declared in plugin.json contributes.gateway.media.modalities
invalid contributions: tts "x" is not declared in plugin.json contributes.gateway.tts
invalid contributions: usage "x" is not declared in plugin.json contributes.gateway.usage
```

## 测试

新增用例 / 数据集条目合计 **37**：

| 来源 | 数量 | 说明 |
|---|---|---|
| Task 1 · 契约（`packages/plugin-contract/src/validate.test.ts`） | **+3 个测试块** | 套件 47 → 50（接受四键、接受 `{}`、拒绝错误形状）。 |
| Task 1 · 解析器（`gateway/tests/unit/plugins/package-manifest.test.ts`） | **+4 个测试块** | 该套件 28 → 32（归一化四键、untrusted × 每个面、每面一条错误、trusted 接受）。 |
| Task 1 · schema parity（`manifest-schema-parity.test.ts`） | **+15 条数据集用例** | 2 ACCEPTED / 1 REJECTED / 11 v2 矩阵 / 1 v1-lenient；运行在既有 `it` 内，jest 计数不变。 |
| Task 2 · host + CLI | **+14 个用例** | `package-check-inventory.test.ts` 10 个、`plugin-standard-command.test.ts` 4 个。 |
| Task 2b · 契约验收 | **+1 个用例** | `api-contract.test.ts` 的 `plugin check documents the legacy singleton planes as optional`。 |
| 本文档提交 | 0 | 只改文档与版本号。 |

定向结果（来自各 task 报告 + 本次自跑）：

- `npm run test:plugin-contract`：**50/50**（Task 1 报告）。
- `package-manifest` + `manifest-schema-parity` + `example-packages`：**32/32**（Task 1 报告）。
- `gateway/tests/unit/plugins` + `tests/unit/cli` 宽扫：**45 suites / 543 tests**（Task 2 报告）。
- `npx jest --runInBand tests/unit/plugins/standard-doc.test.ts`：**8/8**（本次文档提交后重跑）。
- `gateway: npx tsc --noEmit -p tsconfig.json`：**0 errors**（本次文档提交后重跑）。

## 全量门禁

| 门禁 | 结果 |
|---|---|
| gateway `npm test`（全量） | **PENDING**（controller 汇总） |
| root `npm run build` | **PENDING**（controller 汇总） |

## 已知边界

- **弱约束**：只比对实例名字与 `media` 的模态，不检查实现、能力或行为——价值在安装审查的可见性与声明漂移检测，不构成沙箱。`runtime` 仍然能替换整个 agent 循环，声明只是让它变得可审查。
- **`untrusted` 声明即拒绝是新增硬失败**：此前这些键会被静默忽略；当前没有此类存量包。错误信息直接给出面名与修法（删声明或改 `trusted`）。
- **inventory 的 `media.modalities` 是解析后形状**：`declared.media.modalities` 恒为数组（省略时填 `[]`），而 manifest 字段仍是可选的 `modalities?: string[]`。因此「省略列表」与 `modalities: []` 在 inventory 里同形，但执行期仍保留 absent / empty 区分：省略 = 不限，显式 `[]` = 零上界（任何模态都拒绝）。
- **未声明的面完全不可见**：`check` 不渲染未声明 legacy plane，即使实例真的注册了；这样不会把「没有上界」误读成「有上界且不匹配」。
- **worker 路径不带 legacy 面**：`untrusted` 的 `registered` 里这四个键缺失是正常状态，不是空上界。
- **HTTP / SDK 契约镜像的是 host 形状**：`declared` / `registered` 里四个键全部可选，`registered` 的 `required` 仍是原来的五个数组 / 计数 plane；`media` 对象里 `modalities` 必填（`[]` = 零上界）。
