import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { validateJsonSchema } from '../../../src/runtime/json-schema';

const CONTRACT = join(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'runtime-contract.json');
const SCHEMA = join(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'runtime-contract.schema.json');

describe('runtime contract JSON freshness', () => {
  it('checked-in JSON matches the TypeScript source', () => {
    const raw = JSON.parse(readFileSync(CONTRACT, 'utf-8'));
    const { $comment, $schema, ...manifest } = raw;
    expect(manifest).toEqual(buildRuntimeContractManifest());
  });

  it('schema validates the manifest', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8'));
    expect(validateJsonSchema(schema, buildRuntimeContractManifest())).toEqual([]);
  });
});
