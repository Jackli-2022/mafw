/**
 * runtime 插件返回值"声明 vs 实现"一致性校验。
 *
 * 插件声明 sessionApi: true 却没实现 session.prompt 之类的错位，以前要到
 * 运行时深处才炸（报错点远离原因）；此校验在 createRuntime 出口给出字段级
 * 诊断（issues 每条携带 source 名），调用方据此回退内置 runtime。
 *
 * 只校验契约的核心必须面（sessionApi → session.{create,promptAsync,prompt,messages}、
 * eventStream → global.event）；可选方法（permissionReply/question/fork 等）
 * 不校验——契约语义是"缺失 → 对应能力降级"，不是错误。
 */
import type { AgentRuntime } from './contract';

const SESSION_REQUIRED_BY_SESSION_API = ['create', 'promptAsync', 'prompt', 'messages'] as const;

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateRuntimeShape(rt: AgentRuntime, source: string): string[] {
  if (!isObject(rt)) return [`${source}: runtime must be an object (got ${typeof rt})`];
  const issues: string[] = [];
  const caps = rt.capabilities;

  if (typeof rt.name !== 'string' || !rt.name) {
    issues.push(`${source}: runtime.name must be a non-empty string (got ${typeof rt.name})`);
  }
  if (!isObject(caps)) {
    issues.push(`${source}: runtime.capabilities must be an object (got ${typeof caps})`);
    return issues;
  }

  if (caps.sessionApi) {
    if (!isObject(rt.session)) {
      issues.push(`${source}: declares sessionApi but session is missing`);
    } else {
      for (const method of SESSION_REQUIRED_BY_SESSION_API) {
        if (typeof rt.session[method] !== 'function') {
          issues.push(`${source}: declares sessionApi but session.${method} is missing (not a function)`);
        }
      }
    }
  }
  if (caps.eventStream) {
    const ev = rt.global as any;
    if (!isObject(ev) || typeof ev.event !== 'function') {
      issues.push(`${source}: declares eventStream but global.event is missing (not a function)`);
    }
  }
  return issues;
}
