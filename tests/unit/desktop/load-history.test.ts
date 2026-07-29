/**
 * Reproduce the SessionTurn rendering bug:
 * Binary.search requires messages sorted by ID, but loadSessionHistory
 * stored messages in API order (chronological, not by ID).
 *
 * When messages[userMsgId] fell on an assistant message due to wrong
 * binary search index, SessionTurn.messageIndex returned -1 → blank render.
 */

function makeMsg(id: string, role: 'user' | 'assistant', text?: string, parentID?: string) {
  return { id, sessionID: 'ses_test', role, parentID: parentID || null, time: { created: Date.now() }, text: text || '' }
}

function binarySearch<T>(arr: T[], key: string, fn: (item: T) => string): { found: boolean; index: number } {
  let lo = 0
  let hi = arr.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const midKey = fn(arr[mid])
    if (midKey === key) return { found: true, index: mid }
    if (midKey < key) lo = mid + 1
    else hi = mid - 1
  }
  return { found: false, index: lo }
}

describe('SessionTurn messageIndex reproduction', () => {
  const USER_ID = 'msg_user_a'

  // Simulate API response: 100 messages, chronologically ordered (not by ID)
  let rawMessages: any[]
  let userMessage: any

  beforeAll(() => {
    rawMessages = []
    // User message (not first in array)
    userMessage = makeMsg(USER_ID, 'user', 'Hello, I need help with X')
    userMessage.role = 'user'
    rawMessages.push(userMessage)
    // 10 assistant messages with IDs that sort AFTER the user ID
    for (let i = 0; i < 10; i++) {
      rawMessages.push(makeMsg(`msg_z_assist_${i}`, 'assistant', '', userMessage.id))
    }
    // 89 more messages with IDs that sort BEFORE the user ID (chronologically older)
    for (let i = 0; i < 89; i++) {
      rawMessages.unshift(makeMsg(`msg_old_${String(i).padStart(3, '0')}`, 'user', `Old question ${i}`))
    }
    // rawMessages is now: [89 old messages sorted by msg_old_*, msg_user_a, 10 msg_z_assist_*]
    // This simulates what the opencode server returns: chronologically ordered
  })

  it('raw messages are not sorted by ID (reproduces the environment)', () => {
    const ids = rawMessages.map(m => m.id)
    const sorted = [...ids].sort()
    expect(ids).not.toEqual(sorted) // confirm unsorted
  })

  it('sorted by ID guarantees Binary.search finds the right user message role', () => {
    const sorted = [...rawMessages].sort((a, b) => a.id.localeCompare(b.id))
    const result = binarySearch(sorted, USER_ID, (m: any) => m.id)
    expect(result.found).toBe(true)
    expect(sorted[result.index].role).toBe('user')
  })

  it('findIndex (SessionTurn fallback) works on any order', () => {
    const index = rawMessages.findIndex((m: any) => m.id === USER_ID)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(rawMessages[index].role).toBe('user')
  })

  it('loadSessionHistory transformation sets userMsgId that SessionTurn can find', () => {
    // Step 1: transform (same as loadSessionHistory)
    const msgs: any[] = rawMessages.map((item: any) => ({
      id: item.id,
      sessionID: 'ses_test',
      role: item.role,
      parentID: item.parentID || null,
      time: item.time,
      text: item.text,
    }))
    msgs.sort((a, b) => a.id.localeCompare(b.id))

    // Step 2: find userMsgId (first user message)
    const userMsg = msgs.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    const userMsgId = userMsg!.id

    // Step 3: Binary.search the sorted messages
    const result = binarySearch(msgs, userMsgId, (m: any) => m.id)
    expect(result.found).toBe(true)

    const found = msgs[result.index]
    expect(found.role).toBe('user') // ✅ role must be "user" for SessionTurn
    expect(found.id).toBe(userMsgId) // ✅ same message
  })
})

describe('UserMessageDisplay text part reproduction', () => {
  it('user message text is converted to a text part for UserMessageDisplay', () => {
    const textContent = 'Hello world'
    const rawItem: any = { id: 'msg_test', role: 'user', text: textContent }

    // Transform: same logic as loadSessionHistory
    const msgId = rawItem.id
    let itemParts: any[] = rawItem.parts || []
    if (textContent && !itemParts.some((p: any) => p.type === 'text')) {
      itemParts = [{ type: 'text', text: textContent, id: `${msgId}-text`, messageID: msgId }, ...itemParts]
    }

    expect(itemParts.length).toBeGreaterThan(0)
    const textPart = itemParts.find((p: any) => p.type === 'text')
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe('Hello world')
  })

  it('messages without text field produce empty parts (no crash)', () => {
    const rawItem: any = { id: 'msg_test', role: 'user' } // no text field
    const msgId = rawItem.id
    let itemParts: any[] = rawItem.parts || []
    const textContent = (rawItem as any).text || (rawItem as any).textContent || ''
    if (textContent && !itemParts.some((p: any) => p.type === 'text')) {
      itemParts = [{ type: 'text', text: textContent, id: `${msgId}-text`, messageID: msgId }, ...itemParts]
    }

    // UserMessageDisplay reads from parts. Empty parts = no visible text.
    const textPart = itemParts.find((p: any) => p.type === 'text')
    expect(textPart).toBeUndefined()
  })
})
