import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'node:url';

/**
 * media-ingest — 标准 opencode 下的图片/视频/音频入口（仅建任务 + 指针，
 * 无描述、无转发）。
 *
 * 桌面端（MafwShell）发媒体时只发文本指针，不产生 media part；而标准
 * opencode TUI/CLI 粘贴图片/视频/音频会以 file part 进入消息流。本 hook 在
 * experimental.chat.messages.transform 中检测这些 media part：
 *
 *   ① 提取媒体数据（data URL 直接用 / 本地路径读文件 → base64）
 *   ② 调 gateway /a2a SendMessage 建任务（用户消息文本作 focus hint）
 *   ③ 把该 part 替换为文本指针（taskID/contextID/媒体名）
 *
 * 之后由推理 Agent（LLM）自主决定调用 mafw_media_ask 追问 —— 本 hook 不产生
 * 描述、不转发用户消息。失败时替换为显式提示（含原因），不阻塞 LLM。
 *
 * 幂等：已是 [媒体附件 或旧 [视觉附件 开头的指针 part 不再处理。
 * MEDIA_INGEST=off（兼容 VISION_INGEST=off）可关。
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const A2A_URL = `http://127.0.0.1:${GATEWAY_PORT}/a2a`;

const POINTER_PREFIX = '[媒体附件';
const LEGACY_POINTER_PREFIX = '[视觉附件';

export function makeMediaPointer(taskId: string, contextId: string, mediaName: string): string {
  return `${POINTER_PREFIX} taskID: ${taskId} contextID: ${contextId}（媒体: ${mediaName}），这是用户发给你的媒体消息（图片/视频/音频）——调用 mafw_media_ask 工具获取其内容后直接回应（taskID 填 ${taskId}）]`;
}

/** 兼容旧版指针（mafw_vision 时代），保证旧会话遗留指针幂等。 */
export function makeVisionPointer(taskId: string, contextId: string, mediaName: string): string {
  return makeMediaPointer(taskId, contextId, mediaName);
}

/** 判断一个 part 是否已是媒体指针（幂等，兼容新旧前缀）。 */
export function isMediaPointerPart(part: any): boolean {
  if (typeof part?.text !== 'string') return false;
  return part.text.startsWith(POINTER_PREFIX) || part.text.startsWith(LEGACY_POINTER_PREFIX);
}

/** @deprecated 兼容旧名（isMediaPointerPart 即新实现）。 */
export function isVisionPointerPart(part: any): boolean {
  return isMediaPointerPart(part);
}

interface MediaPartInfo {
  part: any;
  index: number;
  mediaName: string;
  mediaType: string;
  /** data URL 或本地路径（file:// 或裸路径） */
  source: string;
  /** 该 user 消息的文本（focus hint） */
  hint: string;
}

