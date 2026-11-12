import {
  buildTechLeadPromptParts,
  normalizeTechLeadParts,
} from '../../../src/core/pod/pod-tech-lead-service';
import { handlePodCollaboration } from '../../../src/routes/pod-collaboration';
import { Readable } from 'node:stream';

test('synthetic mode part comes before the content part', () => {
  const parts = buildTechLeadPromptParts(
    [{ type: 'text', text: '[[mode:propose]] options', synthetic: true }],
    'hello',
  );
  expect(parts).toEqual([
    { type: 'text', text: '[[mode:propose]] options', synthetic: true },
    { type: 'text', text: 'hello' },
  ]);
});

test('missing parts normalize to an empty list', () => {
  expect(normalizeTechLeadParts(undefined)).toEqual([]);
  expect(normalizeTechLeadParts(null)).toEqual([]);
  expect(normalizeTechLeadParts('nope')).toEqual([]);
});

test('parts are capped at eight text entries', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: 'text', text: `p${i}`, synthetic: true }));
  expect(normalizeTechLeadParts(many)).toHaveLength(8);
  expect(normalizeTechLeadParts([{ type: 'file', text: 'x' }])).toEqual([]);
  expect(normalizeTechLeadParts([{ type: 'text', text: 42 }])).toEqual([]);
});

test('route passes validated parts through to the tech lead prompt', async () => {
  const prompt = jest.fn(async () => ({
    goalId: 'g1',
    revision: 1,
    sessionID: 'ses_tech_lead',
    text: 'hello',
  }));
  const req: any = Readable.from([JSON.stringify({
    text: 'hello',
    parts: [
      { type: 'text', text: '[[mode:propose]] 请给出选项。', synthetic: true },
      { type: 'file', text: 'ignored' },
    ],
  })]);
  req.method = 'POST';
  const out = { status: 0, body: '' };
  const res: any = {
    writeHead: (status: number) => { out.status = status; return res; },
    end: (chunk?: any) => { out.body = chunk == null ? '' : String(chunk); },
  };
  const handled = await handlePodCollaboration(
    req,
    res,
    '/api/pods/pod_1/goals/g1/tech-lead/messages',
    {
      pods: { get: () => ({ pod: { id: 'pod_1' } }), lookup: () => null },
      goals: { list: () => [{ goalId: 'g1' }], rejectResult: async () => ({}) },
      techLead: { prompt, ensureSession: async () => 'ses_tech_lead', history: async () => ({}) },
    } as any,
  );
  expect(handled).toBe(true);
  expect(out.status).toBe(200);
  expect(prompt).toHaveBeenCalledWith('g1', 'hello', {
    parts: [{ type: 'text', text: '[[mode:propose]] 请给出选项。', synthetic: true }],
  });
});
