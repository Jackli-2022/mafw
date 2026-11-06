/**
 * plugin-audit：用 eventMappings + 契约 JSON 找「翻错 / 没输出 / 缺结构 / 接口面不对」。
 * 这里钉的是分类与提示文案（工具的输出契约），插件本身的行为由集成用例覆盖。
 */
import { auditCapabilities, auditMappings, auditPlugin, probeRuntimeApis, traceSamples, type AuditContract } from '../../../src/runtime/plugin-audit';

const contract: AuditContract = {
  contractVersion: 'test-1',
  events: [
    { type: 'turn.completed', requiredFields: ['sessionID'], consumers: ['desktop', 'tui'], producers: ['runtime'] },
    { type: 'session.created', requiredFields: ['info.id'], consumers: ['desktop'], producers: ['runtime'] },
    { type: 'part.updated', requiredFields: ['part'], consumers: ['desktop'], producers: ['runtime'] },
  ],
  capabilities: [
    { id: 'sessionApi', title: 'session API', requires: ['session.list'] },
    { id: 'eventStream', title: 'event stream', requires: [] },
    { id: 'discoveryApi', title: 'discovery', requires: ['discovery.list'] },
  ],
  surfaces: [
    { id: 'session.list', capability: 'sessionApi', obligation: 'required' },
    { id: 'discovery.list', capability: 'discoveryApi', obligation: 'gated' },
  ],
  presets: [
    { id: 'core', requiredSurfaces: ['session.list'], capabilities: ['sessionApi'] },
    { id: 'desktop', requiredSurfaces: ['session.list', 'discovery.list'], capabilities: ['sessionApi', 'discoveryApi'] },
  ],
};

const source = { typePath: '$.type', sessionIdPath: '$.session_id' };

describe('auditMappings', () => {
  test('detects a mapping that misses a contract-required field (consumers named)', () => {
    const findings = auditMappings(
      { eventSource: source, eventMappings: [{ from: 'system', to: 'session.created', fields: { sessionID: { path: '$.session_id' } } }] },
      contract,
    );
    const f = findings.find((x) => x.kind === 'missing-required');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.message).toContain('info.id');
    expect(f!.message).toContain('desktop');
    expect(f!.fix).toContain("'info.id'");
  });

  test('passProperties defers field checks to the runtime payload (no false positive)', () => {
    const findings = auditMappings(
      { eventSource: source, eventMappings: [{ from: 'system', to: 'session.created', passProperties: '$.payload.properties' }] },
      contract,
    );
    expect(findings.some((x) => x.kind === 'missing-required')).toBe(false);
  });

  test('unknown canonical target lists contract types as the fix', () => {
    const findings = auditMappings(
      { eventSource: source, eventMappings: [{ from: 'x', to: 'not.a.type' }] },
      contract,
    );
    const f = findings.find((x) => x.kind === 'unknown-target');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.fix).toContain('turn.completed');
  });

  test('unconditional earlier row makes later rows unreachable', () => {
    const findings = auditMappings({
      eventSource: source,
      eventMappings: [
        { from: 'a', to: 'turn.completed', fields: { sessionID: { path: '$.session_id' } } },
        { from: 'a', to: 'session.created', fields: { 'info.id': { path: '$.session_id' } } },
      ],
    }, contract);
    expect(findings.some((x) => x.kind === 'unreachable-mapping')).toBe(true);
  });

  test('drop row is reported as intentional suppression, not an error', () => {
    const findings = auditMappings(
      { eventSource: source, eventMappings: [{ from: 'noise', to: 'drop' }] },
      contract,
    );
    const f = findings.find((x) => x.kind === 'suppressed-row');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  test('without transformEvent, contract events no row produces are listed', () => {
    const findings = auditMappings(
      { eventSource: source, eventMappings: [{ from: 'done', to: 'turn.completed', fields: { sessionID: { path: '$.session_id' } } }] },
      contract,
    );
    const missing = findings.filter((x) => x.kind === 'no-producer').map((x) => x.message);
    expect(missing.join(' ')).toContain('part.updated');
    expect(missing.join(' ')).not.toContain('turn.completed');
  });
});

describe('traceSamples', () => {
  const good = {
    eventSource: source,
    eventMappings: [{ from: 'done', to: 'turn.completed', fields: { sessionID: { path: '$.session_id' } } }],
  };

  test('translated sample reports canonical type, facets and flow', () => {
    const [trace] = traceSamples(good, [{ type: 'done', session_id: 's1' }]);
    expect(trace.outcome).toBe('ok');
    expect(trace.via).toBe('mapping');
    expect(trace.mapping).toMatchObject({ index: 0, to: 'turn.completed' });
    expect(trace.outputs[0].type).toBe('turn.completed');
    expect(trace.outputs[0].facets.sessionID).toBe('s1');
    expect(trace.outputs[0].flow?.desktop).toBeTruthy();
  });

  test('missing required structure is bad-structure with the exact contract warning', () => {
    const entry = {
      eventSource: source,
      eventMappings: [{ from: 'part', to: 'part.updated', fields: { sessionID: { path: '$.session_id' } } }],
    };
    const [trace] = traceSamples(entry, [{ type: 'part', session_id: 's1' }]);
    expect(trace.outcome).toBe('bad-structure');
    expect(trace.outputs[0].warnings.join(' ')).toContain('properties.part');
  });

  test('unmatched native event produces no output with reason unmatched', () => {
    const [trace] = traceSamples(good, [{ type: 'mystery', session_id: 's1' }]);
    expect(trace.outcome).toBe('no-output');
    expect(trace.reason).toBe('unmatched');
    expect(trace.nativeType).toBe('mystery');
  });

  test('drop row produces no output with reason suppressed', () => {
    const entry = { eventSource: source, eventMappings: [{ from: 'noise', to: 'drop' }] };
    const [trace] = traceSamples(entry, [{ type: 'noise' }]);
    expect(trace.outcome).toBe('no-output');
    expect(trace.reason).toBe('suppressed');
  });

  test('throwing transformEvent produces no output with reason invalid', () => {
    const entry = {
      eventSource: source,
      eventMappings: [],
      transformEvent: () => { throw new Error('boom'); },
    };
    const [trace] = traceSamples(entry, [{ type: 'assistant' }]);
    expect(trace.outcome).toBe('no-output');
    expect(trace.reason).toBe('invalid');
    expect(trace.detail).toContain('boom');
  });

  test('transformEvent outputs are reported as via transform', () => {
    const entry = {
      eventSource: source,
      eventMappings: [],
      transformEvent: (raw: any) => ({ payload: { type: 'part.delta', properties: { delta: raw.text, sessionID: 's1' } } }),
    };
    const [trace] = traceSamples(entry, [{ type: 'stream', text: 'hi' }]);
    expect(trace.outcome).toBe('ok');
    expect(trace.via).toBe('transform');
    expect(trace.outputs[0].type).toBe('part.delta');
  });
});

