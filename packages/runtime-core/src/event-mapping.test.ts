import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEventMappings,
  canonicalIdentity,
  canonicalTypeSet,
  hasEventDeclarations,
  validateEventMappings,
  type EventMappingEntry,
} from './index.ts';
import { renderTemplate } from './path-expr.ts';

const CANONICAL = new Set(['turn.completed', 'session.updated', 'message.updated', 'part.updated', 'permission.asked']);
const isCanonical = (t: string) => CANONICAL.has(t);

const PI: EventMappingEntry = {
  eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
  eventMappings: [
    { from: ['agent_end', 'agent_settled'], to: 'turn.completed' },
    { from: 'agent_start', to: 'session.updated' },
    {
      from: ['message_start', 'message_update'],
      to: 'part.updated',
      fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } },
    },
    { from: 'message_end', to: 'message.updated', fields: { 'info.role': { const: 'assistant' } } },
    {
      from: 'turn_end',
      to: 'part.updated',
      fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } },
    },
    { from: 'queue_update', to: 'drop' },
  ],
};

test('pure rename + sessionID injection (properties level)', () => {
  assert.deepEqual(applyEventMappings({ type: 'agent_end', sessionID: 's1' }, PI, isCanonical), [
    { payload: { type: 'turn.completed', properties: { sessionID: 's1' } }, sessionID: 's1', directory: undefined },
  ]);
});

test('field construction + part-level sessionID + path default (nullish)', () => {
  assert.deepEqual(applyEventMappings({ type: 'message_update', sessionID: 's1', delta: 'he' }, PI, isCanonical), [
    {
      payload: { type: 'part.updated', properties: { part: { type: 'text', text: 'he', sessionID: 's1' } } },
      sessionID: 's1',
      directory: undefined,
    },
  ]);
  const out = applyEventMappings({ type: 'message_update', sessionID: 's1' }, PI, isCanonical);
  assert.equal((out[0] as any).payload.properties.part.text, '');
});

test('template id materialisation (turn_end → part.messageID)', () => {
  const out = applyEventMappings({ type: 'turn_end', sessionID: 's1' }, PI, isCanonical);
  assert.deepEqual((out[0] as any).payload.properties.part, {
    type: 'step-finish',
    messageID: 'pi_step_s1',
    sessionID: 's1',
  });
});

test('renderTemplate leaves missing interpolation undefined', () => {
  assert.equal(renderTemplate('pi_step_{$.sessionID}', { sessionID: 's1' }), 'pi_step_s1');
  assert.equal(renderTemplate('pi_step_{$.missing}', { sessionID: 's1' }), undefined);
});

test('when condition not satisfied → row skipped', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [
      { from: 'x', to: 'turn.completed', when: [{ path: '$.ok', equals: true }] },
      { from: 'x', to: 'session.updated' },
    ],
  };
  assert.equal(applyEventMappings({ type: 'x', ok: false }, entry, isCanonical)[0].payload.type, 'session.updated');
});

test('drop rows count suppressed; unregistered canonical → denied (default-deny); unknown → unmatched', () => {
  const suppressed: string[] = [];
  assert.deepEqual(
    applyEventMappings({ type: 'queue_update', sessionID: 's1' }, PI, isCanonical, {
      onSuppressed: (t) => suppressed.push(t),
    }),
    [],
  );
  assert.deepEqual(suppressed, ['queue_update']);
  const unmatched: string[] = [];
  assert.deepEqual(
    applyEventMappings({ type: 'turn.completed', properties: { sessionID: 's1' } }, PI, isCanonical, {
      onUnmatched: (t) => unmatched.push(t),
    }),
    [],
  );
  assert.deepEqual(applyEventMappings({ type: 'mystery' }, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) }), []);
  assert.deepEqual(unmatched, ['turn.completed', 'mystery']);
});

test('transformEvent escape hatch: called when unmatched; null=suppressed, array=fan-out', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [],
    transformEvent: (raw: any) =>
      raw.type === 'fan' ? [{ payload: { type: 'session.idle', properties: {} } }] : null,
  };
  const suppressed: string[] = [];
  assert.deepEqual(
    applyEventMappings({ type: 'other' }, entry, isCanonical, { onSuppressed: (t) => suppressed.push(t) }),
    [],
  );
  assert.deepEqual(suppressed, ['other']);
  assert.equal(applyEventMappings({ type: 'fan' }, entry, isCanonical).length, 1);
});

