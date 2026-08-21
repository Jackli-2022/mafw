import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  RequestContext,
  type AgentExecutor,
  type ExecutionEventBus,
  ServerCallContext,
  UnauthenticatedUser,
} from '@a2a-js/sdk/server';
import {
  AgentCard,
  AgentSkill,
  Message,
  Part,
  Task,
  TaskState,
} from '@a2a-js/sdk';
import { ContentTypeNotSupportedError, TaskNotFoundError } from '@a2a-js/sdk/errors';
import { A2A_VERSION_HEADER } from '@a2a-js/sdk';
import { MediaService, MediaInput, kindFromMediaType } from './media-service';
import { log } from '../core/utils/logger';

/**
 * MediaAgent — an A2A (Agent2Agent) v1.0 agent that answers multi-turn
 * questions about image / video / audio media via the configured multimodal
 * API (MediaService). Each modality can use its own model (media 配置段).
 *
 * Protocol surface (all standard A2A, JSON-RPC binding):
 *   message/send   — first turn carries the media as a FilePart (raw bytes);
 *                    follow-ups carry text only, the task keeps the media.
 *   tasks/get, tasks/cancel, tasks/list
 *   Agent card     — GET /.well-known/agent-card.json
 *   Artifacts      — task outputs (the stored media) exposed via artifact URL,
 *                    per spec §6.7 output-reference pattern.
 *
 * Internals:
 *   - ArtifactStore: LRU(500) + TTL(24h) map of media bytes (data URLs).
 *   - The media is stored once as a task artifact; revive flows (new task
 *     after the old one completed) reference the old artifact via its URL,
 *     so the bytes are never re-uploaded.
 *   - messageId idempotency: a repeated messageId on the same task returns
 *     the current task without re-running the media model.
 */

export const ARTIFACT_SCHEME = 'mafw-artifact://';
export const MEDIA_TASK_PREFIX = 'mtask_';

interface ArtifactEntry {
  /** In-memory data URL (small media) or null when the bytes live on disk. */
  dataUrl: string | null;
  /** Raw bytes for small media; null when on disk. */
  bytes: Buffer | null;
  /** Absolute path of the temp file for large media; null for small. */
  filePath: string | null;
  mediaType: string;
  size: number;
  createdAt: number;
}

// Bytes above this threshold are written to a temp file instead of being kept
// as a base64 string in memory (50MB video → ~67MB string otherwise).
const DISK_THRESHOLD_BYTES = 5 * 1024 * 1024;

class ArtifactStore {
  private map = new Map<string, ArtifactEntry>();

  constructor(
    private readonly max = 500,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  put(dataUrl: string): string {
    return this.putBytes(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), this.mediaTypeFromDataUrl(dataUrl));
  }

  /** Store raw bytes; large payloads spill to a temp file (disk-backed). */
  putBytes(bytes: Buffer, mediaType: string): string {
    this.prune();
    const id = randomUUID();
    const createdAt = this.now();
    if (bytes.length > DISK_THRESHOLD_BYTES) {
      const dir = path.join(os.tmpdir(), 'mafw-media');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${id}.bin`);
      try {
        fs.writeFileSync(filePath, bytes);
        this.map.set(id, { dataUrl: null, bytes: null, filePath, mediaType, size: bytes.length, createdAt });
        return id;
      } catch {
        // Disk write failed — fall back to memory so upload still works.
      }
    }
    const dataUrl = `data:${mediaType || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
    this.map.set(id, { dataUrl, bytes, filePath: null, mediaType, size: bytes.length, createdAt });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return id;
  }

  /** Return the artifact as a data URL (lazy-reads disk-backed entries). */
  get(id: string): string | undefined {
    const entry = this.map.get(id);
    if (!entry) return undefined;
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.delete(id);
      return undefined;
    }
    // LRU touch
    this.map.delete(id);
    this.map.set(id, entry);
    if (entry.dataUrl) return entry.dataUrl;
    if (entry.filePath) {
      try {
        const buf = fs.readFileSync(entry.filePath);
        return `data:${entry.mediaType || 'application/octet-stream'};base64,${buf.toString('base64')}`;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  getMediaType(id: string): string | undefined {
    return this.map.get(id)?.mediaType;
  }

  size(): number {
    return this.map.size;
  }

  private delete(id: string): void {
    const entry = this.map.get(id);
    this.map.delete(id);
    if (entry?.filePath) {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
    }
  }

  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.map) {
      if (now - entry.createdAt > this.ttlMs) this.delete(id);
    }
  }

  private mediaTypeFromDataUrl(dataUrl: string): string {
    const m = dataUrl.match(/^data:([^;,]+)/);
    return m ? m[1] : 'application/octet-stream';
  }
}

const SUPPORTED_INPUT_MODES = ['text', 'image', 'video', 'audio'];

// Size guards: base64 data-URL character length → raw bytes ≈ len * 0.75.
// Video is expensive to ship around and to encode; cap both conservatively.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function taskStatus(state: TaskState, message?: Message, timestamp = new Date().toISOString()) {
  return { state, timestamp, message };
}

function textPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    mediaType: 'text/plain',
    filename: '',
    metadata: {},
  } as Part;
}

