import { MediaAgent } from '../../../gateway/src/media/media-agent'
import { MediaService } from '../../../gateway/src/media/media-service'

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function makeAgent(analyzeImpl?: (media: { kind: string; dataUrl: string; mediaType: string }, prompt: string) => Promise<string>) {
  const media = {
    analyze: jest.fn(async (input: { kind: string; dataUrl: string; mediaType: string }, prompt: string) => {
      if (analyzeImpl) return analyzeImpl(input, prompt)
      return `描述了媒体 (${input.dataUrl.slice(0, 30)}...) prompt=${prompt.slice(0, 40)}`
    }),
    analyzeAudioNarrative: jest.fn(async (input: { kind: string; dataUrl: string; mediaType: string }) =>
      `音频叙述式分析 (${input.dataUrl.slice(0, 20)}...)`,
    ),
  } as unknown as MediaService
  const agent = new MediaAgent(media as MediaService, {
    baseUrl: 'http://127.0.0.1:3000',
    artifactPath: '/a2a/artifacts',
  })
  return { agent, media }
}

async function sendMessage(agent: MediaAgent, parts: any[], opts: { taskId?: string; contextId?: string; messageId?: string; referenceTaskIds?: string[] } = {}) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'SendMessage',
    params: {
      message: {
        messageId: opts.messageId || `msg-${Math.random().toString(36).slice(2)}`,
        role: 1, // ROLE_USER
        parts,
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
        ...(opts.contextId ? { contextId: opts.contextId } : {}),
        ...(opts.referenceTaskIds ? { referenceTaskIds: opts.referenceTaskIds } : {}),
      },
    },
  }
  const res = await agent.handleJsonRpc(body, { 'a2a-version': '1.0' })
  expect(res.status).toBe(200)
  const parsed = JSON.parse(res.body)
  expect(parsed.error).toBeUndefined()
  return parsed.result.task
}

