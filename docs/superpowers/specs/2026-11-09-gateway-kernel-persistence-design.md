# Gateway 内核重构：持久化纪律与缓存一致性收口（Phase D+）

日期：2026-11-09
状态：待批准
前置：无硬依赖，可与 Phase D 并行
关联设计：
- `2026-11-09-gateway-kernel-microkernel-design.md`（Phase D，微内核拆分）

## 1. 意图与为什么

Gateway 的持久化纪律**整体良好但存在漏洞**，缓存一致性**靠约定而非强制**。

**OS 原则**：
- journaling FS 不允许 bypass 写——所有写入走统一路径
- cache coherence 由单一写者维护——不允许创建非相干副本

## 2. 现状盘点

### 2.1 持久化：整体良好，有漏洞

**好的部分**：
- SQLite WAL 模式 + 单写者 + 同步 API
- `writeGoalState` 用 `.tmp + rename`（原子写）
- `renameWithRetry` 处理 Windows EPERM/EBUSY
- 启动 reconcile + 幂等迁移 + 备份

**漏洞**：
- `automation-engine.ts` ~7 处裸 `writeFileSync`（L557 / L605 / L616 / L820 / L843 / L875）
- `gateway.db.getStore()` 暴露原始句柄给 EventStore（L119-121）——DDL 与迁移责任分裂
- `harmonic-index.ts` `load()` 里 backfill 后直接 `writeFileSync`（L189，无 tmp）

### 2.2 缓存：层级清晰，一致性靠约定

| 层 | 失效策略 | 问题 |
|---|---|---|
| `HarmonicIndexManager`（live 实例） | 写路径直接改内存 + save | **权威性靠约定**——automation-engine L209/L217 直接 `new` 创建非相干副本 |
| BM25 `tokenCache` | 文本等值守卫 | 失效逻辑依赖调用者比较 text，是约定而非封装 |
| R8 预取快照 | TTL 10min + 包含度 | ✅ |
| 向量库 | 写路径防抖批量 flush fire-and-forget | 失败丢弃，decay pass 幂等 backfill 补偿 ✅ |
| discovery 30s | TTL | ✅ |
| reranker | 进程单例 | ✅ |
| 合并去重 | L1 exact-hash LRU + L2 读时折叠 + L3 consolidation | ✅ |

## 3. 目标

### 3.1 持久化：所有 JSON 写走统一原子函数

创建一个 `writeJsonAtomic(path, data)` 收口全部 tmp+rename：

```ts
// core/utils/atomic-write.ts（扩展已有）
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameWithRetry(tmp, path);
}
```

迁移清单：

| 位置 | 现状 | 改法 |
|---|---|---|
| `automation-engine.ts` L557 `createTriage` | 裸 `writeFileSync` | `writeJsonAtomic` |
| `automation-engine.ts` L605 `createGoal` | 裸写 | `writeJsonAtomic` |
| `automation-engine.ts` L616 `createGoal`（第二次） | 裸写 | `writeJsonAtomic` |
| `automation-engine.ts` L820 `proposeTriageDecision` | 裸写 | `writeJsonAtomic` |
| `automation-engine.ts` L843 `draftRule` | 裸写 | `writeJsonAtomic` |
| `automation-engine.ts` L875 `toggleRule` | 裸写 | `writeJsonAtomic` |
| `harmonic-index.ts` L189 `load()` backfill | 无 tmp | `writeJsonAtomic` |
| 其他 12 处已有 tmp+rename | 复制粘贴 | 统一调用 `writeJsonAtomic` |

### 3.2 GatewayDatabase：唯一 schema owner

- `getStore()` 改为注册表模式：EventStore 声明需要的表，GatewayDatabase 提供表操作接口
- DDL 与迁移统一由 GatewayDatabase 管理
- EventStore 不再直接 exec SQL

### 3.3 禁止直接 `new HarmonicIndexManager`

两种方案（builder 选一）：

**方案 A（推荐）**：私有构造器 + 静态工厂
```ts
class HarmonicIndexManager {
  private constructor(...) {}
  static create(...): HarmonicIndexManager;
  // 外部无法 new
}
```

**方案 B**：ESLint 自定义规则
```yaml
# 禁止在 automation-engine 等文件 import HarmonicIndexManager 构造函数
```

统一走 `getLiveIndexManager()` provider 获取。

### 3.4 tokenCache 失效封装

把"文本等值守卫"从调用方移入 Cache 接口内部：

```ts
class TokenCache {
  get(id: string, text: string): TokenStats | undefined {
    const cached = this.map.get(id);
    if (cached && cached.text === text) return cached.stats;
    return undefined; // miss → caller recompute
  }
  set(id: string, text: string, stats: TokenStats): void {
    this.map.set(id, { text, stats });
  }
}
```

调用方不再需要手动比较 text。

## 4. 非目标

- 不改变 SQLite WAL 模式
- 不改变缓存层级关系
- 不重构记忆索引的数据结构
- 不做缓存预热

## 5. 测试策略（TDD）

- **原子写**：写失败（磁盘满/权限）不留半截文件
- **schema owner**：EventStore 无法直接 exec DDL
- **禁止直接 new**：TypeScript 编译错误或 lint 报错
- **tokenCache 封装**：同 id 不同 text → miss；同 id 同 text → hit

## 6. 验收标准

- [ ] `writeJsonAtomic` 存在且 automation-engine ~7 处裸写全部迁移
- [ ] `getStore()` 不再暴露原始 SQL 句柄（或仅在 GatewayDatabase 内部使用）
- [ ] `new HarmonicIndexManager` 在 `automation-engine.ts` 中不可用（编译/lint 层面）
- [ ] `tokenCache` 的文本守卫封装在内部
- [ ] 全量测试绿
- [ ] CI 守卫：`grep -rn "writeFileSync" gateway/src/automation-engine.ts` 零命中

## 7. 留给 builder 的决定

- 方案 A（私有构造器）vs 方案 B（ESLint 规则）
- `getStore()` 的替代接口形状
- 是否把 `writeJsonAtomic` 推广到全部 JSON 写（当前只覆盖有风险的路径）
