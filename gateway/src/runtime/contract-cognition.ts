/**
 * 认知面六动词（runtime -> gateway 的 loopback HTTP 义务）。
 *
 * 这些面不在 RuntimeCapabilities 里：它们是宿主侧义务，gateway 只能经
 * conformance 验证，不能靠 presence 探针。
 */
import type { CognitionVerb } from './contract-manifest-types';

export const CONTRACT_COGNITION: CognitionVerb[] = [
  {
    id: 'observe', method: 'POST', path: '/api/obs/capture', timeoutMs: 5_000,
    failOpen: '错误也返回 200，不阻塞 agent，不重试',
    requiredFields: ['sessionID', 'source', 'content'], presets: ['conversation', 'autonomous', 'desktop'],
    conformance: ['cognition-observe'],
  },
  {
    id: 'injectContext', method: 'GET', path: '/api/recall/context', timeoutMs: 100,
    failOpen: '超时/失败=null，直接调 LLM',
    requiredFields: ['sessionID', 'query'], presets: ['conversation', 'autonomous', 'desktop'],
    conformance: ['cognition-inject'],
  },
  {
    id: 'injectSystem', method: 'GET', path: '/api/recall/pinned + memory-guide', timeoutMs: 150,
    failOpen: '跳过 system 注入',
    requiredFields: [], presets: ['conversation', 'autonomous', 'desktop'],
    conformance: ['cognition-inject'],
  },
  {
    id: 'tools', method: 'POST', path: '/api/memory/add /api/python/* /api/tts /a2a', timeoutMs: 60_000,
    failOpen: '工具错误以文本返回，不抛异常',
    requiredFields: ['sessionID'], presets: ['conversation', 'autonomous', 'desktop'],
    conformance: ['tool-visibility'],
  },
  {
    id: 'gate', method: 'POST', path: '/api/cognition/gate', timeoutMs: 2_000,
    failOpen: '超时=fail-open allow',
    requiredFields: ['sessionID', 'kind'], presets: [],
    conformance: ['cognition-observe'],
  },
  {
    id: 'rewrite', method: 'POST', path: '/api/cognition/rewrite', timeoutMs: 2_000,
    failOpen: '超时=原样透传',
    requiredFields: ['sessionID', 'tool', 'input', 'output'], presets: [],
    conformance: ['cognition-observe'],
  },
];
