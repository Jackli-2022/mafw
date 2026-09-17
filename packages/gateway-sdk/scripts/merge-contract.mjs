/**
 * P4：合并契约产物。
 *
 *   gateway-paths.json（gateway catalog 生成，事实源）
 *   + overrides.json（手写元数据：summary/description/responseSchema，按 operationId keyed）
 *   → openapi.json（SDK 契约 + openapi-typescript 输入）
 *
 * 运行：node scripts/merge-contract.mjs（gen:api 前置步骤，一般不手动跑）
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const contractDir = join(here, '..', 'contract');

const gatewayPaths = JSON.parse(readFileSync(join(contractDir, 'gateway-paths.json'), 'utf-8'));
const overrides = JSON.parse(readFileSync(join(contractDir, 'overrides.json'), 'utf-8')).operations ?? {};

const paths = {};
let overrideHits = 0;
const knownOverrides = new Set(Object.keys(overrides));

for (const [p, methods] of Object.entries(gatewayPaths.paths)) {
  paths[p] = {};
  for (const [method, op] of Object.entries(methods)) {
    const o = { ...op };
    const ov = overrides[op.operationId];
    if (ov) {
      overrideHits++;
      knownOverrides.delete(op.operationId);
      if (ov.summary) o.summary = ov.summary;
      if (ov.description) o.description = ov.description;
      if (ov.responseSchema) {
        o.responses = {
          200: {
            description: ov.responseDescription || 'OK',
            content: { 'application/json': { schema: ov.responseSchema } },
          },
        };
      }
    }
    paths[p][method] = o;
  }
}

if (knownOverrides.size > 0) {
  console.error(`[merge-contract] WARNING: overrides 引用了不存在的 operationId: ${[...knownOverrides].join(', ')}`);
  process.exit(1);
}

const out = {
  openapi: '3.1.0',
  info: {
    title: 'MAFW Gateway API — SDK-facing contract',
    version: '2.0.0',
    description: [
      'P4 生成的契约：paths 由 gateway routes/route-catalog.ts 经 emit-openapi 脚本产出（gateway-paths.json），',
      '本文件 = gateway-paths.json + overrides.json（手写 summary/description/responseSchema 元数据）合并产物，勿手改。',
      '变更链路：route-catalog.ts → (gateway) npm run emit:openapi → (sdk) npm run gen:api → api-schema.gen.ts。',
      'tags 含 internal 的 operation 不被 @mafw/sdk 调用（服务端内部/dashboard/mobile 用）。',
    ].join(''),
  },
  paths,
};

const dest = join(contractDir, 'openapi.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf-8');
const opCount = Object.values(paths).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`[merge-contract] ${Object.keys(paths).length} paths / ${opCount} operations（overrides 命中 ${overrideHits}）→ ${dest}`);