function makeMessage(role: 1 | 2, taskId: string, contextId: string, parts: Part[]): Message {
  return {
    role,
    messageId: randomUUID(),
    taskId,
    contextId,
    parts,
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  } as Message;
}

export interface MediaAgentOptions {
  /** Public base URL of this agent (used in the agent card + artifact URLs). */
  baseUrl: string;
  /** URL path prefix for artifact downloads, e.g. /a2a/artifacts. */
  artifactPath: string;
  /** Optional: force the protocol version when the client sends none. */
  defaultVersion?: string;
}

export interface JsonRpcResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface JsonRpcResponseEnvelope {
  jsonrpc: string;
  id: unknown;
  result?: unknown;
  error?: unknown;
}

export class MediaAgent {
  private readonly artifacts: ArtifactStore;
  private readonly taskStore: InMemoryTaskStore;
  private readonly jsonRpc: JsonRpcTransportHandler;
  private readonly handler: DefaultRequestHandler;
  private readonly agentCardData: AgentCard;
  private readonly seenMessages = new Map<string, Set<string>>();

  constructor(
    private readonly media: MediaService,
    private readonly options: MediaAgentOptions,
  ) {
    this.artifacts = new ArtifactStore();
    this.taskStore = new InMemoryTaskStore();
    this.agentCardData = this.buildAgentCard();
    const executor: AgentExecutor = {
      execute: (ctx, bus) => this.execute(ctx, bus),
      cancelTask: async (taskId, bus) => this.cancelTask(taskId, bus),
    };
    this.handler = new DefaultRequestHandler(this.agentCardData, this.taskStore, executor);
    this.jsonRpc = new JsonRpcTransportHandler(this.handler);
    log.info(`[MediaAgent] A2A agent ready at ${options.baseUrl}/a2a`);
  }

  get agentCard(): AgentCard {
    return this.agentCardData;
  }

  artifactCount(): number {
    return this.artifacts.size();
  }

  getArtifact(id: string): { dataUrl: string; mediaType: string } | undefined {
    const dataUrl = this.artifacts.get(id);
    if (!dataUrl) return undefined;
    const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || 'application/octet-stream';
    return { dataUrl, mediaType: mime };
  }

  /** 存入 artifact（TTS 输出等 gateway 侧产物），返回 artifact ID。mime 从 dataUrl 前缀推导。 */
  putArtifact(dataUrl: string): string {
    return this.artifacts.put(dataUrl);
  }

  /** 存入原始媒体字节（桌面端二进制上传），大文件落盘。 */
  putArtifactBytes(bytes: Buffer, mediaType: string): string {
    return this.artifacts.putBytes(bytes, mediaType);
  }

  getArtifactMediaType(id: string): string | undefined {
    return this.artifacts.getMediaType(id);
  }

