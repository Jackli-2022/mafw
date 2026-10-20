/**
 * v2-compat — OpenCode V2 plugin API 适配层。
 *
 * V1 插件实现（hooks 操作 V1 消息形状、tools 用 zod args）保持不动，本模块
 * 把它们适配到 V2 的形状：
 *
 *  - `zodToJsonSchema`            V1 tool `args`（zod）→ V2 `editor.add({ input })` JSON Schema
 *  - `toV1Views` / `propagateSyntheticViews`
 *                                 V2 协议消息 `{ role, content }` → V1 视图 `{ info, parts }`
 *                                 （parts 与 content 同引用，原地变更自动传播）
 *  - `convertPromptFilesToPointers`
 *                                 prompt admission 阶段把媒体附件转 A2A 文本指针
 *                                 （V1 ingestLargeMediaBeforeStore 的 V2 等价物）
 *  - `captureAssistantOutput`     session.idle 时从持久化消息收割 assistant 文本
 *                                 与 reasoning（V1 text.complete / reasoning.ended 事件钩子的 V2 等价物）
 */
import { createMediaTask, makeMediaPointer, mediaDataFromSource } from '../hooks/media-ingest';
import { pushObservation } from './obs-capture';

// ------------------------------------------------------------ zod → JSON Schema

type ZodLike = { _def?: any; description?: string };

/**
 * Convert a V1 tool `args` map (zod schemas) into the JSON Schema `input`
 * expected by V2 `ctx.tool.transform((editor) => editor.add({ input }))`.
 * Supports the zod v3 constructs used by the plugin's tools:
 * string / enum / array(.max) / number(.int().min().max()) / boolean / object /
 * optional + `.describe()`.
 */
export function zodToJsonSchema(args: Record<string, ZodLike> | undefined): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [name, schema] of Object.entries(args ?? {})) {
    const optional = schema?._def?.typeName === 'ZodOptional';
    properties[name] = convertZodType(schema);
    if (!optional) required.push(name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function convertZodType(schema: ZodLike | undefined): any {
  const def = (schema as any)?._def;
  const description =
    typeof schema?.description === 'string' && schema.description
      ? { description: schema.description }
      : {};
  switch (def?.typeName) {
    case 'ZodOptional': {
      // `.optional().describe('x')` carries the description on the wrapper.
      const inner = convertZodType(def.innerType as ZodLike);
      return Object.keys(description).length ? { ...inner, ...description } : inner;
    }
    case 'ZodString':
      return { type: 'string', ...description };
    case 'ZodEnum':
      return { type: 'string', enum: [...(def.values ?? [])], ...description };
    case 'ZodArray': {
      const max = def.maxLength?.value ?? def.maxLength;
      return {
        type: 'array',
        items: convertZodType(def.type as ZodLike),
        ...(typeof max === 'number' ? { maxItems: max } : {}),
        ...description,
      };
    }
    case 'ZodNumber': {
      const checks: any[] = def.checks ?? [];
      const out: any = { type: checks.some((c) => c.kind === 'int' || c.check === 'int') ? 'integer' : 'number' };
      for (const check of checks) {
        const kind = check.kind ?? check.check;
        if (kind === 'min' && typeof check.value === 'number' && check.inclusive !== false) out.minimum = check.value;
        if (kind === 'max' && typeof check.value === 'number' && check.inclusive !== false) out.maximum = check.value;
      }
      return { ...out, ...description };
    }
    case 'ZodBoolean':
      return { type: 'boolean', ...description };
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      return zodToJsonSchema(shape ?? {});
    }
    default:
      return { ...description };
  }
}

// ------------------------------------------------------------ message views

export interface V1MessageView {
  role: string;
  info: { id: string; sessionID: string; role: string };
  /** 与 V2 `content` 同引用的原地可变 parts 数组（注入自动传播）。 */
  parts: any[];
  /** 原始 V2 协议消息；V1 hooks 推入的合成视图（python-guide 等）没有该标记。 */
  __v2?: any;
}

/**
 * Build V1-style views over V2 protocol messages. `parts` aliases the V2
 * `content` array, so in-place mutations by the V1 hooks (recall 注入、媒体
 * 指针替换) propagate to the outgoing model call. V2 protocol messages carry
 * no ids, so a stable per-position id (`sessionID:index`) is derived —
 * compaction shifts positions, which the recall cursor treats as a
 * miss-and-fallback (same recovery as V1's lost-id path).
 */
export function toV1Views(messages: any[] | undefined, sessionID: string): V1MessageView[] {
  return (messages ?? []).map((msg: any, index: number): V1MessageView => {
    const role = msg?.role ?? msg?.info?.role ?? 'user';
    const content = Array.isArray(msg?.content) ? msg.content : [];
    return {
      role,
      info: { id: msg?.id ?? `${sessionID}:${index}`, sessionID, role },
      parts: content,
      __v2: msg,
    };
  });
}

/**
 * V1 hooks may append bare `{ role, parts }` messages to the views array
 * (e.g. the python-guide note). Propagate those to the V2 event as protocol
 * messages so they reach the model call.
 */
export function propagateSyntheticViews(views: V1MessageView[], messages: any[]): void {
  for (const view of views) {
    if (view.__v2) continue;
    messages.push({ role: view.role, content: view.parts });
    view.__v2 = { role: view.role, content: view.parts };
  }
}

// ------------------------------------------------------------ prompt media

const MEDIA_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  flac: 'audio/flac', opus: 'audio/opus', aac: 'audio/aac', wma: 'audio/x-ms-wma',
};

