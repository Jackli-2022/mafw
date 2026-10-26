import { SdkSessionResource } from '../../../src/resources/sdk-session';

function makeSdk() {
  const calls: any[] = [];
  const client = {
    session: {
      promptAsync: async (opts: any) => { calls.push(opts); },
      prompt: async (opts: any) => { calls.push(opts); return { parts: [{ type: 'text', text: 'ok' }] }; },
    },
  };
  return { sdk: new SdkSessionResource(client), calls };
}

describe('SdkSessionResource thinking controls', () => {
  it('promptAsync forwards thinkingLevel and variant', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.promptAsync('s1', 'hello', undefined, undefined, undefined, undefined, {
      thinkingLevel: 'high',
      variant: 'max',
    });
    expect(calls[0]).toMatchObject({ sessionID: 's1', thinkingLevel: 'high', variant: 'max' });
  });

  it('sync prompt forwards thinkingLevel and variant', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.prompt('s1', [{ type: 'text', text: 'hello' }], undefined, undefined, {
      thinkingLevel: 'off',
      variant: 'fast',
    });
    expect(calls[0]).toMatchObject({ sessionID: 's1', thinkingLevel: 'off', variant: 'fast' });
  });
});