  /**
   * Create a task immediately and start analysis in the background.
   * Returns the task ID synchronously; analysis runs asynchronously.
   */
  createTaskAsync(artifactId: string, mediaType: string, question?: string): { taskId: string; contextId: string } {
    const t0 = Date.now();
    const taskId = `mtask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const contextId = `mctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Build artifact reference upfront so follow-up SendMessage (via
    // referenceTaskIds) can find the media immediately, even before the
    // background analysis completes.
    const artifactUrl = `${this.options.baseUrl}${this.options.artifactPath}/${artifactId}`;
    const artifact = {
      artifactId,
      name: 'upload.bin',
      description: '原始媒体工件',
      parts: [
        {
          content: { $case: 'url', value: artifactUrl },
          mediaType,
          filename: 'upload.bin',
          metadata: {},
        } as Part,
      ],
      metadata: {},
      extensions: [],
    };
    
    // Create task in store (state=working) with artifact already set
    const task = {
      id: taskId,
      contextId,
      status: taskStatus(TaskState.TASK_STATE_WORKING),
      history: [],
      artifacts: [artifact],
      metadata: {},
    } as unknown as Task;
    
    // Save task synchronously (use same context as SendMessage handler)
    const saveContext = new ServerCallContext({
      headers: {},
      requestedVersion: this.options.defaultVersion || '1.0',
      user: new UnauthenticatedUser(),
      extensions: undefined,
    } as any);
    this.taskStore.save(task, saveContext).catch(err => {
      log.error(`[MediaAgent] createTaskAsync: failed to save task ${taskId}: ${err.message}`);
    });
    
    // Build message with correct A2A part format: content.$case = 'url'
    const mediaPart: Part = {
      content: { $case: 'url', value: artifactUrl },
      mediaType,
      filename: 'upload.bin',
      metadata: {},
    } as Part;
    const userMessage = makeMessage(1, taskId, contextId, [
      mediaPart,
      ...(question ? [textPart(question)] : []),
    ]);
    
    // Trigger async analysis in background
    const requestContext = {
      taskId,
      contextId,
      userMessage,
      task,  // pass the task with its artifact so execute's working-state publish
             // does not clobber artifacts with an empty array
      referenceTasks: [],
    } as unknown as RequestContext;
    
    // Simple event bus that updates task store (same context as the initial save)
    const bus: ExecutionEventBus = {
      publish: (event) => {
        if (event.kind === 'task') {
          this.taskStore.save(event.data, saveContext).catch(err => {
            log.error(`[MediaAgent] createTaskAsync: failed to update task ${taskId}: ${err.message}`);
          });
        }
      },
      on: () => bus,
      off: () => bus,
      once: () => bus,
      removeAllListeners: () => bus,
      finished: () => {},
    };
    
    const t1 = Date.now();
    console.log(`[MediaAgent] createTaskAsync: prep ${t1 - t0}ms, starting background analysis for task ${taskId}`);
    
    // Fire-and-forget: execute analysis in background (don't wait)
    void this.execute(requestContext, bus).then(() => {
      const t2 = Date.now();
      console.log(`[MediaAgent] createTaskAsync: analysis completed for task ${taskId} in ${t2 - t1}ms`);
    }).catch(err => {
      console.error(`[MediaAgent] createTaskAsync: analysis failed for task ${taskId}: ${err.message}`);
    });
    
    return { taskId, contextId };
  }

  /**
   * Handle a JSON-RPC A2A request (POST /a2a). Returns the HTTP response.
   */
  async handleJsonRpc(body: string | Record<string, unknown>, headers: Record<string, string | undefined>): Promise<JsonRpcResult> {
    // 诊断：打印 SendMessage 收到的 parts 原始结构（定位桌面 createTask 失败根因）
    try {
      const rawBody = typeof body === 'string' ? JSON.parse(body) : body;
      const msg = rawBody?.params?.message;
      if (rawBody?.method === 'SendMessage' && Array.isArray(msg?.parts)) {
        log.info(
          `[MediaAgent] SendMessage parts: ${JSON.stringify(msg.parts).slice(0, 400)} | ` +
          `msgId=${String(msg?.messageId ?? '').slice(0, 24)} hasRef=${Array.isArray(msg?.referenceTaskIds) ? msg.referenceTaskIds.length : 0}`,
        );
      }
    } catch { /* 诊断日志失败不影响主流程 */ }
    const requestedVersion = headers[A2A_VERSION_HEADER?.toLowerCase()] || this.options.defaultVersion || '1.0';
    const context = new ServerCallContext({
      headers,
      requestedVersion,
      user: new UnauthenticatedUser(),
      extensions: undefined,
    } as any);
    const result = await this.jsonRpc.handle(body, context);
    if (typeof (result as any)?.[Symbol.asyncIterator] === 'function') {
      // Streaming response (message/stream) — collect the first event for the
      // internal synchronous path; the gateway does not expose streaming yet.
      const generator = result as AsyncGenerator<JsonRpcResponseEnvelope, void, undefined>;
      const first = await generator.next();
      if (first.done) {
        return { status: 200, headers: { [A2A_VERSION_HEADER]: '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', result: null }) };
      }
      return { status: 200, headers: { [A2A_VERSION_HEADER]: '1.0' }, body: JSON.stringify(first.value) };
    }
    return {
      status: 200,
      headers: { [A2A_VERSION_HEADER]: '1.0', 'Content-Type': 'application/a2a+json' },
      body: JSON.stringify(result),
    };
  }