describe('auditCapabilities', () => {
  test('unknown capability keys are flagged', () => {
    const { findings } = auditCapabilities({ sessionApi: true, bogusCap: true }, contract);
    expect(findings.find((f) => f.kind === 'unknown-capability')?.message).toContain('bogusCap');
  });

  test('preset capabilities not declared are flagged; missing surfaces come from runtime validation', () => {
    const { findings, surfaces } = auditCapabilities(
      { sessionApi: true },
      contract,
      {
        preset: 'desktop',
        runtimeValidation: {
          surfaces: { 'session.list': { status: 'present', impact: '' } },
        },
      },
    );
    expect(findings.some((f) => f.kind === 'preset-capability' && f.message.includes('discoveryApi'))).toBe(true);
    const session = surfaces.find((s) => s.capability === 'sessionApi');
    expect(session?.surfaces).toEqual(['session.list']);
    expect(session?.missing).toEqual([]);
  });

  test('runtime hard/downgraded findings are carried into the audit', () => {
    const { findings } = auditCapabilities({ sessionApi: true }, contract, {
      runtimeValidation: {
        hard: ['plugin: declares sessionApi but session.messages is missing'],
        downgraded: ['plugin: declares discoveryApi but discovery.list is missing'],
      },
    });
    expect(findings.find((f) => f.kind === 'runtime-hard')?.severity).toBe('error');
    expect(findings.find((f) => f.kind === 'runtime-downgraded')?.severity).toBe('warn');
  });
});

describe('probeRuntimeApis', () => {
  const shapeRt = () => ({
    getBaseUrl: () => 'http://127.0.0.1:3000',
    healthCheck: async () => true,
    session: {
      list: async () => [],
      todo: async () => [],
      children: async () => [],
    },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}) },
    tools: { nativeTools: () => [{ name: 'Read' }] },
    mcp: { list: async () => [] },
  });

  test('healthy runtime: every probed surface is ok', async () => {
    const probes = await probeRuntimeApis(shapeRt(), { timeoutMs: 200 });
    expect(probes.filter((p) => p.status === 'error')).toEqual([]);
    expect(probes.find((p) => p.surface === 'tools.nativeTools')?.status).toBe('ok');
  });

  test('missing method / wrong shape / throw are distinguished', async () => {
    const rt: any = shapeRt();
    delete rt.session.todo;
    rt.session.list = async () => 'not-an-array';
    rt.config.get = async () => { throw new Error('config blew up'); };
    const probes = await probeRuntimeApis(rt, { timeoutMs: 200 });
    // 方法缺席归 validateRuntime（presence）；探针不重复判死，标 skipped。
    expect(probes.find((p) => p.surface === 'session.todo')?.status).toBe('skipped');
    expect(probes.find((p) => p.surface === 'session.list')?.status).toBe('error');
    expect(probes.find((p) => p.surface === 'session.list')?.detail).toContain('bad shape');
    expect(probes.find((p) => p.surface === 'provider.config')?.status).toBe('error');
  });

  test('timeout is skipped, not an implementation error', async () => {
    const rt: any = shapeRt();
    rt.session.children = () => new Promise(() => {});
    const probes = await probeRuntimeApis(rt, { timeoutMs: 30 });
    const p = probes.find((x) => x.surface === 'session.children');
    expect(p?.status).toBe('skipped');
    expect(p?.detail).toContain('timeout');
  });
});

describe('auditPlugin', () => {
  test('aggregates mappings + capabilities + samples into one report', () => {
    const report = auditPlugin({
      entry: {
        eventSource: source,
        eventMappings: [
          { from: 'done', to: 'turn.completed', fields: { sessionID: { path: '$.session_id' } } },
          { from: 'sys', to: 'session.created', fields: { sessionID: { path: '$.session_id' } } },
        ],
      },
      capabilities: { sessionApi: true },
      contract,
      preset: 'core',
      samples: [{ type: 'done', session_id: 's1' }, { type: 'unknown' }],
      runtimeValidation: { surfaces: { 'session.list': { status: 'present', impact: '' } } },
    });
    expect(report.contractVersion).toBe('test-1');
    expect(report.mappings).toEqual({ total: 2, mapped: 2, drop: 0 });
    expect(report.summary.errors).toBeGreaterThanOrEqual(1); // session.created 缺 info.id
    expect(report.summary.samplesOk).toBe(1);
    expect(report.summary.samplesMissing).toBe(1);
    expect(report.capabilities.find((c) => c.capability === 'sessionApi')).toBeDefined();
  });
});
