import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PermissionRulesStore, deriveAlwaysRule } from '../../../src/core/approval/rules-store';
import { ApprovalCandidate } from '../../../src/core/approval/safety-classifier';

function tmpStore(): PermissionRulesStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rules-'));
  return new PermissionRulesStore(dir);
}

describe('PermissionRulesStore', () => {
  test('add/list/remove roundtrip + dedupe', () => {
    const s = tmpStore();
    expect(s.list()).toEqual([]);
    expect(s.add({ tool: 'bash', pattern: 'git status', action: 'allow' }).ok).toBe(true);
    expect(s.add({ tool: 'bash', pattern: 'git status', action: 'allow' }).ok).toBe(true); // 幂等
    expect(s.list()).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
    expect(s.add({ tool: 'read', action: 'allow' }).ok).toBe(true);
    expect(s.remove({ tool: 'read', action: 'allow' }).ok).toBe(true);
    expect(s.remove({ tool: 'read', action: 'allow' }).ok).toBe(false);
    expect(s.list()).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
  });

  test('persists across instances (file-backed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rules-'));
    new PermissionRulesStore(dir).add({ tool: 'write', action: 'allow' });
    expect(new PermissionRulesStore(dir).list()).toEqual([{ tool: 'write', action: 'allow' }]);
  });

  test('corrupt file → fail-open empty list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rules-'));
    fs.writeFileSync(path.join(dir, 'permission-rules.json'), '{oops');
    expect(new PermissionRulesStore(dir).list()).toEqual([]);
  });

  test('matches: tool-level rule matches any candidate of that tool', () => {
    const s = tmpStore();
    s.add({ tool: 'read', action: 'allow' });
    expect(s.matches('Read', { toolName: 'read', patterns: [] })).toBe(true);
    expect(s.matches('bash', { toolName: 'bash', patterns: [] })).toBe(false);
  });

  test('matches: prefix pattern via commandText and patterns (case-insensitive, trailing *)', () => {
    const s = tmpStore();
    s.add({ tool: 'bash', pattern: 'git status', action: 'allow' });
    const cand: ApprovalCandidate = { toolName: 'bash', patterns: ['git status --porcelain'], metadata: { args: 'git status' } };
    expect(s.matches('bash', cand)).toBe(true);
    expect(s.matches('bash', { toolName: 'bash', patterns: ['git push'] })).toBe(false);
  });
});

describe('deriveAlwaysRule', () => {
  test('scope prefix → patterns[0] stripped of trailing *', () => {
    expect(deriveAlwaysRule({ permission: 'bash', patterns: ['git status*'] }, 'prefix'))
      .toEqual({ tool: 'bash', pattern: 'git status', action: 'allow' });
  });
  test('scope tool → bare tool name', () => {
    expect(deriveAlwaysRule({ permission: 'bash', patterns: ['git status'] }, 'tool'))
      .toEqual({ tool: 'bash', action: 'allow' });
  });
  test('scope true (legacy) → prefix preferred, fallback tool', () => {
    expect(deriveAlwaysRule({ permission: 'bash', patterns: ['git status*'] }, true))
      .toEqual({ tool: 'bash', pattern: 'git status', action: 'allow' });
    expect(deriveAlwaysRule({ permission: 'read', patterns: [] }, true))
      .toEqual({ tool: 'read', action: 'allow' });
  });
  test('no tool → null', () => {
    expect(deriveAlwaysRule({}, 'tool')).toBeNull();
  });
});
