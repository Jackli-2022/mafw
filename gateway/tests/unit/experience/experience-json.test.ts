import * as fs from 'fs';
import * as path from 'path';
import {
  EXPERIENCE_ACTION_IDS,
  MIN_CLIENT_EXPERIENCE_VERSION,
  buildExperienceContractManifest,
} from '../../../src/experience/experience-contract';

describe('Experience contract JSON', () => {
  const file = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'experience-contract.json');
  const generated = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  it('is fresh against the gateway manifest', () => {
    expect(generated()).toEqual(buildExperienceContractManifest());
  });

  it('carries every projected action id and the client floor', () => {
    const json = generated();
    expect(json.minClientVersion).toBe(MIN_CLIENT_EXPERIENCE_VERSION);
    expect(json.actions.map((a: { id: string }) => a.id)).toEqual([...EXPERIENCE_ACTION_IDS]);
    expect(new Set(json.actions.map((a: { id: string }) => a.id)).size).toBe(EXPERIENCE_ACTION_IDS.length);
  });
});
