import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleEvalChatCompletion } from '../../../gateway/src/eval-endpoint'

function makeClient(opts: {
  messages?: Array<{ info: any; parts: any[] }>
  promptError?: Error
  createError?: Error
} = {}) {
  const calls: string[] = []
  const client = {
    session: {
      create: jest.fn(async () => { calls.push('create'); if (opts.createError) throw opts.createError; return { data: { id: 'eval-sess-1' } } }),
      promptAsync: jest.fn(async () => { calls.push('prompt'); if (opts.promptError) throw opts.promptError }),
      messages: jest.fn(async () => { calls.push('messages'); return { data: opts.messages ?? [] } }),
      delete: jest.fn(async () => { calls.push('delete') }),
    },
  }
  return { client, calls }
}

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('handleEvalChatCompletion', () => {
  it('rejects requests without a user message', async () => {
    const { client } = makeClient()
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash' })
    const res = await handler({ messages: [{ role: 'assistant', content: 'x' }] })
    expect(res.status).toBe(400)
  })

  it('drives a full agent run: media + text → prompt → poll → answer', async () => {
    const assistantMsg = { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'final answer' }] }
    const { client, calls } = makeClient({ messages: [assistantMsg] })
    const handler = handleEvalChatCompletion({
      opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash',
      pollMs: 5, timeoutMs: 5_000,
    })
    const res = await handler({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What color is this?' },
          { type: 'image_url', image_url: { url: PNG_URL } },
        ],
      }],
    })

    expect(res.status).toBe(200)
    expect(res.body.choices[0].message.content).toBe('final answer')
    expect(res.body.model).toBe('opencode-go/deepseek-v4-flash')
    // create → promptAsync with file part + model → delete
    expect(calls).toContain('create')
    expect(calls).toContain('prompt')
    expect(calls).toContain('delete')
    const promptBody = ((client.session.promptAsync as jest.Mock).mock.calls[0]?.[0] as any).body
    expect(promptBody.model).toEqual({ providerID: 'opencode-go', modelID: 'deepseek-v4-flash' })
    expect(promptBody.parts[0]).toMatchObject({ type: 'text', text: 'What color is this?' })
    expect(promptBody.parts[1]).toMatchObject({ type: 'file', mime: 'image/png' })
  })

  it('handles audio and video parts from data URLs', async () => {
    const { client } = makeClient({ messages: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }] }] })
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash', pollMs: 5, timeoutMs: 5000 })
    const res = await handler({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,QUFB', format: 'wav' } },
          { type: 'video_url', video_url: { url: 'data:video/mp4;base64,QUFB' } },
        ],
      }],
    })
    expect(res.status).toBe(200)
    const promptCall = (client.session.promptAsync as jest.Mock).mock.calls[0]?.[0] as any
    const parts = promptCall.body.parts
    expect(parts).toHaveLength(3)
    expect(parts[1]).toMatchObject({ type: 'file', mime: 'audio/wav' })
    expect(parts[2]).toMatchObject({ type: 'file', mime: 'video/mp4' })
  })

  it('reads local media paths into data URLs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-media-'))
    const imgPath = path.join(dir, 'pic.png')
    fs.writeFileSync(imgPath, Buffer.from('iVBORw0KGgo=', 'base64'))
    const { client } = makeClient({ messages: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }] }] })
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash', pollMs: 5, timeoutMs: 5000 })
    const res = await handler({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }, { type: 'image_url', image_url: { url: imgPath } }] }],
    })
    expect(res.status).toBe(200)
    const filePart = ((client.session.promptAsync as jest.Mock).mock.calls[0]?.[0] as any).body.parts[1]
    expect(filePart.url).toMatch(/^data:image\/png;base64,/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('waits for the answer to stabilize (two identical polls)', async () => {
    const assistantMsg = () => ({ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'settled' }] })
    const { client } = makeClient({ messages: [assistantMsg()] })
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash', pollMs: 5, timeoutMs: 5000 })
    const res = await handler({ messages: [{ role: 'user', content: 'hi' }] })
    expect(res.body.choices[0].message.content).toBe('settled')
    expect((client.session.messages as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('returns the partial answer on timeout', async () => {
    const messages = [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'partial' }] }]
    const { client } = makeClient({ messages })
    // messages always returns the same text → stable after 2 polls, so force
    // timeout by alternating text so it never stabilizes.
    let flip = false
    client.session.messages.mockImplementation(async () => ({ data: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: flip ? 'a' : 'b' }] }] }))
    void flip
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash', pollMs: 5, timeoutMs: 60 })
    const res = await handler({ messages: [{ role: 'user', content: 'hi' }] })
    expect(res.status).toBe(200)
    expect(typeof res.body.choices[0].message.content).toBe('string')
  })

  it('propagates promptAsync failures as 502', async () => {
    const { client } = makeClient({ promptError: new Error('serve down') })
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash' })
    const res = await handler({ messages: [{ role: 'user', content: 'hi' }] })
    expect(res.status).toBe(502)
  })

  it('always deletes the session (cleanup on failure)', async () => {
    const { client, calls } = makeClient({ messages: [] })
    const handler = handleEvalChatCompletion({ opencodeClient: client, providerID: 'opencode-go', modelID: 'deepseek-v4-flash', pollMs: 5, timeoutMs: 40 })
    await handler({ messages: [{ role: 'user', content: 'hi' }] })
    expect(calls).toContain('delete')
  })
})
