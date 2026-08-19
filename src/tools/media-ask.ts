import { randomUUID } from 'crypto';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { createMediaTask, mediaDataFromSource } from '../hooks/media-ingest';
import { MEDIA_EXT_MIME } from './media-upload';

/**
 * mafw_media_ask — 推理 Agent（LLM）主动追问 Media Agent 的插件工具。
 *
 * LLM 在推理过程中看到会话里的媒体指针（[媒体附件 taskID: x contextID: y]）
 * 后自主决定调用本工具；工具 handler 作为标准 A2A 客户端，把 LLM 的问题
 * 转成 A2A SendMessage 发给 gateway 的 MediaAgent：
 *
 *   ① GetTask { id: taskID }        → 取 contextId（校验任务存在）
 *   ② SendMessage { contextId,
 *        referenceTaskIds: [taskID],
 *        message: { role: user, parts: [{ text: question }] } }
 *    → Media Agent 基于任务历史（媒体 + 前序问答）返回文字描述
 *   ③ 返回回答 + 新任务 taskID（继续追问用新 ID，媒体不重传）
 *
 * 语义：纯 A2A 协作，无 MCP、无 transform 自动转发 —— 由推理 Agent 主动驱动。
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const A2A_URL = `http://127.0.0.1:${GATEWAY_PORT}/a2a`;

const TIMEOUT_MS = 120_000;

// 已复用过的 taskID（首答复用去重）。Map + 简单 TTL 防无界增长：
// ingest 建任务时 MediaAgent 已用 hint 分析过，首次追问直接复用已有回答。
const reusedTaskIds = new Map<string, number>();
const REUSE_TTL_MS = 24 * 60 * 60 * 1000;
function markReused(taskId: string): void {
  const now = Date.now();
  reusedTaskIds.set(taskId, now);
  for (const [id, ts] of reusedTaskIds) {
    if (now - ts > REUSE_TTL_MS) reusedTaskIds.delete(id);
  }
}
function isReused(taskId: string): boolean {
  const ts = reusedTaskIds.get(taskId);
  return ts !== undefined && Date.now() - ts <= REUSE_TTL_MS;
}

/** 从 GetTask 结果里提取建任务时的 hint（首个 user 消息文本）。 */
function taskHint(task: any): string {
  const history: any[] = task?.task?.history ?? task?.history ?? [];
  for (const h of history) {
    if (h?.role !== 1) continue; // ROLE_USER
    const text = (h?.message?.parts ?? [])
      .filter((p: any) => typeof p?.text === 'string' && p.text.trim())
      .map((p: any) => p.text)
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

/** hint 与 question 语义相近才允许首答复用（避免答非所问）。 */
function hintCoversQuestion(hint: string, question: string): boolean {
  const h = hint.trim().slice(0, 30);
  const q = question.trim().slice(0, 30);
  if (!h || !q) return false;
  return h.includes(q) || q.includes(h);
}

async function a2aRequest(method: string, params: unknown, signal: AbortSignal): Promise<any> {
  const res = await fetch(A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  });
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  const parsed: any = await res.json();
  if (parsed?.error) {
    const reason = parsed.error?.data?.[0]?.reason || '';
    throw new Error(parsed.error?.message || JSON.stringify(parsed.error));
  }
  return parsed?.result;
}

function taskAnswer(task: any): string {
  const parts = task?.status?.message?.parts ?? [];
  return parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

export interface MediaAskTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: { taskID?: string; mediaPath?: string; question: string }, ctx: { abort: AbortSignal }) => Promise<unknown>;
}