  // -------------------------------------------------------------------------
  // Executor

  private async execute(requestContext: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const userMessage = requestContext.userMessage;
    console.log(`[MediaAgent] execute called: taskId=${taskId}, contextId=${contextId}, userMessageId=${userMessage.messageId}`);
    log.info(`[MediaAgent] execute called: taskId=${taskId}, contextId=${contextId}, userMessageId=${userMessage.messageId}`);

    // Idempotency: a message already processed for this task is a replay.
    const seen = this.seenMessages.get(taskId) ?? new Set<string>();
    if (requestContext.task && seen.has(userMessage.messageId)) {
      log.info(`[MediaAgent] execute: replay detected, returning cached task`);
      bus.publish(AgentEvent.task(requestContext.task));
      return;
    }
    seen.add(userMessage.messageId);
    this.seenMessages.set(taskId, seen);

    // Working state on entry.
    const workingTask: Task = requestContext.task ?? {
      id: taskId,
      contextId,
      status: taskStatus(TaskState.TASK_STATE_SUBMITTED),
      history: [],
      artifacts: [],
      metadata: {},
    } as Task;
    workingTask.status = taskStatus(TaskState.TASK_STATE_WORKING);
    bus.publish(AgentEvent.task(workingTask));

    try {
      // Resolve the media: first turn extracts it from the message parts;
      // follow-up turns reference the prior task (referenceTaskIds) and reuse
      // its artifact — the bytes are never re-uploaded.
      log.info(`[MediaAgent] execute: taskId=${taskId}, referenceTasks=${requestContext.referenceTasks?.length ?? 0}, hasTask=${!!requestContext.task}`);
      if (requestContext.referenceTasks && requestContext.referenceTasks.length > 0) {
        for (const rt of requestContext.referenceTasks) {
          log.info(`[MediaAgent] execute: refTask ${rt.id}, artifacts=${rt.artifacts?.length ?? 0}`);
        }
      }
      const media = await this.resolveMedia(requestContext, userMessage);
      if (!media) {
        throw new ContentTypeNotSupportedError(
          'A2A media agent requires an image/video/audio part (raw bytes or a known artifact URL) on the first message.',
        );
      }
      const kind = kindFromMediaType(media.mediaType);

      // Build the prompt from referenced/history context + the new question.
      const priorTasks = requestContext.referenceTasks ?? [];
      const historyText = this.historyToText(
        [...priorTasks.flatMap((t) => t.history ?? []), ...(requestContext.task?.history ?? [])],
      );
      const questionText = this.messageToText(userMessage);
      // 音频首轮（无历史上下文）→ 叙述式分析（内容 + 情绪/语调轨迹 + 意图，自然语言）；
      // 追问轮保持自由提问（主 Agent 可追问细节）。
      if (kind === 'audio' && !historyText) {
        const description = await this.media.analyzeAudioNarrative({
          kind,
          dataUrl: media.dataUrl,
          mediaType: media.mediaType,
        });
        const answerMessage = makeMessage(2, taskId, contextId, [textPart(description)]);
        const history = [...(requestContext.task?.history ?? []), userMessage, answerMessage];

        const artifact = media.artifact;
        const finalTask: Task = {
          id: taskId,
          contextId,
          status: taskStatus(TaskState.TASK_STATE_COMPLETED, answerMessage),
          history,
          artifacts: artifact ? [artifact] : requestContext.task?.artifacts ?? [],
          metadata: {},
        } as Task;
        bus.publish(AgentEvent.task(finalTask));
        return;
      }

      const prompt = [historyText, questionText].filter(Boolean).join('\n\n') || '请描述这个媒体内容。';

      const description = await this.media.analyze(
        { kind, dataUrl: media.dataUrl, mediaType: media.mediaType },
        prompt,
      );

      const answerMessage = makeMessage(2, taskId, contextId, [textPart(description)]);
      const history = [...(requestContext.task?.history ?? []), userMessage, answerMessage];

      const artifact = media.artifact;
      const finalTask: Task = {
        id: taskId,
        contextId,
        status: taskStatus(TaskState.TASK_STATE_COMPLETED, answerMessage),
        history,
        artifacts: artifact ? [artifact] : requestContext.task?.artifacts ?? [],
        metadata: {},
      } as Task;
      bus.publish(AgentEvent.task(finalTask));
    } catch (err) {
      log.error(`[MediaAgent] task ${taskId} failed: ${(err as Error).message}`);
      const errorMessage = makeMessage(2, taskId, contextId, [textPart(`[media agent] 媒体分析失败：${(err as Error).message}`)]);
      const failedTask: Task = {
        id: taskId,
        contextId,
        status: taskStatus(TaskState.TASK_STATE_FAILED, errorMessage),
        history: [...(requestContext.task?.history ?? []), userMessage],
        artifacts: requestContext.task?.artifacts ?? [],
        metadata: {},
      } as Task;
      bus.publish(AgentEvent.task(failedTask));
    }
  }

