import * as yaml from 'js-yaml';
import { extractSkillContract, validateSkillContract, SkillContract } from '../../../src/memory/skill-contract';
import { renderSkillMd } from '../../../src/memory/skill-promotion';

const body = `## Triggers
- deploy gateway
- serve sidecar

## Negative Triggers
- production database

## Inputs
- repo path

## Outputs
- healthy gateway

## Steps
1. run build
2. restart serve
3. verify health

## Tools
- npm
- curl

## Permissions
- read files
- run tests

## Success Criteria
- health endpoint returns ok

## Failure Handling
- rollback and retry once

## Scope
- repo:gateway
`;

describe('extractSkillContract', () => {
  test('parses markdown contract sections', () => {
    const c = extractSkillContract({ memory_value: body, cue_anchors: ['deploy', 'cat:insight'] });
    expect(c.triggers).toEqual(['deploy gateway', 'serve sidecar']);
    expect(c.negativeTriggers).toEqual(['production database']);
    expect(c.inputs).toEqual(['repo path']);
    expect(c.outputs).toEqual(['healthy gateway']);
    expect(c.steps).toEqual(['run build', 'restart serve', 'verify health']);
    expect(c.tools).toEqual(['npm', 'curl']);
    expect(c.permissions).toEqual(['read files', 'run tests']);
    expect(c.successCriteria).toEqual(['health endpoint returns ok']);
    expect(c.failureHandling).toEqual(['rollback and retry once']);
    expect(c.scope).toEqual(['repo:gateway']);
  });

  test('falls back to anchors, numbered steps and session scope', () => {
    const c = extractSkillContract({
      memory_value: '1. first step\n2. second step',
      cue_anchors: ['serve', 'watchdog', 'verified:2026-10-01', 'not:prod'],
      source_session_id: 'ses_123',
    });
    expect(c.triggers).toEqual(['serve', 'watchdog']);
    expect(c.negativeTriggers).toEqual(['prod']);
    expect(c.steps).toEqual(['first step', 'second step']);
    expect(c.scope).toEqual(['session:ses_123']);
  });

  test('validates required triggers, steps and scope', () => {
    const ok = extractSkillContract({ memory_value: body, cue_anchors: [] });
    expect(validateSkillContract(ok)).toEqual({ valid: true, errors: [] });

    const broken: SkillContract = { ...ok, triggers: [], steps: [], scope: [] };
    const v = validateSkillContract(broken);
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('triggers');
    expect(v.errors.join(' ')).toContain('steps');
    expect(v.errors.join(' ')).toContain('scope');
  });
});

describe('renderSkillMd contract frontmatter', () => {
  test('renders all contract fields and source ids', () => {
    const contract = extractSkillContract({ memory_value: body, cue_anchors: [] });
    const r = renderSkillMd({
      id: 'mem_1_abcdef',
      primary_abstraction: 'deploy gateway safely',
      memory_value: body,
      cue_anchors: ['deploy'],
      source_trace_ids: ['t1t_a'],
    }, contract);
    const match = r.content.match(/^---\n([\s\S]*?)\n---\n/);
    expect(match).toBeTruthy();
    const fm = yaml.load(match![1]) as any;
    expect(fm.name).toBe('ms-abcdef');
    expect(fm.version).toBe(1);
    expect(fm.status).toBe('staging');
    expect(fm.source_memory_ids).toEqual(['mem_1_abcdef']);
    expect(fm.source_trace_ids).toEqual(['t1t_a']);
    expect(fm.triggers).toEqual(['deploy gateway', 'serve sidecar']);
    expect(fm.steps).toEqual(['run build', 'restart serve', 'verify health']);
    expect(fm.success_criteria).toEqual(['health endpoint returns ok']);
    expect(r.content).toContain('## Steps');
    expect(r.content).toContain('1. run build');
    expect(r.content).toContain('## Success Criteria');
  });

  test('renders explicit 待补充 sections for empty optional fields', () => {
    const r = renderSkillMd({
      id: 'mem_1_abcdef',
      primary_abstraction: 'P',
      memory_value: '1. a\n2. b',
      cue_anchors: ['alpha'],
    });
    expect(r.content).toContain('## Inputs');
    expect(r.content).toContain('待补充');
  });
});
