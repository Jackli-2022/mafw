# MAFW v6.8 OKF 存储迁移设计

## 概述

将记忆存储从单一 `memories.json` 文件迁移到 OKF（Open Knowledge Format）多文件 Markdown 架构。Memora 核心特征 100% 保留，所有工具接口行为不变。

## 类型映射

| HarmonicUnit.type | OKF type | OKF 目录 | 条件 |
|:---|:---|:---|:---|
| `semantic` | `knowledge` | `concepts/knowledge/` | `granularity` 存在 |
| `semantic` | `semantic` | `concepts/semantic/` | `granularity` 无 |
| `procedural` | `procedural` | `concepts/procedural/` | 无条件 |
| `episodic` | 不写入 OKF | — | 蒸馏后转为 T3/T4 |
| `global` | `knowledge` | `~/.mafw/l5/concepts/*/` | 由 L5Store 处理 |

`knowledge` 不是新类型，是 `semantic` 在 OKF 存储时的细分标签。

## 文件格式

```markdown
---
type: knowledge
title: "createPayment: 创建支付订单"
tags: [payment, create, order, transaction]
id: knowledge-mem_fn_001
primary_abstraction: "createPayment: 创建支付订单"
cue_anchors: [payment, create, order, transaction]
granularity: function
energy: 0.7
salience: 0.8
abstraction_level: 2
archived: false
created_at: 2026-07-15T10:00:00Z
updated_at: 2026-07-16T14:20:00Z
links:
  - [[PaymentService]]
  - [[payment]]
  - [[mvc]]
---
# createPayment

函数 `createPayment` 位于 `src/modules/payment/service.ts`。
...
```

文件名格式：`{typeLabel}-{id[:12]}-{slug[:40]}.md`，例如 `knowledge-mem_fn_001-create-payment.md`。

## 目录结构

```
.mafw/memory/
├── concepts/
│   ├── knowledge/           ← semantic + granularity 存在
│   │   └── knowledge-mem_fn_001-create-payment.md
│   ├── semantic/            ← semantic + granularity 无
│   │   └── semantic-mem_002-database-schema.md
│   └── procedural/          ← procedural
│       └── procedural-mem_003-deployment.md
├── observations/            ← T1 不变
│   └── 2026-07-16.jsonl
├── .harmonic_index.json     ← 索引文件（指针指向 .md 路径）
├── .cognitive_graph.json    ← 关联图谱（从 [[link]] 重建）
└── index.md                 ← 从索引渲染的人类入口

~/.mafw/l5/concepts/         ← L5 全局记忆（由 L5Store 管理）
├── axioms/
├── heuristics/
└── gateway/
```

## 新增字段

`HarmonicUnit` 新增可选字段 `granularity`：

```typescript
granularity?: 'function' | 'class' | 'module' | 'architecture'
```

分流逻辑：`semantic` + `granularity` 存在 → `concepts/knowledge/`；否则 → `concepts/semantic/`。

## 核心组件

### HarmonicUnitFileStore（新增）

文件：`gateway/src/memory/harmonic-file-store.ts`

封装所有 OKF 文件操作，是唯一直接读写 `.md` 文件的代码。

```typescript
class HarmonicUnitFileStore {
  constructor(private baseDir: string) {}
  async write(unit: HarmonicUnit): Promise<string>     // 写 .md + 更新索引 + 图谱
  async read(id: string): Promise<HarmonicUnit | null>
  async archive(id: string): Promise<void>              // 软删除
  async rebuildIndex(): Promise<void>                   // 扫描 concepts/ 重建索引
  async renderIndexMd(): Promise<void>                  // 从索引渲染 index.md
}
```

### okf-parser.ts / okf-writer.ts（新增）

- `okf-parser.ts`：解析 `.md` Frontmatter + 正文 + `[[link]]`
- `okf-writer.ts`：构建并原子写入 `.md` 文件

### okf-migrator.ts（新增）

从 `memories.json` 迁移到 OKF：读取 → 生成 `.md` → 重建索引 → 渲染 `index.md`。

## `episodic` 的处理

不直接写入 OKF。蒸馏完成后转为 `semantic`（T3）或 `procedural`（T4）后再写入。如需保留原始叙事，使用 `observations/` 目录。

## `.cognitive_graph.json` 更新

`write()` 中从 `[[link]]` 解析关联并同步更新图谱。失败时记录日志但不阻断主写入。

## 10 个文件的改动模式

每个文件将直接操作 `memories.json` 的代码改为调用 `HarmonicUnitFileStore`：

```typescript
// 改前
const units = JSON.parse(fs.readFileSync(memPath))
units.push(newUnit)
fs.writeFileSync(memPath, JSON.stringify(units))

// 改后
const store = new HarmonicUnitFileStore(path.join(mafwDir, 'memory'))
await store.write(newUnit)
```

## 粒度分流逻辑

```typescript
function getOKFDirectory(unit: HarmonicUnit): string {
  if (unit.type === 'procedural') return 'concepts/procedural/'
  if (unit.type === 'semantic' && unit.granularity) return 'concepts/knowledge/'
  if (unit.type === 'semantic') return 'concepts/semantic/'
  throw new Error(`episodic should not be written to OKF directly`)
}
```

## 不动的内容

- `.harmonic_index.json` 格式：只改指针路径
- `.cognitive_graph.json` 格式：从 `[[link]]` 重建
- `mafw_search` / `mafw_search_hybrid`：从索引检索
- `review-scheduler.ts`：只读索引
- 前端/桌面组件：Gateway API 返回格式不变

## 实施顺序

| # | 内容 | 优先级 |
|:---|:---|:---|
| 1 | 新建 `harmonic-file-store.ts` + `okf-parser.ts` + `okf-writer.ts` + `okf-index-renderer.ts` | P0 |
| 2 | `HarmonicUnit` 加 `granularity` 字段 | P0 |
| 3 | 改写 10 个读写 `memories.json` 的文件 | P0 |
| 4 | 迁移脚本 `okf-migrator.ts` | P1 |
| 5 | 测试 | P1 |
| 6 | 确认后删除 `memories.json` | P2 |
