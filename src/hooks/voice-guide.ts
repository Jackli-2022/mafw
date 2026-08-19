import { isMediaPointerPart } from './media-ingest';

/**
 * voice-guide — 语音输入 → 引导主 Agent 以语音回复（调用 mafw_media_speak）。
 *
 * 场景：用户用语音消息（桌面录音 / 标准 opencode 粘贴音频）提问时，agent 看到的是
 * 音频媒体指针或 audio file part，但没有任何提示告诉它"用户在用语音，请用语音回复"。
 * 本 hook 在语音输入轮给 system 上下文注入 <voice-guide> 引导，稳定 agent 决策。
 *
 * 实现：
 *  - voiceGuideMessagesHook（experimental.chat.messages.transform）：
 *    检测当前轮 user 消息是否含音频 → 会话级状态置位；纯文本消息清除。
 *  - voiceGuideSystemHook（experimental.chat.system.transform）：
 *    状态命中 → output.system.push 引导块（memory-guide 同款注入路径）。
 *  - 时序容错：messages/system transform 顺序无保证，状态延迟一轮也持续注入
 *    （引导对该会话后续轮次仍有效，直到出现纯文本消息）。
 */

const AUDIO_EXT_RE = /\.(wav|mp3|m4a|ogg|flac|opus|aac|wma)(\s*[)\]），]|$)/i;

/** 会话级语音输入状态：sessionID → 最近语音输入时间戳（ms）。 */
const voiceSessionMap = new Map<string, number>();

/** 语音引导状态有效期（ms）：状态存活期间 system 注入持续生效。 */
const VOICE_STATE_TTL_MS = 10 * 60 * 1000;

const GUIDE_HEADER = '<voice-guide>';
const GUIDE_FOOTER = '</voice-guide>';

const GUIDE_BODY = `## 语音对话
用户正在通过语音消息与你对话（语音输入）。媒体附件中的音频就是用户发给你的消息内容：
调用 mafw_media_ask 工具获取其内容后，把它当作用户的直接输入来回应（就像用户打字给你一样），
不要在回复中复述/重复语音内容（除非用户明确要求）。
同时请以语音形式回复：调用 mafw_media_speak 工具（text=你的回复内容，voice 可按需选择），
并把返回的 [语音回复 art:...] 标记原样包含在回复文本中。`;

export function buildVoiceGuide(): string {
  return `${GUIDE_HEADER}\n${GUIDE_BODY}\n${GUIDE_FOOTER}`;
}

/** 判断 user 消息是否含音频媒体（media part mime audio/* 或音频指针/文件名）。 */
export function messageHasAudio(msg: any): boolean {
  const parts: any[] = Array.isArray(msg?.parts) ? msg.parts : [];
  for (const part of parts) {
    const mime: string = part?.mediaType || part?.mime || '';
    if (typeof mime === 'string' && mime.startsWith('audio/')) return true;
    if (isMediaPointerPart(part)) {
      const text: string = part?.text || '';
      const nameMatch = text.match(/媒体:\s*([^）\]]+)/);
      const name = nameMatch ? nameMatch[1] : '';
      if (AUDIO_EXT_RE.test(name)) return true;
    }
  }
  return false;
}

/** messages.transform：更新会话语音输入状态。 */
export function voiceGuideMessagesHook(input: any, output: any): any {
  const messages: any[] = Array.isArray(output?.messages) ? output.messages : [];
  let sessionID: string | undefined = input?.sessionID;
  let hasVoice = false;
  let hasText = false;
  for (const msg of messages) {
    if (msg?.role !== 'user' && msg?.info?.role !== 'user') continue;
    if (!sessionID) sessionID = msg?.sessionID || msg?.info?.sessionID;
    if (messageHasAudio(msg)) hasVoice = true;
    const parts: any[] = Array.isArray(msg?.parts) ? msg.parts : [];
    if (parts.some((p) => typeof p?.text === 'string' && !isMediaPointerPart(p))) hasText = true;
  }
  if (!sessionID) return output;
  if (hasVoice) {
    voiceSessionMap.set(sessionID, Date.now());
  } else if (hasText) {
    voiceSessionMap.delete(sessionID);
  }
  return output;
}

/** system.transform：语音输入会话注入引导块。 */
export function voiceGuideSystemHook(input: any, output: any): any {
  const sessionID: string | undefined = input?.sessionID;
  if (!sessionID) return output;
  const at = voiceSessionMap.get(sessionID);
  if (at === undefined || Date.now() - at > VOICE_STATE_TTL_MS) {
    if (at !== undefined) voiceSessionMap.delete(sessionID);
    return output;
  }
  if (!Array.isArray(output?.system)) output.system = [];
  if (!output.system.some((s: any) => typeof s === 'string' && s.includes(GUIDE_HEADER))) {
    output.system.push(buildVoiceGuide());
  }
  return output;
}
