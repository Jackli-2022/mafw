import * as fs from 'fs';
import * as path from 'path';

/**
 * Eval chat completion endpoint — OpenAI-compatible adapter used by EvalScope
 * to evaluate the main agent's A2A multimodal chain.
 *
 * EvalScope drives General-VQA style datasets (text + image_url /
 * input_audio / video_url) against an OpenAI chat completion endpoint. This
 * handler translates that request into a full main-agent run:
 *
 *   media parts → opencode session file parts
 *   → promptAsync with the configured main-agent model (e.g.
 *     opencode-go/deepseek-v4-flash, a text-only model)
 *   → the agent ingests the media (media-ingest → task → pointer), calls
 *     mafw_media_ask (A2A → MediaAgent → pi → multimodal model), and answers
 *   → poll session messages until the assistant answer stabilizes, return
 *     the final text as an OpenAI chat completion.
 *
 * This exercises the real end-to-end chain: text-only main agent + A2A
 * multimodal tool + MediaAgent (xiaomi/mimo-v2.5 via pi adapter).
 */

export interface EvalEndpointOptions {
  opencodeClient: any;
  directory?: string;
  /** Main agent model. */
  providerID: string;
  modelID: string;
  timeoutMs?: number;
  pollMs?: number;
}

interface MediaPart {
  mime: string;
  dataUrl: string;
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};

