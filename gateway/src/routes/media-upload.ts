/**
 * Phase D1 Task 3e / C4: media upload/analyze REST 面（registry dispatch 接线）。
 *
 *   POST /api/media/analyze-audio    — 音频叙述式理解
 *   POST /api/media/upload           — 二进制上传（octet-stream + ?type=）
 *   POST /api/media/create-task      — 从已上传 artifact 建 A2A 任务
 *   POST /api/media/upload-and-create — 上传+建任务一体
 *   GET  /api/media/resolve-task/:id — taskId → artifactId（历史回放；Task C4）
 *
 * handler 体从 index.ts legacy 分支逐字迁移。媒体分支 loopback-only
 * （upload-and-create / resolve-task 同）；upload 的尺寸帽与 chunk 流逐字保留。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { isLocalRequest } from '../core/auth';
import { config } from '../config';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export interface MediaAgentLike {
  putArtifactBytes(bytes: Buffer, mediaType: string): string;
  putArtifact(dataUrl: string): string;
  getArtifactMediaType(artifactId: string): string | undefined;
  resolveTaskArtifactId(taskId: string): Promise<string | undefined>;
  createTaskAsync(artifactId: string, mediaType: string, question: string): { taskId: string; contextId: string };
  handleJsonRpc(payload: unknown, headers: Record<string, string>): Promise<{ status: number; body: string }>;
}

export interface MediaServiceLike {
  analyze(input: { kind: string; dataUrl: string; mediaType: string }, prompt: string): Promise<unknown>;
  analyzeAudioNarrative(input: { kind: string; dataUrl: string; mediaType: string }): Promise<unknown>;
}

export interface MediaRouteDeps {
  getMediaAgent: () => MediaAgentLike | null | undefined;
  getMediaService: () => MediaServiceLike | null | undefined;
}

export function attachMediaRoutes(registry: RouteRegistry, deps: MediaRouteDeps): void {
  registry.attachHandler('media.analyzeAudio', async (req, res) => {
    if (!isLocalRequest(req)) { forbidden(res); return; }
    try {
      const service = deps.getMediaService();
      if (!service) { json(res, 503, { error: 'MediaService not initialized' }); return; }
      const body = JSON.parse(await readRouteBody(req));
      const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
      if (!dataUrl) { json(res, 400, { error: 'dataUrl is required' }); return; }
      const mediaType = typeof body?.mediaType === 'string' && body.mediaType ? body.mediaType : 'audio/wav';
      const promptText = typeof body?.prompt === 'string' ? body.prompt : undefined;
      // 叙述式分析（内容 + 情绪/语调轨迹 + 意图，自然语言）；允许自定义 prompt 覆盖。
      const result = promptText
        ? await service.analyze({ kind: 'audio', dataUrl, mediaType }, promptText)
        : await service.analyzeAudioNarrative({ kind: 'audio', dataUrl, mediaType });
      json(res, 200, { result });
    } catch (err: any) {
      json(res, 502, { error: err?.message || String(err) });
    }
  });

  registry.attachHandler('media.upload', async (req, res) => {
    if (!isLocalRequest(req)) { forbidden(res); return; }
    try {
      const agent = deps.getMediaAgent();
      if (!agent) { json(res, 503, { error: 'MediaAgent not initialized' }); return; }
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const mediaType = parsedUrl.searchParams.get('type') || 'application/octet-stream';
      if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/')) {
        json(res, 415, { error: `Unsupported media type: ${mediaType}` });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      const cap = mediaType.startsWith('video/') ? 50 * 1024 * 1024 : mediaType.startsWith('audio/') ? 25 * 1024 * 1024 : 20 * 1024 * 1024;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > cap) {
          json(res, 413, { error: `Media exceeds ${cap} byte limit` });
          return;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length === 0) { json(res, 400, { error: 'empty body' }); return; }
      const artifactId = agent.putArtifactBytes(bytes, mediaType);
      const baseUrl = `http://127.0.0.1:${config.server.apiPort}`;
      json(res, 200, {
        artifactId,
        mediaType,
        size: bytes.length,
        url: `${baseUrl}/a2a/artifacts/${artifactId}`,
      });
    } catch (err: any) {
      json(res, 502, { error: err?.message || String(err) });
    }
  });

  registry.attachHandler('media.createTaskApi', async (req, res) => {
    if (!isLocalRequest(req)) { forbidden(res); return; }
    try {
      const agent = deps.getMediaAgent();
      if (!agent) { json(res, 503, { error: 'MediaAgent not initialized' }); return; }
      const body = JSON.parse(await readRouteBody(req));
      const artifactId = typeof body?.artifactId === 'string' ? body.artifactId : '';
      const question = typeof body?.question === 'string' ? body.question : '';
      if (!artifactId) { json(res, 400, { error: 'artifactId is required' }); return; }
      const mediaType = typeof body?.mediaType === 'string' && body.mediaType ? body.mediaType : agent.getArtifactMediaType(artifactId) || 'application/octet-stream';
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'SendMessage',
        params: {
          message: {
            messageId: `fe-${Date.now()}`,
            role: 1,
            parts: [
              { url: `/a2a/artifacts/${artifactId}`, mediaType, filename: 'upload.bin' },
              ...(question ? [{ text: question }] : []),
            ],
          },
        },
      };
      const result = await agent.handleJsonRpc(payload, { 'a2a-version': '1.0' });
      const parsed: any = JSON.parse(result.body);
      if (parsed?.error) {
        res.writeHead(result.status);
        res.end(JSON.stringify({ error: parsed.error }));
        return;
      }
      const task = parsed?.result?.task;
      if (!task?.id) { json(res, 502, { error: 'no task returned' }); return; }
      json(res, 200, { id: task.id, contextId: task.contextId, state: task.status?.state || '' });
    } catch (err: any) {
      json(res, 502, { error: err?.message || String(err) });
    }
  });

  registry.attachHandler('media.uploadAndCreate', async (req, res) => {
    const t0 = Date.now();
    if (!isLocalRequest(req)) { forbidden(res); return; }
    try {
      const agent = deps.getMediaAgent();
      if (!agent) { json(res, 503, { error: 'MediaAgent not initialized' }); return; }
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const mediaType = parsedUrl.searchParams.get('type') || 'application/octet-stream';
      const question = parsedUrl.searchParams.get('question') || '';
      if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/')) {
        json(res, 415, { error: `Unsupported media type: ${mediaType}` });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      const cap = mediaType.startsWith('video/') ? 50 * 1024 * 1024 : mediaType.startsWith('audio/') ? 25 * 1024 * 1024 : 20 * 1024 * 1024;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > cap) {
          json(res, 413, { error: `Media exceeds ${cap} byte limit` });
          return;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const t1 = Date.now();
      if (bytes.length === 0) { json(res, 400, { error: 'empty body' }); return; }
      const artifactId = agent.putArtifactBytes(bytes, mediaType);
      const t2 = Date.now();
      // Create task immediately (state=working), analysis runs in background
      const { taskId, contextId } = agent.createTaskAsync(artifactId, mediaType, question);
      const t3 = Date.now();
      // Return immediately with taskID (state=working)
      json(res, 200, {
        id: taskId,
        contextId,
        state: 'TASK_STATE_WORKING',
        artifactId,
        mediaType,
        size: bytes.length,
      });
      const t4 = Date.now();
      // Timing log preserved from the legacy branch (diagnostics).
      const { log } = require('../core/utils/logger') as typeof import('../core/utils/logger');
      log.info(`[upload-and-create] read=${t1 - t0}ms artifact=${t2 - t1}ms task=${t3 - t2}ms respond=${t4 - t3}ms total=${t4 - t0}ms`);
    } catch (err: any) {
      json(res, 502, { error: err?.message || String(err) });
    }
  });

  // GET /api/media/resolve-task/<taskId> — resolve taskId to artifactId (for history)
  registry.attachHandler('media.resolveTask', async (req, res, params: Record<string, string>) => {
    if (!isLocalRequest(req)) { forbidden(res); return; }
    try {
      const agent = deps.getMediaAgent();
      if (!agent) { json(res, 503, { error: 'MediaAgent not initialized' }); return; }
      const artifactId = await agent.resolveTaskArtifactId(params.id);
      json(res, 200, { artifactId: artifactId || null });
    } catch (err: any) {
      json(res, 500, { error: err?.message || String(err) });
    }
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function forbidden(res: ServerResponse): void {
  res.writeHead(403);
  res.end(JSON.stringify({ error: 'forbidden' }));
}