describe('MediaAgent', () => {
  it('creates a task from a raw image part and returns a completed task with the description', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: PNG_1PX.toString('base64'), mediaType: 'image/png', filename: 'shot.png' },
      { text: '这张图里有什么？' },
    ])
    expect(task.id).toBeDefined()
    expect(task.status.state).toBe('TASK_STATE_COMPLETED')
    const answer = task.history.at(-1)
    expect(answer.role).toBe('ROLE_AGENT')
    expect(answer.parts[0].text).toContain('描述了媒体')
    // artifact exposed with url reference
    expect(task.artifacts[0].parts[0].url).toMatch(/\/a2a\/artifacts\//)
  })

  it('accepts video parts and routes them to analyze with kind=video', async () => {
    const kinds: string[] = []
    const { agent, media } = makeAgent(async (input) => {
      kinds.push(input.kind)
      return `视频分析结果 (${input.mediaType})`
    })
    const task = await sendMessage(agent, [
      { raw: Buffer.from('fake-mp4').toString('base64'), mediaType: 'video/mp4', filename: 'clip.mp4' },
      { text: '视频里发生了什么？' },
    ])
    expect(task.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task.status.message.parts[0].text).toContain('视频分析结果')
    expect(kinds).toEqual(['video'])
    expect((media.analyze as jest.Mock).mock.calls[0][0].mediaType).toBe('video/mp4')
    expect(task.artifacts[0].parts[0].mediaType).toBe('video/mp4')
  })

  it('audio first turn routes to the narrative analysis (content + emotion trajectory + intent)', async () => {
    const { agent, media } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: Buffer.from('fake-mp3').toString('base64'), mediaType: 'audio/mpeg', filename: 'note.mp3' },
      { text: '音频说了什么？' },
    ])
    expect(task.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task.status.message.parts[0].text).toContain('音频叙述式分析')
    expect(media.analyzeAudioNarrative as jest.Mock).toHaveBeenCalledTimes(1)
    expect((media.analyzeAudioNarrative as jest.Mock).mock.calls[0][0].mediaType).toBe('audio/mpeg')
    expect(media.analyze as jest.Mock).not.toHaveBeenCalled()
  })

  it('audio follow-up turns keep free-form analyze (narrative only for the first turn)', async () => {
    const prompts: string[] = []
    const { agent, media } = makeAgent(async (_media, prompt) => {
      prompts.push(prompt)
      return '追问回答'
    })
    const task1 = await sendMessage(agent, [
      { raw: Buffer.from('fake-mp3').toString('base64'), mediaType: 'audio/mpeg', filename: 'note.mp3' },
      { text: '首轮' },
    ])
    const task2 = await sendMessage(agent, [
      { text: '刚才那段语速具体怎样？' },
    ], {
      contextId: task1.contextId,
      referenceTaskIds: [task1.id],
    })
    expect(task2.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task2.status.message.parts[0].text).toContain('追问回答')
    expect(media.analyzeAudioNarrative as jest.Mock).toHaveBeenCalledTimes(1)
    expect(prompts.join('\n')).toContain('刚才那段语速具体怎样？')
  })

  it('url part first turn stores the artifact so follow-ups reuse the media (desktop artifactId path)', async () => {
    const prompts: string[] = []
    const { agent, media } = makeAgent(async (_media, prompt) => {
      prompts.push(prompt)
      return 'url-part 分析结果'
    })
    const artifactId = agent.putArtifact('data:audio/mpeg;base64,AAAA')
    const task1 = await sendMessage(agent, [
      { url: `/a2a/artifacts/${artifactId}`, mediaType: 'audio/mpeg', filename: 'note.mp3' },
      { text: '首轮' },
    ])
    expect(task1.status.state).toBe('TASK_STATE_COMPLETED')
    // audio 首轮走叙述式分支
    expect(task1.status.message.parts[0].text).toContain('音频叙述式分析')
    // 关键回归：url part 首轮必须挂工件，否则追问轮 mediaFromTask 拿不到媒体
    expect(task1.artifacts?.length).toBeGreaterThan(0)

    const task2 = await sendMessage(agent, [{ text: '追问' }], {
      contextId: task1.contextId,
      referenceTaskIds: [task1.id],
    })
    expect(task2.status.state).toBe('TASK_STATE_COMPLETED')
    // 追问轮复用 mediaFromTask → analyze（自由提问）
    expect(task2.status.message.parts[0].text).toContain('url-part 分析结果')
    expect(media.analyzeAudioNarrative as jest.Mock).toHaveBeenCalledTimes(1)
    expect(media.analyze as jest.Mock).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized video media with an explicit failure', async () => {
    const { agent } = makeAgent()
    const big = Buffer.alloc(51 * 1024 * 1024, 1)
    const task = await sendMessage(agent, [
      { raw: big.toString('base64'), mediaType: 'video/mp4' },
    ])
    expect(task.status.state).toBe('TASK_STATE_FAILED')
    expect(task.status.message.parts[0].text).toContain('失败')
  })

  it('follow-ups reference the prior task (referenceTaskIds), reuse the media and accumulate context', async () => {
    const prompts: string[] = []
    const { agent, media } = makeAgent(async (_media, prompt) => {
      prompts.push(prompt)
      return '回答'
    })
    const task1 = await sendMessage(agent, [
      { raw: PNG_1PX.toString('base64'), mediaType: 'image/png' },
      { text: '第一问' },
    ])

    const task2 = await sendMessage(agent, [{ text: '第二问' }], {
      contextId: task1.contextId,
      referenceTaskIds: [task1.id],
    })
    expect(task2.id).not.toBe(task1.id) // each turn is a new task (synchronous model)
    expect(task2.contextId).toBe(task1.contextId)
    expect(task2.status.state).toBe('TASK_STATE_COMPLETED')
    // the follow-up analyze call received the referenced history + the new question
    expect(prompts[1]).toContain('第一问')
    expect(prompts[1]).toContain('第二问')
    // media bytes were only uploaded once (same dataUrl both turns)
    const mediaSends = (media.analyze as jest.Mock).mock.calls
    expect(mediaSends.length).toBe(2)
    expect(mediaSends[0][0].dataUrl).toBe(mediaSends[1][0].dataUrl)
  })

  it('a text-only first message fails with an explicit error task', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [{ text: '只有文本' }])
    expect(task.status.state).toBe('TASK_STATE_FAILED')
    expect(task.status.message.parts[0].text).toContain('失败')
  })

  it('a non-media type is rejected with an explicit failure', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: Buffer.from('hello').toString('base64'), mediaType: 'text/plain' },
    ])
    expect(task.status.state).toBe('TASK_STATE_FAILED')
    expect(task.status.message.parts[0].text).toContain('失败')
  })

  it('tasks/get returns the task directly', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: PNG_1PX.toString('base64'), mediaType: 'image/png' },
    ])
    const res = await agent.handleJsonRpc({
      jsonrpc: '2.0', id: 2, method: 'GetTask', params: { id: task.id },
    }, { 'a2a-version': '1.0' })
    const parsed = JSON.parse(res.body)
    expect(parsed.result.id).toBe(task.id)
    expect(parsed.result.status.state).toBe('TASK_STATE_COMPLETED')
  })

  it('tasks/get for an unknown task returns TaskNotFound error', async () => {
    const { agent } = makeAgent()
    const res = await agent.handleJsonRpc({
      jsonrpc: '2.0', id: 3, method: 'GetTask', params: { id: 'missing-task' },
    }, { 'a2a-version': '1.0' })
    const parsed = JSON.parse(res.body)
    expect(parsed.error).toBeDefined()
    expect(JSON.stringify(parsed.error)).toContain('TASK_NOT_FOUND')
  })

  it('tasks/cancel on a completed task is rejected as TaskNotCancelable (terminal semantics)', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: PNG_1PX.toString('base64'), mediaType: 'image/png' },
    ])
    const res = await agent.handleJsonRpc({
      jsonrpc: '2.0', id: 4, method: 'CancelTask', params: { id: task.id },
    }, { 'a2a-version': '1.0' })
    const parsed = JSON.parse(res.body)
    expect(parsed.error).toBeDefined()
    expect(JSON.stringify(parsed.error)).toContain('TASK_NOT_CANCELABLE')
  })

  it('tasks/list returns completed tasks', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [{ raw: PNG_1PX.toString('base64'), mediaType: 'image/png' }])
    expect(task.status.state).toBe('TASK_STATE_COMPLETED')
    const res = await agent.handleJsonRpc({
      jsonrpc: '2.0', id: 5, method: 'ListTasks', params: { status: 'TASK_STATE_COMPLETED' },
    }, { 'a2a-version': '1.0' })
    const parsed = JSON.parse(res.body)
    expect(parsed.result.tasks.length).toBeGreaterThanOrEqual(1)
  })

  it('sending to a completed task is rejected (no silent re-execution)', async () => {
    const { agent, media } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: PNG_1PX.toString('base64'), mediaType: 'image/png' },
      { text: '问' },
    ], { messageId: 'idem-1' })
    const before = (media.analyze as jest.Mock).mock.calls.length

    const res = await agent.handleJsonRpc({
      jsonrpc: '2.0', id: 6, method: 'SendMessage',
      params: { message: { messageId: 'idem-1', role: 1, taskId: task.id, parts: [{ text: '问' }] } },
    }, { 'a2a-version': '1.0' })
    const parsed = JSON.parse(res.body)
    expect(parsed.error).toBeDefined() // terminal state — rejected by the protocol
    expect((media.analyze as jest.Mock).mock.calls.length).toBe(before)
  })

  it('two concurrent media create independent tasks', async () => {
    const { agent } = makeAgent()
    const [t1, t2] = await Promise.all([
      sendMessage(agent, [{ raw: PNG_1PX.toString('base64'), mediaType: 'image/png' }, { text: '图一' }]),
      sendMessage(agent, [{ raw: PNG_1PX.toString('base64'), mediaType: 'image/png' }, { text: '图二' }]),
    ])
    expect(t1.id).not.toBe(t2.id)
    expect(t1.status.state).toBe('TASK_STATE_COMPLETED')
    expect(t2.status.state).toBe('TASK_STATE_COMPLETED')
  })

  it('an artifact can be downloaded after task creation', async () => {
    const { agent } = makeAgent()
    const task = await sendMessage(agent, [
      { raw: PNG_1PX.toString('base64'), mediaType: 'image/png', filename: 'shot.png' },
    ])
    const url = task.artifacts[0].parts[0].url
    const id = url.split('/').pop()
    const artifact = agent.getArtifact(id)
    expect(artifact).toBeDefined()
    expect(artifact!.dataUrl).toContain('data:image/png;base64,')
    expect(artifact!.mediaType).toBe('image/png')
    // unknown artifact -> undefined
    expect(agent.getArtifact('nope')).toBeUndefined()
  })

  it('agent card declares the media skill and all four input modes', async () => {
    const { agent } = makeAgent()
    const card = agent.agentCard
    expect(card.name).toContain('MediaAgent')
    expect(card.skills[0].id).toBe('media_analyze')
    expect(card.skills[0].inputModes).toEqual(['text', 'image', 'video', 'audio'])
    expect(card.skills[0].outputModes).toContain('text')
    expect(card.defaultInputModes).toEqual(['text', 'image', 'video', 'audio'])
  })
})
