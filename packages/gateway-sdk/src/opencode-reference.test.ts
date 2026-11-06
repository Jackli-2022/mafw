import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractEventReference,
  extractEventSchemaClosure,
  renderEventMapMd,
  renderEventsJson,
  renderEventsSchemaJson,
  renderEventsTs,
  renderReadme,
  suggestCanonical,
} from './opencode-reference'

const spec = {
  openapi: '3.1.0',
  components: {
    schemas: {
      V2Event: {
        anyOf: [
          { $ref: '#/components/schemas/session.created' },
          { $ref: '#/components/schemas/session.execution.started' },
          { $ref: '#/components/schemas/V2Event.rpc' },
        ],
      },
      'session.created': {
        type: 'object',
        properties: {
          type: { enum: ['session.created'] },
          properties: { $ref: '#/components/schemas/Session.Info' },
        },
        required: ['type', 'properties'],
      },
      'Session.Info': {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      'session.execution.started': {
        type: 'object',
        properties: { type: { const: 'session.execution.started' } },
        required: ['type'],
      },
      'V2Event.rpc': {
        type: 'object',
        properties: { type: { type: 'string', pattern: '^rpc\\.[\\s\\S]*?$' } },
        required: ['type'],
      },
    },
  },
}

const meta = { source: 'fixture.json', bytes: 123, sha256: 'abc123' }
const canonical = ['session.created', 'turn.started', 'turn.completed', 'part.updated', 'part.delta']

test('extractEventReference reads the V2Event union (types, required, rpc)', () => {
  const ref = extractEventReference(spec)
  assert.equal(ref.schema, 'V2Event')
  assert.equal(ref.variants.length, 3)
  const created = ref.variants.find((v) => v.schema === 'session.created')!
  assert.equal(created.type, 'session.created')
  assert.deepEqual(created.required, ['type', 'properties'])
  const rpc = ref.variants.find((v) => v.schema === 'V2Event.rpc')!
  assert.equal(rpc.type, null)
  assert.equal(rpc.rpc, true)
})

test('extractEventReference explains a missing union (stale running-instance spec)', () => {
  assert.throws(
    () => extractEventReference({ components: { schemas: {} } }),
    /packages\/protocol\/openapi\.json/,
  )
})

test('renderEventsTs emits a union alias, a sorted type list, and the rpc prefix', () => {
  const ref = extractEventReference(spec)
  const ts = renderEventsTs(ref, meta)
  assert.match(ts, /export type OpencodeEvent = components\['schemas'\]\['V2Event'\]/)
  assert.match(ts, /OPENCODE_EVENT_TYPES/)
  const createdIdx = ts.indexOf("'session.created'")
  const startedIdx = ts.indexOf("'session.execution.started'")
  assert.ok(createdIdx > 0 && startedIdx > createdIdx, 'types are sorted')
  assert.match(ts, /OPENCODE_RPC_PREFIX = 'rpc\.'/)
  assert.ok(!ts.includes("'V2Event.rpc'"), 'rpc variant does not leak into the literal list')
})

test('extractEventSchemaClosure follows transitive refs and rewrites them to $defs', () => {
  const ref = extractEventReference(spec)
  const closure = extractEventSchemaClosure(spec, ref)
  assert.ok(closure.names.includes('session.created'))
  assert.ok(closure.names.includes('Session.Info'), 'nested $ref is included')
  assert.equal((closure.defs['session.created'] as any).properties.properties.$ref, '#/$defs/Session.Info')
})

test('renderEventsSchemaJson is a self-contained JSON Schema (oneOf + $defs)', () => {
  const ref = extractEventReference(spec)
  const schema = JSON.parse(renderEventsSchemaJson(spec, ref, meta))
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.oneOf.length, 3)
  assert.deepEqual(schema.oneOf[0], { $ref: '#/$defs/session.created' })
  assert.ok(schema.$defs['Session.Info'])
  assert.equal(schema['x-event-count'], 3)
})

test('renderEventsJson is machine readable and keeps variant metadata', () => {
  const ref = extractEventReference(spec)
  const json = JSON.parse(renderEventsJson(ref, meta))
  assert.equal(json.count, 3)
  assert.equal(json.schema, 'V2Event')
  const rpc = json.events.find((e: any) => e.rpc)
  assert.equal(rpc.schema, 'V2Event.rpc')
})

test('suggestCanonical prefers exact names, then rules, else null', () => {
  assert.equal(suggestCanonical('session.created', canonical), 'session.created')
  assert.equal(suggestCanonical('session.execution.started', canonical), 'turn.started')
  assert.equal(suggestCanonical('session.execution.failed', canonical), null)
  assert.equal(suggestCanonical(null, canonical), null)
})

test('renderEventMapMd marks suggestions and the rpc row', () => {
  const ref = extractEventReference(spec)
  const md = renderEventMapMd(ref, canonical, meta)
  assert.match(md, /\| `session\.created` \| `session\.created` \| `session\.created` \|/)
  assert.match(md, /\| `session\.execution\.started` \| `session\.execution\.started` \| `turn\.started` \|/)
  assert.match(md, /V2Event\.rpc/)
})

test('renderReadme records source, counts and the regeneration command', () => {
  const ref = extractEventReference(spec)
  const readme = renderReadme(ref, canonical, meta)
  assert.match(readme, /\*\*3\*\* 个变体/)
  assert.match(readme, /gen:opencode-ref/)
  assert.match(readme, /sha256/)
})
