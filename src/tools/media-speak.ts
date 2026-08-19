import { z } from 'zod';

/**
 * mafw_media_speak — 文本转语音（MiMo-V2.5-TTS，预置音色）。
 *
 * 主 Agent 需要以语音形式回复时调用本工具。gateway 调用小米 TTS 合成 wav，
 * 存入 artifact 并返回引用标记。工具返回 `[语音回复 art:<id> 音色:<voice>]`，
 * 主 Agent 必须把该标记**原样**包含在回复文本中，桌面端据此渲染音频播放器。
 *
 * 音色（预置）：冰糖 / 茉莉 / 苏打 / 白桦 / Mia / Chloe / Milo / Dean。
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const TTS_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/tts`;

/** djb2 hash（与桌面端 ChatPane.hashText 同实现）：标记携带文本指纹，前端据此去重（流式已播过则不重复播 artifact）。 */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export interface MediaSpeakTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: { text: string; voice?: string; style?: string }, ctx: { abort: AbortSignal }) => Promise<unknown>;
}

export const mediaSpeakTool: MediaSpeakTool = {
  description:
    '将文本合成为语音（MiMo-V2.5-TTS 预置音色）。当你需要以语音形式回复用户时调用——' +
    '尤其是用户通过语音消息输入（消息含音频媒体附件指针）时，你必须调用本工具以语音形式回复。' +
    '参数：text — 要合成的文本（不超过 2000 字符）；voice — 音色（可选，预置：冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean，默认茉莉）；' +
    'style — 发音风格指令（可选，如"轻快上扬的语调"）。' +
    'text 支持音频标签精细控制（无需额外参数）：开头加 (风格) 指定整体风格（如 (慵懒)/(磁性)/(东北话)/(粤语)/(唱歌)歌词），' +
    '文中可插入 [标签]（如 [笑]/[叹气]/[低语]/[语速加快]）做细粒度调节。' +
    '返回：[语音回复 art:<id> 音色:<voice> h:<hash>] 标记。你必须在回复文本中原样包含该标记，桌面端会据此自动播放语音（h 为文本指纹，桌面端用于流式去重，原样保留即可）。',
  args: {
    text: z.string().describe('要合成的文本（≤2000 字符）'),
    voice: z.string().optional().describe('预置音色：冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean（默认茉莉）'),
    style: z.string().optional().describe('发音风格指令（可选，如"轻快上扬的语调，语速稍快"）'),
  },
  async execute({ text, voice, style }, ctx) {
    const signal = AbortSignal.any([ctx.abort, AbortSignal.timeout(130_000)]);
    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, style }),
        signal,
      });
      if (!res.ok) {
        let detail = '';
        try { const j: any = await res.json(); detail = j?.error || ''; } catch { /* ignore */ }
        return {
          title: '语音合成失败',
          output: `语音合成失败：HTTP ${res.status}${detail ? `（${detail}）` : ''}`,
          metadata: {},
        };
      }
      const j: any = await res.json();
      if (!j?.artifactId) {
        return { title: '语音合成失败', output: '语音合成未返回音频引用。', metadata: {} };
      }
      return {
        title: '语音已生成',
        output: `[语音回复 art:${j.artifactId} 音色:${j.voice || voice || '默认'} h:${hashText(text)}]`,
        metadata: { artifactId: j.artifactId, voice: j.voice || voice, url: j.url },
      };
    } catch (err) {
      return {
        title: '语音合成不可用',
        output: `语音合成调用失败：${(err as Error).message}（请稍后重试）`,
        metadata: {},
      };
    }
  },
};
