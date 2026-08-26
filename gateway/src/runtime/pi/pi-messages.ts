export function translatePiMessages(messages: any[], sessionID: string): any[] {
  return messages.map((m, i) => ({
    id: `pimsg_${sessionID}_${i}`,
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: (m?.content || [])
      .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
      .map((c: any) => ({ type: 'text', text: c.text })),
    sessionID,
    time: { created: m?.timestamp ?? Date.now(), updated: m?.timestamp ?? Date.now() },
  }));
}

export function piMessagesToParts(messages: any[]): any[] {
  return (messages || [])
    .flatMap((m: any) => (m?.content || []).filter((c: any) => c?.type === 'text' && typeof c?.text === 'string'))
    .map((c: any) => ({ type: 'text', text: c.text }));
}