import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { makeMediaPointer } from '../hooks/media-ingest';

/**
 * mafw_media_upload — 上传本地图片/视频/音频到 Media Agent（建任务），返回
 * 指针文本。
 *
 * 推理 Agent 在用户给出本地媒体文件路径（或自己截的图/录的音）时主动调用，
 * 之后用返回的 taskID 通过 mafw_media_ask 多轮追问。走标准 A2A SendMessage。
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const A2A_URL = `http://127.0.0.1:${GATEWAY_PORT}/a2a`;

export const MEDIA_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
};

// 与 gateway MediaAgent 的大小上限对齐（base64 ≈ bytes × 1.33）
const MAX_BYTES: Record<string, number> = {
  'image/': 20 * 1024 * 1024,
  'video/': 50 * 1024 * 1024,
  'audio/': 25 * 1024 * 1024,
};

export interface MediaUploadTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: { mediaPath: string; question?: string }, ctx: { abort: AbortSignal }) => Promise<unknown>;
}

export const mediaUploadTool: MediaUploadTool = {
  description:
    '上传一个本地图片/视频/音频文件到 Media Agent 并返回引用指针。当用户给出本地媒体文件路径（图片、视频、音频）时调用此工具，' +
    '之后可用返回的 taskID 通过 mafw_media_ask 对该媒体多轮追问。' +
    '参数：mediaPath — 本地媒体文件的绝对路径（图片 png/jpg/jpeg/gif/webp/bmp；视频 mp4/webm/mov/mkv/ogg；音频 mp3/wav/m4a/flac/aac/opus）；question — 可选的首个问题。' +
    '返回：Media Agent 任务引用（含 taskID），以及首个问题的回答（若有）。',
  args: {
    mediaPath: z.string().describe('本地媒体文件绝对路径（图片/视频/音频）'),
    question: z.string().optional().describe('可选的首个问题'),
  },
  async execute({ mediaPath, question }, ctx) {
    const signal = AbortSignal.any([ctx.abort, AbortSignal.timeout(60_000)]);
    try {
      const path = mediaPath.startsWith('file://') ? mediaPath.slice('file://'.length) : mediaPath;
      const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
      const mediaType = MEDIA_EXT_MIME[ext];
      if (!mediaType) {
        return {
          title: '上传失败',
          output: `不支持的媒体格式：${ext || '(无扩展名)'}（支持 png/jpg/jpeg/gif/webp/bmp / mp4/webm/mov/mkv/ogg / mp3/wav/m4a/flac/aac/opus）`,
          metadata: { mediaPath },
        };
      }
      const bytes = fs.readFileSync(path);
      const kindPrefix = mediaType.split('/')[0] + '/';
      const max = MAX_BYTES[kindPrefix] ?? Infinity;
      if (bytes.length > max) {
        return {
          title: '上传失败',
          output: `媒体过大：${(bytes.length / (1024 * 1024)).toFixed(1)}MB 超过上限 ${(max / (1024 * 1024)).toFixed(0)}MB（${mediaType}）`,
          metadata: { mediaPath },
        };
      }
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'SendMessage',
        params: {
          message: {
            messageId: `upload-${randomUUID()}`,
            role: 1, // ROLE_USER
            parts: [
              { raw: bytes.toString('base64'), mediaType, filename: path.split(/[\\/]/).pop() || 'media.bin' },
              ...(question ? [{ text: question }] : []),
            ],
          },
        },
      };
      const res = await fetch(A2A_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
      const parsed: any = await res.json();
      if (parsed?.error) throw new Error(parsed.error?.message || JSON.stringify(parsed.error));
      const task = parsed?.result?.task;
      if (!task?.id) throw new Error('gateway 未返回任务');

      const state = task?.status?.state;
      const answer = (task?.status?.message?.parts ?? [])
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim();
      if (state === 'TASK_STATE_FAILED') {
        return {
          title: 'Media Agent 分析失败',
          output: answer || 'Media Agent 分析失败，请稍后重试。',
          metadata: { mediaPath, taskID: task.id },
        };
      }

      const pointer = makeMediaPointer(task.id, task.contextId, path.split(/[\\/]/).pop() || 'media.bin');
      const extra = answer ? `\n首个问题回答：${answer}` : '';
      return {
        title: '媒体已上传',
        output: `${pointer}${extra}`,
        metadata: { mediaPath, taskID: task.id, contextID: task.contextId },
      };
    } catch (err) {
      return {
        title: '上传失败',
        output: `媒体上传失败：${(err as Error).message}`,
        metadata: { mediaPath },
      };
    }
  },
};