test('envelope shape: canonical passes (already translated stream); unknown denied; malformed passes downstream', () => {
  const pushed = { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r1' } } };
  assert.deepEqual(applyEventMappings(pushed, PI, isCanonical), [pushed]);
  const bad = { payload: { type: 'not.a.type', properties: {} } };
  const unmatched: string[] = [];
  assert.deepEqual(applyEventMappings(bad, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) }), []);
  assert.deepEqual(unmatched, ['not.a.type']);
  const malformed = { foo: 1 };
  assert.deepEqual(applyEventMappings(malformed, PI, isCanonical), [malformed]);
});

test('passProperties copies the whole properties object and fields override (siblings kept)', () => {
  const entry: EventMappingEntry = {
    eventSource: {
      typePath: '$.payload.type',
      sessionIdPath: ['$.payload.sessionID', '$.payload.properties.sessionID'],
      directoryPath: '$.directory',
    },
    eventMappings: [
      {
        from: 'message.part.updated',
        to: 'message.part.updated',
        passProperties: '$.payload.properties',
        fields: { 'part.type': { const: 'step-finish' } },
      },
    ],
  };
  const out = applyEventMappings(
    {
      directory: '/proj',
      payload: {
        type: 'message.part.updated',
        properties: { part: { type: 'text', text: 'hi', messageID: 'm1' }, keep: 1 },
      },
    },
    entry,
    isCanonical,
  );
  assert.deepEqual(out, [
    {
      payload: {
        type: 'message.part.updated',
        properties: { part: { type: 'step-finish', text: 'hi', messageID: 'm1' }, keep: 1 },
      },
      sessionID: undefined,
      directory: '/proj',
    },
  ]);
});

test('sessionIdPath array falls back in order (first truthy wins)', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.payload.type', sessionIdPath: ['$.payload.sessionID', '$.payload.properties.sessionID'] },
    eventMappings: [{ from: 'session.idle', to: 'turn.completed' }],
  };
  const out = applyEventMappings({ payload: { type: 'session.idle', properties: { sessionID: 's9' } } }, entry, isCanonical);
  assert.equal((out[0] as any).sessionID, 's9');
  assert.equal((out[0] as any).payload.properties.sessionID, 's9');
  const out2 = applyEventMappings(
    { payload: { type: 'session.idle', sessionID: 'top', properties: {} } },
    entry,
    isCanonical,
  );
  assert.equal((out2[0] as any).sessionID, 'top');
});

test('passProperties path missing → starts from an empty object (no throw)', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [{ from: 'x', to: 'turn.completed', passProperties: '$.missing.deep' }],
  };
  const out = applyEventMappings({ type: 'x' }, entry, isCanonical);
  assert.deepEqual(out[0].payload.properties, {});
});

test('validation: bad passProperties path + bad sessionIdPath array member', () => {
  const issues = validateEventMappings(
    {
      eventSource: { typePath: '$.type', sessionIdPath: ['$.ok', 'bad.path'] },
      eventMappings: [{ from: 'x', to: 'turn.completed', passProperties: 'no-dollar' }],
    },
    CANONICAL,
  );
  assert.equal(issues.some((i) => i.includes("sessionIdPath: bad path 'bad.path'")), true);
  assert.equal(issues.some((i) => i.includes('passProperties') && i.includes('no-dollar')), true);
});

test('message_end exact shape (properties.sessionID + info without sessionID)', () => {
  const out = applyEventMappings({ type: 'message_end', sessionID: 's1' }, PI, isCanonical);
  assert.deepEqual((out[0] as any).payload.properties, { sessionID: 's1', info: { role: 'assistant' } });
});

test('validateEventMappings: unknown canonical target → issue', () => {
  const issues = validateEventMappings(
    { eventSource: { typePath: '$.type' }, eventMappings: [{ from: 'a', to: 'not.a.type' }] },
    CANONICAL,
  );
  assert.equal(issues.some((i) => i.includes('not.a.type')), true);
});

test('validateEventMappings: drop is legal; bad paths and missing typePath are issues', () => {
  assert.deepEqual(
    validateEventMappings({ eventSource: { typePath: '$.type' }, eventMappings: [{ from: 'a', to: 'drop' }] }, CANONICAL),
    [],
  );
  assert.equal(
    validateEventMappings(
      {
        eventSource: { typePath: '$.type' },
        eventMappings: [{ from: 'a', to: 'turn.completed', fields: { 'x.y': { path: 'bad path' } } }],
      },
      CANONICAL,
    ).length,
    1,
  );
  assert.equal(validateEventMappings({ eventMappings: [{ from: 'a', to: 'turn.completed' }] }, CANONICAL).length, 1);
});

