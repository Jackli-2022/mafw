/**
 * Phase D1 Task 3c: TTS REST 面（registry dispatch 接线）。
 *
 *   GET  /api/tts/voices    — 引擎音色/能力清单
 *   POST /api/tts           — 整段合成（wav，artifact 引用返回）
 *   POST /api/tts/stream    — 流式 SSE（PCM16 分块；x-tts-sample-rate 头）
 *   POST /api/tts/interrupt — barge-in 打断（取消 session 在途合成）
 *
 * handler 体从 index.ts legacy 分支逐字迁移；deps 注入可单测。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { isLocalRequest } from '../core/auth';
import { streamSentences } from '../tts/sentence-adapter';
import { handleTtsInterrupt } from './tts-interrupt';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';
import type { TtsEngineRegistry } from '../tts/registry';

/** The inflight tracking map (index.ts owns a TtlMap<string, Set<AbortController>>). */
export interface TtsInflightLike {
  get(key: string): Set<AbortController> | undefined;
  set(key: string, value: Set<AbortController>): void;
  delete(key: string): void;
}

export interface TtsRouteDeps {
  ttsRegistry: () => TtsEngineRegistry;
  /** Non-null = TTS initialized (the 503 gate on POST /api/tts). */
  ttsReady: () => boolean;
  /** mediaAgent.putArtifact(dataUrl) for the wav artifact reference. */
  putArtifact: (dataUrl: string) => string;
  /** In-flight abort registry for stream + interrupt. */
  inflight: TtsInflightLike;
}

export function attachTtsRoutes(registry: RouteRegistry, deps: TtsRouteDeps): void {
  registry.attachHandler('tts.voices', async (_req, res) => {
    try {
      const ttsCfg = (config.raw as any)?.media?.tts ?? {};
      const engine = deps.ttsRegistry().resolve(ttsCfg.engine);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        voices: engine.voices(),
        engine: engine.name,
        // 引擎档案（TTS）≠ runtime 能力位：字段名刻意不同（见 src/tts/types.ts）
        capabilities: engine.profile,
        engines: deps.ttsRegistry().list().map((e: any) => ({ name: e.name, source: e.source })),
        models: [
          { id: 'mimo-v2.5-tts', description: '预置音色语音合成（支持唱歌模式）' },
          { id: 'mimo-v2.5-tts-voicedesign', description: '文本描述定制音色' },
          { id: 'mimo-v2.5-tts-voiceclone', description: '音频样本复刻音色' },
        ],
        defaultVoice: ttsCfg.defaultVoice || '茉莉',
        defaultModel: ttsCfg.model || 'mimo-v2.5-tts',
      }));
    } catch (err: any) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  registry.attachHandler('tts.speak', async (req, res) => {
    try {
      if (!deps.ttsReady()) { res.writeHead(503); res.end(JSON.stringify({ error: 'TTS not initialized' })); return; }
      const body = JSON.parse(await readRouteBody(req));
      const text = typeof body?.text === 'string' ? body.text : '';
      if (!text.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'text is required' })); return; }
      const voice = typeof body?.voice === 'string' ? body.voice : undefined;
      const style = typeof body?.style === 'string' ? body.style : undefined;
      const ttsCfg: any = (config.raw as any)?.media?.tts ?? {};
      const ttsEngine = deps.ttsRegistry().resolve(ttsCfg.engine);
      const wav = await ttsEngine.synthesize(text, { voice, style });
      const artifactId = deps.putArtifact(`data:audio/wav;base64,${wav.toString('base64')}`);
      const baseUrl = `http://127.0.0.1:${config.server.apiPort}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        artifactId,
        voice: voice || ttsCfg.defaultVoice || '茉莉',
        mime: 'audio/wav',
        url: `${baseUrl}/a2a/artifacts/${artifactId}`,
      }));
    } catch (err: any) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  registry.attachHandler('tts.speakStream', async (req, res) => {
    if (!isLocalRequest(req)) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
    const body = JSON.parse(await readRouteBody(req));
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'text is required' })); return; }
    const voice = typeof body?.voice === 'string' ? body.voice : undefined;
    const style = typeof body?.style === 'string' ? body.style : undefined;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    try {
      const ttsCfg = (config.raw as any)?.media?.tts ?? {};
      const ttsEngine = deps.ttsRegistry().resolve(ttsCfg.engine);
      const abort = new AbortController();
      req.on('close', () => abort.abort());
      if (sessionId) {
        let inflightSet = deps.inflight.get(sessionId);
        if (!inflightSet) { inflightSet = new Set(); deps.inflight.set(sessionId, inflightSet); }
        inflightSet.add(abort);
        res.on('close', () => {
          inflightSet.delete(abort);
          if (inflightSet.size === 0) deps.inflight.delete(sessionId);
        });
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'x-tts-sample-rate': String(ttsEngine.profile.sampleRate),
      });
      const gen = streamSentences(ttsEngine, text, { voice, style }, abort.signal);
      for await (const chunk of gen) {
        if (abort.signal.aborted) break;
        res.write(`data: ${JSON.stringify({ data: chunk.pcm.toString('base64'), voice: voice || ttsCfg.defaultVoice || '茉莉' })}\n\n`);
      }
      if (!abort.signal.aborted) res.write('data: {"done":true}\n\n');
      res.end();
    } catch (err: any) {
      log.error(`[TTS] stream synthesis failed (engine=${(config.raw as any)?.media?.tts?.engine ?? 'mimo'}): ${err?.message || String(err)}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      } else {
        res.write(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
        res.end();
      }
    }
  });

  registry.attachHandler('tts.interrupt', async (req, res) => {
    if (!isLocalRequest(req)) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
    await handleTtsInterrupt(req, res, { inflight: deps.inflight as any });
  });
}
