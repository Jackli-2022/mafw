import * as fs from 'fs';
import * as path from 'path';

export interface ActivePolicy {
  version: string;
  proposalId: string | null;
}

export const BUILTIN_POLICY: ActivePolicy = { version: 'builtin-v1', proposalId: null };

export function getActivePolicy(mafwDir: string): ActivePolicy {
  try {
    const p = path.join(mafwDir, 'orchestration', 'active.json');
    if (!fs.existsSync(p)) return { ...BUILTIN_POLICY };
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (typeof data?.version !== 'string' || !data.version) return { ...BUILTIN_POLICY };
    return {
      version: data.version,
      proposalId: typeof data.proposalId === 'string' ? data.proposalId : null,
    };
  } catch {
    return { ...BUILTIN_POLICY };
  }
}
