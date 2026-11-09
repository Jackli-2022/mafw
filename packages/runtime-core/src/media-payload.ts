/**
 * Provider wire-format fixer shared by the pi adapter and the gateway media
 * adapter. Derived from pi-multimodal-proxy's fixVideoAudioPayload (MIT); the
 * audio branch was changed to input_audio per the Xiaomi MiMo API docs.
 *
 * video/* -> { type:'video_url', video_url:{url} }
 * audio/* -> { type:'input_audio', input_audio:{data:url} }
 */
export function fixMediaPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const messages = p.messages;
  if (!Array.isArray(messages)) return undefined;
  let modified = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;
    const content = m.content;
    if (!Array.isArray(content)) continue;
    for (let i = 0; i < content.length; i++) {
      const block = content[i];
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'image_url' && b.image_url && typeof b.image_url === 'object') {
        const iu = b.image_url as Record<string, unknown>;
        const url = iu.url;
        if (typeof url === 'string' && url.startsWith('data:')) {
          const mimeMatch = url.match(/^data:([^;]+);/);
          if (mimeMatch) {
            const mime = mimeMatch[1]!.toLowerCase();
            if (mime.startsWith('video/')) {
              content[i] = { type: 'video_url', video_url: { url } };
              modified = true;
            } else if (mime.startsWith('audio/')) {
              content[i] = { type: 'input_audio', input_audio: { data: url } };
              modified = true;
            }
          }
        }
      }
    }
  }
  return modified ? p : undefined;
}