test('B2 transformEvent guard: throw → drop + onTranslationError, stream survives', () => {
  const entry = (fn: any): EventMappingEntry => ({ eventSource: { typePath: '$.type' }, eventMappings: [], transformEvent: fn });
  const errs: string[] = [];
  const out = applyEventMappings({ type: 'x' }, entry(() => { throw new Error('boom'); }), isCanonical, {
    onTranslationError: (_r, reason) => errs.push(reason),
  });
  assert.deepEqual(out, []);
  assert.match(errs[0], /boom/);
});

test('B2 transformEvent guard: string output (illegal shape) → drop + onTranslationError', () => {
  const entry = (fn: any): EventMappingEntry => ({ eventSource: { typePath: '$.type' }, eventMappings: [], transformEvent: fn });
  const errs: string[] = [];
  assert.deepEqual(
    applyEventMappings({ type: 'x' }, entry(() => 'garbage'), isCanonical, {
      onTranslationError: (_r, reason) => errs.push(reason),
    }),
    [],
  );
  assert.match(errs[0], /malformed/);
});

test('B2 transformEvent guard: array with a non-object member → drop + onTranslationError', () => {
  const entry = (fn: any): EventMappingEntry => ({ eventSource: { typePath: '$.type' }, eventMappings: [], transformEvent: fn });
  const errs: string[] = [];
  assert.deepEqual(
    applyEventMappings(
      { type: 'x' },
      entry(() => [{ payload: { type: 'session.updated', properties: {} } }, 42]),
      isCanonical,
      { onTranslationError: (_r, reason) => errs.push(reason) },
    ),
    [],
  );
  assert.equal(errs.length, 1);
});

test('B2 transformEvent guard: legal outputs (bare/envelope/array) pass through', () => {
  const entry = (fn: any): EventMappingEntry => ({ eventSource: { typePath: '$.type' }, eventMappings: [], transformEvent: fn });
  assert.equal(applyEventMappings({ type: 'x' }, entry(() => ({ type: 'session.updated' })), isCanonical).length, 1);
  assert.equal(
    applyEventMappings({ type: 'x' }, entry(() => [{ payload: { type: 'session.updated', properties: {} } }]), isCanonical)
      .length,
    1,
  );
});

test('hasEventDeclarations detects mapping rows and transformEvent', () => {
  assert.equal(hasEventDeclarations({}), false);
  assert.equal(hasEventDeclarations({ eventMappings: [] }), false);
  assert.equal(hasEventDeclarations({ eventTranslation: 'self' }), false);
  assert.equal(hasEventDeclarations({ eventMappings: [{ from: 'a', to: 'drop' }] }), true);
  assert.equal(hasEventDeclarations({ transformEvent: () => null }), true);
});

/** MAFW canonical 词汇样本（含 canonical-only 名，故意不含 AdapterEvent 的 `shell.updated`）。 */
const CANONICAL_VOCABULARY: readonly string[] = [
  'turn.completed',
  'session.updated',
  'message.updated',
  'part.updated',
  'part.complete',
  'task.updated',
  'session.config',
  'tool.call',
  'tool.delta',
  'tool.result',
];

test('canonicalIdentity derives one identity row per provided vocabulary entry (optionally passing properties)', () => {
  const identity = canonicalIdentity(undefined, CANONICAL_VOCABULARY);
  assert.equal(identity.length, CANONICAL_VOCABULARY.length);
  assert.ok(identity.every((row) => Array.isArray(row.from) === false && row.from === row.to));
  assert.equal(identity[0].passProperties, undefined);
  const withProps = canonicalIdentity('$.payload.properties', CANONICAL_VOCABULARY);
  assert.equal(withProps[0].passProperties, '$.payload.properties');
});

test('canonicalIdentity seam: canonical-only names are included, AdapterEvent-only names are not', () => {
  const froms = canonicalIdentity('$.payload.properties', CANONICAL_VOCABULARY).map((row) => row.from);
  assert.equal(froms.includes('part.complete'), true);
  assert.equal(froms.includes('task.updated'), true);
  assert.equal(froms.includes('tool.call'), true);
  assert.equal(froms.includes('shell.updated'), false);
  assert.equal(froms.includes('runtime.notice'), false);
  assert.deepEqual(froms, [...CANONICAL_VOCABULARY]);
});

test('canonicalTypeSet equals the provided vocabulary', () => {
  const set = canonicalTypeSet(CANONICAL_VOCABULARY);
  assert.equal(set.size, CANONICAL_VOCABULARY.length);
  for (const type of CANONICAL_VOCABULARY) assert.equal(set.has(type), true);
  assert.equal(set.has('session.updated'), true);
  assert.equal(set.has('shell.updated'), false);
  assert.equal(set.has('not.a.type'), false);
});
