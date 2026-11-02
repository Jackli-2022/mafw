import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isMafwMessage,
  VIEW_DTO_CONTRACT_VERSION,
  VIEW_DTO_REQUIRED_FIELDS,
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

test('view-dto required field inventory stays fresh with the contract JSON', () => {
  const contract = JSON.parse(
    readFileSync(new URL('../contract/view-dto.json', import.meta.url), 'utf-8'),
  );
  assert.equal(contract.contractVersion, VIEW_DTO_CONTRACT_VERSION);
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS, {
    message: contract.messages,
    part: contract.parts,
    model: contract.model,
    session: contract.session,
    diff: contract.diff,
    provider: contract.provider,
    agent: contract.agent,
    permission: contract.permission,
    question: contract.question,
    background: contract.background,
  });
});
