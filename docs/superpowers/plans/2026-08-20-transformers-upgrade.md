# Transformers.js 升级计划 (v2 → v4)

## 目标
将 `@xenova/transformers` v2.17.2 升级到 `@huggingface/transformers` v4.2.0，获得：
- 原生 `HF_ENDPOINT` 环境变量支持（消除手动 `env.remoteHost` hack）
- 正确的 cross-encoder pair 语义（`text-classification` pipeline）
- 可用 `bge-reranker-base` 等高质量重排模型

## 影响范围

### 文件变更
1. `package.json` - 根依赖
2. `gateway/package.json` - gateway 依赖
3. `gateway/src/core/compression/vector-index.ts` - 直接 import
4. `gateway/src/core/memory/reranker.ts` - 动态 import

### 关键改动
- 包名：`@xenova/transformers` → `@huggingface/transformers`
- 移除 `env.remoteHost` 手动设置（v4 原生支持 `HF_ENDPOINT`）
- `reranker.ts` 恢复 cross-encoder 实现（使用 `bge-reranker-base`）

## 实施步骤

### Step 1: 更新依赖
```bash
# 根目录
npm uninstall @xenova/transformers
npm install @huggingface/transformers@^4.2.0

# gateway 目录
cd gateway
npm uninstall @xenova/transformers
npm install @huggingface/transformers@^4.2.0
```

### Step 2: 更新 vector-index.ts
```typescript
// 改 import
import { pipeline } from '@huggingface/transformers';
```

### Step 3: 更新 reranker.ts
```typescript
// 1. 改动态 import 包名
const mod: any = await new Function('spec', 'return import(spec)')('@huggingface/transformers');

// 2. 移除 env.remoteHost hack（v4 原生支持 HF_ENDPOINT）
// 删除: mod.env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com/';

// 3. 恢复 cross-encoder 实现
private modelName = 'Xenova/bge-reranker-base';
// 使用 text-classification pipeline（v4 支持 pair 语义）
this.pipeline = await mod.pipeline('text-classification', this.modelName);
```

### Step 4: 验证
```bash
# 编译检查
npm run build

# 单元测试
npm run test:unit

# 手动验证 reranker
node -e "
const { CrossEncoderReranker } = require('./gateway/dist/core/memory/reranker');
(async () => {
  const r = new CrossEncoderReranker();
  const result = await r.rerank('What is the capital of France?', [
    { entry: { id: '1', primary_abstraction: 'Paris is the capital of France.', cue_anchors: [] }, score: 0.5 },
    { entry: { id: '2', primary_abstraction: 'The cat sat on the mat.', cue_anchors: [] }, score: 0.3 }
  ], 2);
  console.log('Rerank result:', result);
})();
"
```

## 风险与回退

### 风险
- v4 API 可能与 v2 不完全兼容
- `bge-reranker-base` 在 hf-mirror 上可能仍不可用
- `onnxruntime-node` 1.24.3 可能需要额外安装

### 回退方案
如果升级失败，回退到 v2.17.2 + bi-encoder 实现（当前状态）：
```bash
npm uninstall @huggingface/transformers
npm install @xenova/transformers@^2.17.2
```

## 预期收益
- 消除 `env.remoteHost` hack（代码更干净）
- Cross-encoder 可用（质量提升）
- 未来可升级到 v5+（持续维护）
