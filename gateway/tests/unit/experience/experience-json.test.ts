import * as fs from 'fs';
import * as path from 'path';
import { buildExperienceContractManifest } from '../../../src/experience/experience-contract';

describe('Experience contract JSON', () => {
  it('is fresh against the gateway manifest', () => {
    const file = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'experience-contract.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(buildExperienceContractManifest());
  });
});