/** Normalize an EvalScope media reference to a data URL. */
function mediaToDataUrl(part: Record<string, any>): MediaPart | null {
  const container = part.image_url || part.video_url;
  const raw = container ? container.url : part.input_audio?.data;
  if (typeof raw !== 'string' || !raw) return null;

  if (raw.startsWith('data:')) {
    const mime = raw.match(/^data:([^;]+);/)?.[1] || 'image/png';
    return { mime, dataUrl: raw };
  }

  // EvalScope 对音频经 data_uri_to_base64 剥掉了 data: 前缀，发来纯 base64
  // （路径/URL 必含 . / \ : 等字符，纯 base64 不含，可安全区分）
  if (!raw.startsWith('file://') && /^[A-Za-z0-9+/=]+$/.test(raw)) {
    const fmt = part.input_audio?.format as string | undefined;
    const mime = part.mimeType
      || (fmt === 'mp3' ? 'audio/mpeg' : fmt ? `audio/${fmt}` : 'audio/wav');
    return { mime, dataUrl: `data:${mime};base64,${raw}` };
  }

  // local path (EvalScope may pass dataset media as file paths)
  const p = raw.startsWith('file://') ? raw.slice('file://'.length) : raw;
  try {
    const bytes = fs.readFileSync(p);
    let mime = part.mimeType as string | undefined;
    if (!mime) mime = EXT_MIME[path.extname(p).toLowerCase()];
    if (!mime && part.input_audio?.format === 'mp3') mime = 'audio/mpeg';
    if (!mime) mime = 'application/octet-stream';
    return { mime, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  } catch {
    return null;
  }
}

function extractText(content: string | Array<Record<string, any>>): { text: string; media: MediaPart[] } {
  if (typeof content === 'string') return { text: content, media: [] };
  const text: string[] = [];
  const media: MediaPart[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') text.push(part.text);
    else if (part.type === 'image_url' || part.type === 'input_audio' || part.type === 'video_url') {
      const m = mediaToDataUrl(part);
      if (m) media.push(m);
    }
  }
  return { text: text.join('\n').trim(), media };
}

function assistantText(messages: Array<{ info: any; parts: any[] }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.info?.role !== 'assistant') continue;
    const text = (msg.parts || [])
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

function completion(model: string, sessionId: string, answer: string) {
  return {
    id: `eval-${sessionId}`,
    object: 'chat.completion',
    model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: answer || '' } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function handleEvalChatCompletion(opts: EvalEndpointOptions) {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 2_000;

  return async (reqBody: unknown): Promise<{ status: number; body: any }> => {
    let sessionId: string | null = null;
    try {
      const req = reqBody as { model?: string; messages?: Array<{ role: string; content: any }> };
      const model = req?.model || `${opts.providerID}/${opts.modelID}`;
      const userMsg = [...(req?.messages ?? [])].reverse().find((m) => m?.role === 'user');
      if (!userMsg) {
        return { status: 400, body: { error: { message: 'eval chat requires a user message' } } };
      }
      const { text, media } = extractText(userMsg.content);
      if (!text && media.length === 0) {
        return { status: 400, body: { error: { message: 'eval chat requires text or media content' } } };
      }

      const parts: Array<Record<string, any>> = [];
      if (text) parts.push({ type: 'text', text });
      for (const m of media) {
        const ext = (m.mime.split('/')[1] || 'bin').split(';')[0].split('+')[0];
        parts.push({ type: 'file', mime: m.mime, filename: `media.${ext}`, url: m.dataUrl });
      }

      // 行为约束注入：媒体指针存在时必须先调用 mafw_media_ask；
      // 音频（ASR）任务要求纯转写，不加前缀/引号。
      const systemHints: string[] = [];
      if (media.length > 0) {
        systemHints.push(
          '消息可能包含 [媒体附件 taskID: ...] 指针。若存在，你必须先调用 mafw_media_ask 工具查看媒体内容，再基于其结果回答。'
        );
      }
      if (media.some((m) => m.mime.startsWith('audio/'))) {
        systemHints.push('语音识别任务：仅输出识别到的语音内容本身，不要添加任何前缀、引号、标点或说明。');
      }

      // 1. fresh session for isolation
      const session = await opts.opencodeClient.session.create({ query: { directory: opts.directory || '.' } });
      sessionId = session.data?.id ?? session.id;
      if (!sessionId) throw new Error('Failed to create eval session');

      // 2. prompt the main agent (full agent loop: ingest → tool → answer)
      try {
        await opts.opencodeClient.session.promptAsync({
          path: { id: sessionId },
          body: {
            parts,
            model: { providerID: opts.providerID, modelID: opts.modelID },
            ...(systemHints.length ? { system: systemHints.join('\n') } : {}),
          },
        });
      } catch (err: any) {
        return { status: 502, body: { error: { message: `eval prompt failed: ${err?.message || String(err)}` } } };
      }

      // 3. poll until the assistant answer stabilizes (agent settled) or timeout
      let lastText = '';
      let stableRounds = 0;
      const deadline = Date.now() + timeoutMs;
      let answer = '';

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollMs));
        let messages: Array<{ info: any; parts: any[] }> = [];
        try {
          const res = await opts.opencodeClient.session.messages({ path: { id: sessionId } });
          messages = res.data ?? res ?? [];
        } catch {
          /* keep polling */
        }
        const current = assistantText(messages);
        if (current && current === lastText) {
          stableRounds++;
          if (stableRounds >= 2) { answer = current; break; }
        } else if (current) {
          lastText = current;
          stableRounds = 0;
        }
      }
      if (!answer) answer = lastText;

      // ASR 场景确定性清理：多模态模型/agent 可能带"识别结果："等包装语，
      // system 提示是软约束，这里做硬清理（避免计入 WER）。
      if (media.some((m) => m.mime.startsWith('audio/'))) {
        answer = answer.replace(/^\s*(?:识别结果|转写结果|语音内容|识别到的语音内容|ASR|识别)[：:]\s*/i, '').trim();
        answer = answer.replace(/^["'「『]\s*|\s*[""'」』]$/g, '').trim();
      }

      return { status: 200, body: completion(model, sessionId, answer) };
    } catch (err: any) {
      return { status: 500, body: { error: { message: `eval chat error: ${err?.message || String(err)}` } } };
    } finally {
      if (sessionId) {
        await opts.opencodeClient.session.delete({ path: { id: sessionId } }).catch(() => {});
      }
    }
  };
}