export const mediaAskTool: MediaAskTool = {
  description:
    '分析或追问图片/视频/音频。当会话中存在 [媒体附件 taskID: xxx contextID: yyy] 指针时，传 taskID 追问 Media Agent；' +
    '若手头只有媒体文件路径（如历史消息/工具返回里的 file 媒体），传 mediaPath 会自动上传并创建任务后再追问。' +
    '参数：taskID — 从指针中提取的 taskID（与 mediaPath 二选一）；mediaPath — 本地媒体文件绝对路径（与 taskID 二选一）；' +
    'question — 你想问这个媒体的具体问题（如"分析缺陷"、"这段视频里发生了什么"、"音频说了什么"）。' +
    '注意：音频任务的首轮分析已返回自然语言的内容转写 + 情绪/语调轨迹 + 意图描述——' +
    '转写即用户语音消息的内容本身，直接据此理解并回应，不要在回复中复述/重复转写文本；' +
    '返回：Media Agent 的分析结果文本，以及新任务 taskID（继续追问请用新 taskID，媒体不会重新上传）。',
  args: {
    taskID: z.string().optional().describe('从 [媒体附件 taskID: xxx] 指针中提取的 taskID（与 mediaPath 二选一）'),
    mediaPath: z.string().optional().describe('本地媒体文件绝对路径（与 taskID 二选一；传此参数会自动上传媒体并创建任务）'),
    question: z.string().describe('要问这个媒体的具体问题'),
  },
  async execute({ taskID, mediaPath, question }, ctx) {
    const signal = AbortSignal.any([ctx.abort, AbortSignal.timeout(TIMEOUT_MS)]);
    try {
      let activeTaskID = taskID;
      let activeContextId: string | undefined;

      if (activeTaskID) {
        // ① GetTask → contextId（校验任务存在；TaskNotFound 会在此抛出）
        const task = await a2aRequest('GetTask', { id: activeTaskID }, signal);
        activeContextId = task?.task?.contextId ?? task?.contextId;
        if (!activeContextId) {
          const reason = task?.task?.status?.message?.parts?.map((p: any) => p?.text || '').join('') || '';
          return {
            title: 'Media Agent 调用失败',
            output: `任务 ${activeTaskID} 不存在或已被清理，请重新上传媒体。${reason ? `（${reason}）` : ''}`,
            metadata: { taskID: activeTaskID },
          };
        }
        // 首答复用：ingest 建任务时 hint=用户消息已让 MediaAgent 分析过，
        // 首次追问且 question 与 hint 语义相近 → 直接复用已有回答（避免重复分析）
        const state = task?.task?.status?.state ?? task?.status?.state;
        const existing = taskAnswer(task?.task ?? task);
        if (state === 'TASK_STATE_COMPLETED' && existing && !isReused(activeTaskID)) {
          const hint = taskHint(task);
          if (hintCoversQuestion(hint, question)) {
            markReused(activeTaskID);
            return {
              title: 'Media Agent 回答',
              output: existing + '\n（复用 ingest 分析结果；继续追问请再次调用本工具）',
              metadata: { taskID: activeTaskID },
            };
          }
        }
      } else if (mediaPath) {
        // 无 taskID 但有媒体路径：读取媒体 → 建任务（hint = 问题）
        let mediaType: string | undefined;
        if (mediaPath.startsWith('data:')) {
          mediaType = mediaPath.match(/^data:([^;]+);/)?.[1];
        } else {
          // fileURLToPath handles Windows file:///C:/... (triple slash) and
          // percent-encoding; a manual slice would break both.
          const path = mediaPath.startsWith('file://') ? fileURLToPath(mediaPath) : mediaPath;
          const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
          mediaType = MEDIA_EXT_MIME[ext];
        }
        if (!mediaType) {
          return {
            title: 'Media Agent 调用失败',
            output: `不支持的媒体格式：${mediaPath.includes('.') ? mediaPath.slice(mediaPath.lastIndexOf('.')).toLowerCase() : '(data URL 无 mime)'}`,
            metadata: { mediaPath },
          };
        }
        const dataUrl = await mediaDataFromSource(mediaPath, mediaType);
        const created = await createMediaTask(dataUrl, question);
        activeTaskID = created.id;
        activeContextId = created.contextId;
        // 首答复用：建任务时 hint=question 恒成立——任务已完成则直接返回其回答
        //（避免 SendMessage 再分析一次；newTaskID 保持追问契约）
        const createdTask = await a2aRequest('GetTask', { id: activeTaskID }, signal);
        const cState = createdTask?.task?.status?.state ?? createdTask?.status?.state;
        const cAnswer = taskAnswer(createdTask?.task ?? createdTask);
        if (cState === 'TASK_STATE_COMPLETED' && cAnswer) {
          markReused(activeTaskID);
          return {
            title: 'Media Agent 回答',
            output: cAnswer,
            metadata: { taskID: activeTaskID, newTaskID: activeTaskID },
          };
        }
      } else {
        return {
          title: 'Media Agent 调用失败',
          output: '缺少参数：请提供 taskID（媒体附件指针）或 mediaPath（媒体文件路径）。',
          metadata: {},
        };
      }

      // ② SendMessage → 多轮追问（引用前序任务，媒体不重传）
      const result = await a2aRequest(
        'SendMessage',
        {
          message: {
            messageId: `ask-${randomUUID()}`,
            role: 1, // ROLE_USER
            contextId: activeContextId,
            referenceTaskIds: [activeTaskID],
            parts: [{ text: question }],
          },
        },
        signal,
      );
      const t = result?.task;
      const state = t?.status?.state;
      const answer = taskAnswer(t);

      if (state === 'TASK_STATE_FAILED') {
        return {
          title: 'Media Agent 分析失败',
          output: answer || 'Media Agent 分析失败，请稍后重试。',
          metadata: { taskID: activeTaskID },
        };
      }
      if (!answer) {
        return {
          title: 'Media Agent 返回空',
          output: 'Media Agent 未返回描述，请稍后重试。',
          metadata: { taskID: activeTaskID },
        };
      }
      return {
        title: 'Media Agent 回答',
        output: answer + `\n（新任务 taskID: ${t?.id}，继续追问请用新 taskID）`,
        metadata: { taskID: activeTaskID, newTaskID: t?.id },
      };
    } catch (err) {
      return {
        title: 'Media Agent 不可用',
        output: `Media Agent 调用失败：${(err as Error).message}（请稍后重试）`,
        metadata: { taskID: taskID ?? undefined, mediaPath: mediaPath ?? undefined },
      };
    }
  },
};
