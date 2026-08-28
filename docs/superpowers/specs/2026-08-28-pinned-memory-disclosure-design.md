# Pinned 记忆披露层设计规格

> 状态：已批准（2026-08-28）。动机为设计层面担忧：用户画像/偏好类信息不应赌检索命中率（检索是"相关才出现"，画像是"永远相关"）。

## 1. 背景与问题

谐波记忆检索无视 type（AGENTS.md §3.2），只按 BM25 × energy × salience 排序。因此"保证被 agent 看到"的瓶颈不在数据模型（加 type 无意义），而在**注入路径**——只有注入管道能提供保证。

历史教训：旧 `.mafw/constraints.json`（pinned 约束独立通道）已在 §5.13 被废弃并迁入谐波记忆。本设计不复活独立文件，而是把"保证注入"实现为谐波记忆的**一等属性**（pinned 标志），与 OptMem 主动记忆哲学兼容（agent 自主写入，无旁路通道）。

## 2. 需求

- 披露内容范围：**用户身份/画像 + 用户偏好/约束**（用户级、稳定、跨项目）；不含项目上下文、不含 agent 行为设定
- 保证注入：不依赖检索命中，每轮出现在 system prompt
- 写入：agent 经记忆工具写入；用户可审阅
- 体积受控：披露块有硬预算，防滥用

## 3. 数据模型

`HarmonicUnit` 加可选字段：

```typescript
pinned?: boolean   // 缺省 = false；披露层标志，与 type 正交
```

`HarmonicIndexEntry` 同步携带 `pinned`（注入扫描只读索引，不加载 tier 文件）。

**MinHash 合并语义：**
- 合并产物 `pinned = 各源 OR`（任一源被 pin，合并结果保持 pin）
- 被 soft-supersede 的旧条目**不参与**披露注入（防同一偏好新旧两版同时出现）
- 检索路径行为不变：pinned 条目照常参与 BM25 排序，**不加分**（披露是注入策略，不扭曲检索排序）

## 4. 写入路径

- `mafw_add_memory` 加可选参数 `pinned?: boolean`（MCP schema + `POST /api/memory/add` 透传）
- 新 MCP 工具 `mafw_pin_memory { id, pinned: boolean }`——把已有记忆 pin/unpin（覆盖"把刚才说的偏好固定下来"场景）；id 不存在返回显式错误
- `<memory-guide>` 文案新增使用纪律：
  > 用户身份/画像、长期偏好与约束 → 写入时 `pinned: true`（每轮保证注入）；任务相关、易变内容**不要 pin**

## 5. 注入路径

```
experimental.chat.system.transform（每轮）
  → GET /api/recall/pinned          （fail-open：超时/错误 → 不注入块，不阻塞 LLM 流程）
  → gateway 侧：索引扫 pinned 条目（排除 superseded_by）
    → 按 energy × salience 降序截断 → 加载 memory_value → 渲染 <user-profile> 块
  → 插件侧：直接把返回的 profile 字符串注入 system（不自渲染）
```

渲染收敛在 gateway（`inject-format.ts` 新增 `formatPinnedProfile()`），与 §5.12 注入点收敛原则一致——插件只做传输，零格式逻辑。

**system 数组顺序（缓存优化，用户明确决定）：**

```
output.system = [
  ...,                // 上游稳定内容
  <memory-guide>,     // 静态，全量可缓存
  <user-profile>,     // 半稳定，放稳定内容之后 —— pinned 集合变化只使缓存从该点失效
]
```

渲染格式（pinned 纪律要求一句话，天然短）：

```
<user-profile>
- 用户偏好中文回复
- 不在生产库跑迁移前先备份
</user-profile>
```

空集（无 pinned 记忆）→ 不注入任何块（不渲染空标签）。

## 6. 体积预算

- 硬 cap：**最多 20 条、总计 ≤2000 字符**，按 energy × salience 截断
- 溢出记日志：`[Recall] pinned overflow: N entries dropped`
- pinned 条目正常参与能量衰减（0.005/天）：长期不复习的旧画像自然沉底让位，但**不因衰减而消失**（pin 语义是"保证注入"，衰减只影响块内排序与截断优先级）

## 7. 用户审阅

Phase 1 最小面：
- `GET /api/recall/pinned` 本身就是列表 API（返回披露的完整内容，与 agent 所见一致）
- 会话中 agent 可直接复述披露块

后续跟进（不进本期）：桌面 Config 页"用户画像"卡片（列表 + pin 开关 + 编辑）。

## 8. 接口汇总

| 端点/工具 | 变更 |
|---|---|
| `mafw_add_memory` | 加可选参数 `pinned` |
| `mafw_pin_memory` | 新增 `{ id, pinned }` |
| `POST /api/memory/add` | body 透传 `pinned` |
| `POST /api/memory/pin` | 新增 `{ id, pinned }` |
| `GET /api/recall/pinned` | 新增，返回 `{ profile: string \| null, entries: HarmonicUnit[] }`（entries 供审阅，profile 为渲染块） |
| `experimental.chat.system.transform` | 在 memory-guide 后追加 `<user-profile>` |

## 9. 测试

**单元测试：**
- `HarmonicUnitFileStore.write` 带 pinned → 索引条目携带 pinned
- MinHash merge：pinned = OR；superseded 条目不出现在 `/api/recall/pinned`
- endpoint：排序（energy×salience）、20 条/2000 字符截断、空集返回 `profile: null`
- 插件 transform：gateway 不可达 → 无块、不抛异常、不阻塞；有 pinned → 块在 memory-guide 之后
- `mafw_pin_memory`：pin/unpin 往返；不存在 id 显式报错

**回归：**
- LongMemEval 摄入基准不受影响（pinned 可选、缺省 false）
- 全量 gateway jest + plugin 测试

## 10. 验收标准

1. `mafw_add_memory { pinned: true }` 写入后，下一轮 LLM 调用的 system prompt 含 `<user-profile>` 且含该条 memory_value
2. 会话压缩（summarize）后，披露块仍在（system transform 每轮重建）
3. gateway 停止时，system transform 不报错、不注入空块
4. 21 条 pinned 时只注入 20 条，日志有 overflow 记录
5. superseded 的 pinned 记忆不出现在披露块
6. `mafw_pin_memory { id, pinned: false }` 后披露块不再含该条
