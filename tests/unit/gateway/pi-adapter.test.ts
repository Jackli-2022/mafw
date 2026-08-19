import { fixMediaPayload, createPiPromptAdapter } from '../../../gateway/src/media/pi-adapter'

describe('fixMediaPayload', () => {
  it('returns undefined for non-payload input', () => {
    expect(fixMediaPayload(null)).toBeUndefined()
    expect(fixMediaPayload('nope')).toBeUndefined()
    expect(fixMediaPayload({})).toBeUndefined()
    expect(fixMediaPayload({ messages: 'x' })).toBeUndefined()
  })

  it('rewrites video image_url blocks to video_url', () => {
    const payload = {
      messages: [
        { role: 'user', content: [
          { type: 'text', text: 'hi' },
          { type: 'image_url', image_url: { url: 'data:video/mp4;base64,QUFB' } },
        ] },
      ],
    }
    const out = fixMediaPayload(payload) as any
    expect(out).toBe(payload)
    const part = out.messages[0].content[1]
    expect(part).toEqual({ type: 'video_url', video_url: { url: 'data:video/mp4;base64,QUFB' } })
  })

  it('rewrites audio image_url blocks to input_audio with the full data URI', () => {
    const payload = {
      messages: [
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:audio/mpeg;base64,QUFB' } },
        ] },
      ],
    }
    const out = fixMediaPayload(payload) as any
    expect(out).toBe(payload)
    const part = out.messages[0].content[0]
    expect(part).toEqual({ type: 'input_audio', input_audio: { data: 'data:audio/mpeg;base64,QUFB' } })
  })

  it('leaves real images untouched and returns undefined', () => {
    const payload = {
      messages: [
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUFB' } },
        ] },
      ],
    }
    expect(fixMediaPayload(payload)).toBeUndefined()
    expect(payload.messages[0].content[0].type).toBe('image_url')
  })

  it('handles string content messages without crashing', () => {
    const payload = { messages: [{ role: 'user', content: 'plain text' }] }
    expect(fixMediaPayload(payload)).toBeUndefined()
  })
})

describe('createPiPromptAdapter', () => {
  function makeAdapter(opts: { getApiKey?: (p: string) => string | undefined } = {}) {
    let runtime: any
    const adapter = createPiPromptAdapter({
      getApiKey: opts.getApiKey ?? (() => 'sk-test'),
      getModel: (provider, model) => ({ id: model, provider, input: ['text', 'image'] }),
    })
    // stub the private ModelRuntime through the closure is not possible; test
    // the parts assembly via the injected hooks instead by mocking the module.
    return adapter
  }

  it('is a function implementing PromptFn', () => {
    const adapter = makeAdapter()
    expect(typeof adapter).toBe('function')
  })

  it('throws when the provider has no API key', async () => {
    const adapter = makeAdapter({ getApiKey: () => undefined })
    await expect(
      adapter([{ type: 'text', text: 'q' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' }),
    ).rejects.toThrow(/No API key/)
  })
})