export function mediaMimeFromUri(uri: string): string | null {
  const clean = String(uri ?? '').split(/[?#]/)[0];
  const ext = clean.split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_MIME_BY_EXT[ext] ?? null;
}

/**
 * Prompt-admission media ingest (V1 `ingestLargeMediaBeforeStore` 的 V2 等价
 * 物)：把图片/视频/音频附件提前建 A2A 任务并替换为文本指针，媒体不再进入
 * 持久化输入，也避免 context hook 每步循环重复建任务。fail-open：任何异常
 * 都不阻塞用户消息发送。
 */
export async function convertPromptFilesToPointers(prompt: { text?: string; files?: any[] } | undefined): Promise<void> {
  const flag = (process.env.MEDIA_INGEST || process.env.VISION_INGEST || '').toLowerCase();
  if (flag === 'off') return;
  if (!prompt) return;
  const files = prompt.files;
  if (!Array.isArray(files) || files.length === 0) return;
  if (!files.some((f: any) => typeof f?.uri === 'string' && mediaMimeFromUri(f.uri))) return;

  const hint = prompt.text || '';
  const keep: any[] = [];
  const pointers: string[] = [];
  for (const file of files) {
    const uri = typeof file?.uri === 'string' ? file.uri : '';
    const mime = mediaMimeFromUri(uri);
    if (!mime) {
      keep.push(file);
      continue;
    }
    const name = file?.name || uri.split('/').pop() || '媒体文件';
    try {
      const dataUrl = await mediaDataFromSource(uri, mime);
      const task = await createMediaTask(dataUrl, hint);
      pointers.push(makeMediaPointer(task.id, task.contextId, name));
    } catch (err: any) {
      pointers.push(`[媒体未送达 Media Agent：${String(err?.message ?? err).slice(0, 200)}]`);
    }
  }
  if (!pointers.length) return;
  files.length = 0;
  files.push(...keep);
  prompt.text = [hint, ...pointers].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------- assistant output capture

/** Per-session cursor: id of the last persisted message whose output was captured. */
const assistantCursorBySession = new Map<string, string>();

/**
 * Capture assistant text (`assistant_reply`) and reasoning (`reasoning`)
 * observations from the session's persisted messages. Called on
 * `session.idle`; the message-id cursor makes repeated idle events idempotent.
 */
export async function captureAssistantOutput(sessionID: string, messages: any[]): Promise<void> {
  if (!sessionID || !Array.isArray(messages) || messages.length === 0) return;
  const cursor = assistantCursorBySession.get(sessionID);
  const cursorIndex = cursor ? messages.findIndex((m: any) => m?.id === cursor) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;

  for (const message of messages.slice(start)) {
    const isAssistant = message?.type === 'assistant' || message?.role === 'assistant';
    if (!isAssistant) continue;
    const parts: any[] = Array.isArray(message?.content) ? message.content
      : Array.isArray(message?.parts) ? message.parts : [];
    const reasoning = parts
      .filter((p: any) => p?.type === 'reasoning' && typeof p?.text === 'string')
      .map((p: any) => p.text).join('\n');
    const text = parts
      .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
      .map((p: any) => p.text).join('\n');
    if (reasoning) void pushObservation(sessionID, 'reasoning', reasoning);
    if (text) void pushObservation(sessionID, 'assistant_reply', text);
  }

  const last = messages[messages.length - 1];
  if (last?.id) assistantCursorBySession.set(sessionID, last.id);
}

/** 测试辅助：重置 assistant 收割游标。 */
export function _resetAssistantCursor(): void {
  assistantCursorBySession.clear();
}
