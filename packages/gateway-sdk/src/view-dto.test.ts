import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isMafwMessage,
  isMafwPart,
  narrowMafwMessage,
  narrowMafwPart,
  VIEW_DTO_CONTRACT_VERSION,
  VIEW_DTO_FIELD_INVENTORY,
  VIEW_DTO_REQUIRED_FIELDS,
  viewDtoContract,
  type MafwCheckpoint,
  type MafwMessage,
} from './view-dto';

test('message and tool part keep identity and canonical fields', () => {
  const msg: MafwMessage = {
    id: 'msg_1', sessionID: 'ses_1', role: 'assistant',
    model: { providerID: 'pi', modelID: 'm1' },
    stopReason: 'cancelled',
    content: [{
      id: 'part_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'tool',
      callID: 'call_1', tool: 'shell', toolClass: 'shell', canonicalTool: 'bash',
      state: { status: 'completed', input: { command: 'pwd' }, output: '/tmp' },
    }],
  };
  assert.equal(isMafwMessage(msg), true);
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS.part, ['id', 'type']);
});

test('provider models are always arrays', () => {
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS.provider, ['id', 'name', 'models']);
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS.model, ['id', 'name']);
});

test('view-dto contract JSON is emitted from the TS manifest', () => {
  const contract = JSON.parse(
    readFileSync(new URL('../contract/view-dto.json', import.meta.url), 'utf-8'),
  );
  assert.equal(contract.contractVersion, VIEW_DTO_CONTRACT_VERSION);
  assert.deepEqual(contract, viewDtoContract());
});

test('field inventory covers the review-focus fields', () => {
  const toolFields = VIEW_DTO_FIELD_INVENTORY.part.variants.tool as readonly string[];
  for (const field of ['callID', 'tool', 'toolClass', 'canonicalTool', 'state']) {
    assert.ok(toolFields.includes(field), `part.tool must cover ${field}`);
  }
  const messageFields = VIEW_DTO_FIELD_INVENTORY.message.fields as readonly string[];
  for (const field of ['model', 'stopReason', 'summary', 'error']) {
    assert.ok(messageFields.includes(field), `message must cover ${field}`);
  }
});

test('checkpoint view is part of the contract inventory', () => {
  const checkpoint: MafwCheckpoint = {
    id: 'ck_1', sessionID: 'ses_1', anchorMessageID: 'msg_1',
    kind: 'auto', createdAt: '2026-11-02T00:00:00.000Z', filesAvailable: true,
  };
  for (const field of VIEW_DTO_REQUIRED_FIELDS.checkpoint) {
    assert.ok(field in checkpoint, `checkpoint required field ${field}`);
  }
});

test('guards prove a boundary shape; the known union needs explicit narrowing', () => {
  const unknownPart = { id: 'p1', type: 'subtask', parentID: 'x', anything: 'kept' };
  assert.equal(isMafwPart(unknownPart), true);
  assert.equal(narrowMafwPart(unknownPart), null);

  const toolPart = {
    id: 'p2', type: 'tool', callID: 'c1', tool: 'bash',
    state: { status: 'completed', output: '/' },
  };
  const narrowed = narrowMafwPart(toolPart);
  assert.equal(narrowed?.type, 'tool');

  assert.equal(isMafwMessage({ info: { role: 'user' }, parts: [] }), false);
});

test('message narrowing fails when a part has no known variant', () => {
  assert.equal(
    narrowMafwMessage({ role: 'user', content: [{ id: 'p', type: 'text', text: 'hi' }] })?.role,
    'user',
  );
  assert.equal(narrowMafwMessage({ role: 'user', content: [{ id: 'p', type: 'snapshot' }] }), null);
  assert.equal(isMafwMessage({ role: 'user', content: [{ id: 'p', type: 'snapshot' }] }), true);
});