export function isMediaPart(part: any): boolean {
  if (part?.type !== 'file' && part?.type !== 'image') return false;
  const mime = part?.mediaType || part?.mime || '';
  return typeof mime === 'string' &&
    (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/'));
}

/** 读取媒体为 data URL：data: 直通；file:// 经 fileURLToPath（Windows
 *  file:///C:/... 三斜杠 + percent-encoding + 盘符）；裸路径直读；http(s) fetch。 */
export async function mediaDataFromSource(source: string, mediaType: string): Promise<string> {
  if (source.startsWith('data:')) return source;
  if (/^https?:\/\//i.test(source)) {
    return fetchRemoteMedia(source, mediaType);
  }
  const path = source.startsWith('file://') ? fileURLToPath(source) : source;
  const bytes = fs.readFileSync(path);
  return `data:${mediaType || 'image/png'};base64,${bytes.toString('base64')}`;
}

/** @deprecated 兼容旧名。 */
export function imageDataFromSource(source: string, mediaType: string): Promise<string> {
  return mediaDataFromSource(source, mediaType);
}

async function fetchRemoteMedia(url: string, mediaType: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`远程媒体下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || mediaType || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export function messageText(parts: any[]): string {
  return parts
    .filter((p: any) => p?.type === 'text' && typeof p.text === 'string' && !p.synthetic && !isMediaPointerPart(p))
    .map((p: any) => p.text.trim())
    .filter(Boolean)
    .join('\n');
}

async function createTask(dataUrl: string, hint: string): Promise<{ id: string; contextId: string }> {
  const b64 = dataUrl.split(',')[1] || '';
  const mediaType = dataUrl.match(/^data:([^;]+);/)?.[1] || 'application/octet-stream';
  const ext = mediaType.split('/')[1]?.split(';')[0]?.split('+')[0] || 'bin';
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'SendMessage',
    params: {
      message: {
        messageId: `ingest-${randomUUID()}`,
        role: 1, // ROLE_USER
        parts: [
          { raw: b64, mediaType, filename: `paste.${ext}` },
          ...(hint ? [{ text: hint }] : []),
        ],
      },
    },
  };
  const res = await fetch(A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  const parsed: any = await res.json();
  if (parsed?.error) throw new Error(parsed.error?.message || JSON.stringify(parsed.error));
  const task = parsed?.result?.task;
  if (!task?.id) throw new Error('gateway 未返回任务');
  if (task?.status?.state === 'TASK_STATE_FAILED') {
    const parts = task?.status?.message?.parts ?? [];
    const reason = parts.map((p: any) => p?.text || '').join('').trim() || '未知错误';
    throw new Error(reason);
  }
  return { id: task.id, contextId: task.contextId };
}

/** 共享：由 data URL + 提示文本创建 A2A 媒体任务（ingest 与 mafw_media_ask 共用）。 */
export async function createMediaTask(dataUrl: string, hint: string): Promise<{ id: string; contextId: string }> {
  return createTask(dataUrl, hint);
}

/** @deprecated 兼容旧名。 */
export function createVisionTask(dataUrl: string, hint: string): Promise<{ id: string; contextId: string }> {
  return createMediaTask(dataUrl, hint);
}

export async function mediaIngestHook(input: any, output: any): Promise<any> {
  const flag = (process.env.MEDIA_INGEST || process.env.VISION_INGEST || '').toLowerCase();
  if (flag === 'off') return output;
  const messages = output?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return output;

  for (const msg of messages) {
    const isUser = msg?.role === 'user' || msg?.info?.role === 'user';
    if (!isUser) continue;
    const parts: any[] = Array.isArray(msg?.parts) ? msg.parts : [];
    if (parts.length === 0) continue;

    const hint = messageText(parts);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!isMediaPart(part) || isMediaPointerPart(part)) continue;
      const mediaType = part?.mediaType || part?.mime || 'image/png';
      const source: string = typeof part?.url === 'string' ? part.url : '';
      const mediaName: string = part?.filename || '媒体文件';

      try {
        const dataUrl = await mediaDataFromSource(source, mediaType);
        const task = await createTask(dataUrl, hint);
        // 原地替换为文本指针（保留原 part id 以便服务端回显合并）
        const pointer = makeMediaPointer(task.id, task.contextId, mediaName);
        parts[i] = { ...part, type: 'text', text: pointer, url: undefined, mediaType: undefined };
      } catch (err) {
        parts[i] = {
          ...part,
          type: 'text',
          text: `[媒体未送达 Media Agent：${(err as Error).message}]`,
          url: undefined,
          mediaType: undefined,
        };
      }
    }
  }
  return output;
}

/** @deprecated 兼容旧名。 */
export const visionIngestHook = mediaIngestHook;

/**
 * 写库前媒体转引用（chat.message hook 用）：把图片/视频/音频 file part 提前建
 * A2A 任务并替换为文本指针，避免大 base64 写进会话消息导致 SQLite 写库失败，
 * 也避免 transform 每步循环重复建任务（图片每步重复分析的根因）。
 *
 * - 图片/视频/音频统一处理（图片不再走 opencode normalize——主模型是纯文本，
 *   图片从不直接发给主模型，只经 mafw_media_ask 分析）
 * - 幂等：已是指针的 part 跳过
 * - 图片特殊回退：base64 超 MediaAgent 上限（20MB raw ≈ 15MB base64）或建任务
 *   失败时保留 file part——opencode image.normalize 会缩小写库，transform 兜底
 *   下步重试；视频/音频失败 → 错误文本 part（无 normalize 兜底）
 * - fail-open：绝不抛异常（否则整个用户消息发送失败）
 * - 无媒体时快路径直接返回（无 await，不阻塞）
 */
export async function ingestLargeMediaBeforeStore(output: any): Promise<void> {
  const flag = (process.env.MEDIA_INGEST || process.env.VISION_INGEST || '').toLowerCase();
  if (flag === 'off') return;
  try {
    const parts: any[] = Array.isArray(output?.parts) ? output.parts : [];
    if (parts.length === 0) return;
    if (!parts.some((p) => isMediaPart(p) && !isMediaPointerPart(p))) return;

    const hint = messageText(parts);
    await Promise.all(parts.map(async (part, i) => {
      if (!isMediaPart(part) || isMediaPointerPart(part)) return;
      const mediaType = part?.mediaType || part?.mime || '';
      const source: string = typeof part?.url === 'string' ? part.url : '';
      const mediaName: string = part?.filename || '媒体文件';
      const isImage = mediaType.startsWith('image/');
      // 图片超限：保留 file part（normalize 缩小 → transform 兜底重试）
      if (isImage && source.length > 15 * 1024 * 1024) return;
      try {
        const dataUrl = await mediaDataFromSource(source, mediaType);
        const task = await createTask(dataUrl, hint);
        const pointer = makeMediaPointer(task.id, task.contextId, mediaName);
        parts[i] = { ...part, type: 'text', text: pointer, url: undefined, mediaType: undefined };
      } catch (err) {
        if (isImage) return; // 图片失败保留 file part，normalize + transform 兜底可重试
        parts[i] = {
          ...part,
          type: 'text',
          text: `[媒体未送达 Media Agent：${String((err as Error)?.message ?? err).slice(0, 200)}]`,
          url: undefined,
          mediaType: undefined,
        };
      }
    }));
  } catch {
    // 全量兜底：绝不让 hook 异常导致用户消息发送失败。
  }
}
