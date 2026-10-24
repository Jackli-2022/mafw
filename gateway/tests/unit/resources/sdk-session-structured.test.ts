import { SdkSessionResource } from '../../../src/resources/sdk-session';
import { structuredOutput } from '../../../src/runtime/structured-output';

const schema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};

function makeSdk(responses: string[]) {
  const calls: any[] = [];
  const client = {
    session: {
      prompt: async (opts: any) => {
        calls.push(opts);
        const text = responses[Math.min(calls.length - 1, responses.length - 1)];
        return { parts: [{ type: 'text', text }] };
      },
      promptAsync: async (opts: any) => { calls.push(opts); },
    },
  };
  return { sdk: new SdkSessionResource(client), calls };
}

describe('SdkSessionResource outputSchema', () => {
  afterEach(() => structuredOutput.clear('s1'));

  it('appends the instruction and accepts a valid final JSON', async () => {
    const { sdk, calls } = makeSdk([JSON.stringify({ ok: true })]);
    const out = await sdk.prompt('s1', [{ type: 'text', text: 'do it' }], undefined, { name: 'x', schema });
    expect(calls[0].parts.at(-1).text).toContain('[MAFW STRUCTURED OUTPUT]');
    expect(out.structured).toEqual({ ok: true });
    expect(out.structuredError).toBeUndefined();
  });

  it('accepts a tool submission even when the final text is prose', async () => {
    const client = {
      session: {
        prompt: async (opts: any) => {
          structuredOutput.submit(opts.sessionID, { ok: true });
          return { parts: [{ type: 'text', text: 'done' }] };
        },
      },
    };
    const sdk = new SdkSessionResource(client);
    const out = await sdk.prompt('s1', [{ type: 'text', text: 'do it' }], undefined, { schema });
    expect(out.structured).toEqual({ ok: true });
  });

  it('retries invalid JSON once and includes the validation error', async () => {
    const { sdk, calls } = makeSdk([JSON.stringify({ ok: 'yes' }), JSON.stringify({ ok: true })]);
    const out = await sdk.prompt('s1', [{ type: 'text', text: 'do it' }], undefined, { schema, retryCount: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1].parts.at(-1).text).toContain('failed validation');
    expect(calls[1].parts.at(-1).text).toContain('$.ok');
    expect(out.structured).toEqual({ ok: true });
  });

  it('returns structuredError after retry exhaustion', async () => {
    const { sdk, calls } = makeSdk([JSON.stringify({ ok: 'yes' })]);
    const out = await sdk.prompt('s1', [{ type: 'text', text: 'do it' }], undefined, { schema, retryCount: 1 });
    expect(calls).toHaveLength(2);
    expect(out.structured).toBeUndefined();
    expect(out.structuredError).toContain('$.ok');
  });

  it('no outputSchema keeps the old single-call behavior', async () => {
    const { sdk, calls } = makeSdk(['plain answer']);
    const out = await sdk.prompt('s1', [{ type: 'text', text: 'hi' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].parts).toEqual([{ type: 'text', text: 'hi' }]);
    expect(out.structured).toBeUndefined();
  });

  it('promptAsync registers the schema and appends the instruction', async () => {
    const { sdk, calls } = makeSdk([]);
    await sdk.promptAsync('s1', 'do it', undefined, undefined, undefined, { schema });
    expect(calls[0].parts.at(-1).text).toContain('[MAFW STRUCTURED OUTPUT]');
    expect(structuredOutput.spec('s1')?.schema).toEqual(schema);
  });
});