  private async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    const task = await this.taskStore.load(taskId, {} as ServerCallContext);
    if (!task) throw new TaskNotFoundError(`Task ${taskId} not found`);
    const canceled: Task = {
      ...task,
      status: taskStatus(TaskState.TASK_STATE_CANCELED),
    } as Task;
    bus.publish(AgentEvent.task(canceled));
  }

  // -------------------------------------------------------------------------
  // Media resolution

  private async resolveMedia(
    requestContext: RequestContext,
    userMessage: Message,
  ): Promise<{ dataUrl: string; mediaType: string; artifact?: any } | undefined> {
    // Follow-up turn: reuse the media artifact of a referenced prior task.
    const refTasks = requestContext.referenceTasks ?? [];
    log.info(`[MediaAgent] resolveMedia: referenceTasks=${refTasks.length}, hasTask=${!!requestContext.task}`);
    for (const refTask of refTasks) {
      log.info(`[MediaAgent] resolveMedia: checking refTask ${refTask.id}, artifacts=${refTask.artifacts?.length ?? 0}`);
      const media = this.mediaFromTask(refTask);
      if (media) {
        log.info(`[MediaAgent] resolveMedia: found media from refTask ${refTask.id}`);
        return media;
      }
    }
    // Or from the current task (e.g. resumed history).
    if (requestContext.task) {
      log.info(`[MediaAgent] resolveMedia: checking current task ${requestContext.task.id}, artifacts=${requestContext.task.artifacts?.length ?? 0}`);
      const media = this.mediaFromTask(requestContext.task);
      if (media) {
        log.info(`[MediaAgent] resolveMedia: found media from current task`);
        return media;
      }
    }

    // First turn: extract from the message parts.
    const mediaPart = userMessage.parts.find((p) => p.content?.$case === 'raw' || p.content?.$case === 'url');
    if (!mediaPart) return undefined;
    const mediaType = mediaPart.mediaType || (mediaPart.content?.$case === 'raw' ? 'application/octet-stream' : '');
    if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/')) {
      throw new ContentTypeNotSupportedError(`Unsupported media type: ${mediaType || 'unknown'}`);
    }

    if (mediaPart.content?.$case === 'raw') {
      const raw = mediaPart.content.value as Buffer | Uint8Array | number[];
      // The SDK may deliver raw bytes as a Buffer or as a Uint8Array/number[] —
      // normalize before re-encoding to base64.
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      this.assertSize(mediaType, bytes.length);
      const dataUrl = `data:${mediaType};base64,${bytes.toString('base64')}`;
      const artifactId = this.artifacts.put(dataUrl);
      const artifactUrl = `${this.options.baseUrl}${this.options.artifactPath}/${artifactId}`;
      return {
        dataUrl,
        mediaType,
        artifact: {
          artifactId,
          name: mediaPart.filename || this.defaultMediaName(mediaType),
          description: '原始媒体工件',
          parts: [
            {
              content: { $case: 'url', value: artifactUrl },
              mediaType,
              filename: mediaPart.filename || this.defaultMediaName(mediaType),
              metadata: {},
            } as Part,
          ],
          metadata: {},
        },
      };
    }

    // url part — only our own artifact URLs are accepted (SSRF protection).
    if (mediaPart.content?.$case !== 'url') return undefined;
    const url = mediaPart.content.value as string;
    const id = this.artifactUrlToId(url) ?? (url.startsWith(ARTIFACT_SCHEME) ? url.slice(ARTIFACT_SCHEME.length) : undefined);
    const dataUrl = id ? this.artifacts.get(id) : undefined;
    if (!dataUrl) {
      // 诊断：区分 artifact 内存丢失（upload 后 gateway 重启/TTL 淘汰）与解析失败
      log.warn(
        `[MediaAgent] artifact url part unresolvable | url=${url} id=${id ?? '(none)'} ` +
        `storeSize=${this.artifacts.size()} storeHas=${id ? this.artifacts.get(id) !== undefined : 'n/a'}`,
      );
      throw new ContentTypeNotSupportedError('外部媒体 URL 不被接受；请使用 raw 字节或本 agent 的工件引用。');
    }
    const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || 'application/octet-stream';
    // 与 raw 分支一致：把工件挂到任务 artifacts，追问轮（referenceTaskIds）才能
    // 经 mediaFromTask 复用媒体——否则首轮成功后 artifacts 为空，追问必败。
    const artifactUrl = `${this.options.baseUrl}${this.options.artifactPath}/${id}`;
    return {
      dataUrl,
      mediaType: mime,
      artifact: {
        artifactId: id,
        name: mediaPart.filename || this.defaultMediaName(mime),
        description: '原始媒体工件',
        parts: [
          {
            content: { $case: 'url', value: artifactUrl },
            mediaType: mime,
            filename: mediaPart.filename || this.defaultMediaName(mime),
            metadata: {},
          } as Part,
        ],
        metadata: {},
      },
    };
  }

  private mediaFromTask(task: Task): { dataUrl: string; mediaType: string; artifact?: any } | undefined {
    const urlPart = task.artifacts
      ?.flatMap((a) => a.parts ?? [])
      .find((p) => p.content?.$case === 'url');
    if (!urlPart) return undefined;
    const id = this.artifactUrlToId(String(urlPart.content!.value));
    const dataUrl = id ? this.artifacts.get(id) : undefined;
    if (!dataUrl) return undefined;
    const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || 'application/octet-stream';
    return { dataUrl, mediaType: mime };
  }

  private assertSize(mediaType: string, byteLength: number): void {
    let max: number;
    if (mediaType.startsWith('video/')) max = MAX_VIDEO_BYTES;
    else if (mediaType.startsWith('audio/')) max = MAX_AUDIO_BYTES;
    else max = MAX_IMAGE_BYTES;
    if (byteLength > max) {
      throw new ContentTypeNotSupportedError(
        `媒体过大：${(byteLength / (1024 * 1024)).toFixed(1)}MB 超过上限 ${(max / (1024 * 1024)).toFixed(0)}MB（${mediaType}）`,
      );
    }
  }

  private defaultMediaName(mediaType: string): string {
    const ext = (mediaType.split('/')[1] || 'bin').split(';')[0].split('+')[0];
    return `media.${ext || 'bin'}`;
  }

  private artifactUrlToId(url: string): string | undefined {
    const marker = `${this.options.artifactPath}/`;
    const idx = url.lastIndexOf(marker);
    if (idx < 0) return undefined;
    const id = url.slice(idx + marker.length).split(/[?#]/)[0];
    return id || undefined;
  }

  // -------------------------------------------------------------------------
  // Text helpers

  private messageToText(message: Message): string {
    return message.parts
      .filter((p) => p.content?.$case === 'text')
      .map((p) => String(p.content!.value))
      .join('\n')
      .trim();
  }

  private historyToText(history: Message[]): string {
    return history
      .map((m) => {
        const role = m.role === 1 ? '用户' : '媒体Agent';
        const text = this.messageToText(m);
        return text ? `${role}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  // -------------------------------------------------------------------------
  // Agent card

  private buildAgentCard(): AgentCard {
    const skill: AgentSkill = {
      id: 'media_analyze',
      name: 'media_analyze',
      description:
        '分析图片/视频/音频并回答关于媒体的多轮问题。首次消息需包含媒体（FilePart raw 字节或工件 URL 引用），后续消息只发送文本问题即可，媒体会保留在任务上下文中。',
      tags: ['media', 'image', 'video', 'audio', 'multimodal'],
      examples: [],
      inputModes: SUPPORTED_INPUT_MODES,
      outputModes: ['text'],
      securityRequirements: [],
    };
    return {
      name: 'MAFW MediaAgent',
      description: 'MAFW 内置多模态 Agent：基于 gateway media 配置段（默认 xiaomi/mimo-v2.5，每模态可独立指定 provider/model）对图片、视频、音频进行多轮问答分析。',
      url: `${this.options.baseUrl}/a2a`,
      version: '1.0.0',
      provider: { url: this.options.baseUrl, organization: 'MAFW' },
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extensions: [],
      },
      defaultInputModes: SUPPORTED_INPUT_MODES,
      defaultOutputModes: ['text'],
      skills: [skill],
      supportedInterfaces: [],
      securitySchemes: {},
      securityRequirements: [],
      signatures: [],
    } as AgentCard;
  }
}
