/**
 * OpencodeAdapter - 适配层，隔离上层代码与 opencode SDK 版本变化
 * 
 * 设计目标：
 * 1. 扁平参数：{ sessionID, parts } 而非 { path: { id }, body: { parts } }
 * 2. 自动解包：内部处理 result.data ?? result
 * 3. 便捷参数：message 自动转为 parts
 * 4. 统一接口：消除 v1 嵌套 vs langgraph 扁平两种风格
 */

// ─── 接口定义（单源在 runtime/contract.ts，此处仅转发保持兼容） ─────────────

import { serveAuthHeaders } from './serve-sidecar';
import type {
  RuntimeClient,
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
  NativeToolDeclaration,
} from './contract';
export type {
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
} from './contract';

/** @deprecated 等价于 RuntimeClient；保留别名避免下游改动。 */
export type OpencodeAdapter = RuntimeClient;

/** opencode 原生工具清单（tool-classes overlay 声明；调研表 2026-10-13）。 */
const OPENCODE_NATIVE_TOOLS: NativeToolDeclaration[] = [
  { name: 'read', toolClass: 'readonly' },
  { name: 'grep', toolClass: 'search' },
  { name: 'glob', toolClass: 'search' },
  { name: 'list', toolClass: 'search' },
  { name: 'write', toolClass: 'file-edit' },
  { name: 'edit', toolClass: 'file-edit' },
  { name: 'bash', toolClass: 'shell' },
  { name: 'shell', toolClass: 'shell' },
  { name: 'task', toolClass: 'subagent' },
  { name: 'webfetch', toolClass: 'web' },
  { name: 'todowrite', toolClass: 'plan' },
];

// ─── 工具函数 ───────────────────────────────────────────────

function unwrap<T>(result: any): T {
  const body = result?.data !== undefined ? result.data : result;
  // 2.1.0 统一响应信封 {data: X}（分页消息带 cursor；部分带 location）——body 仍是
  // 信封时再剥一层。判定收窄（键集 ⊆ {data, cursor, location}）避免误伤业务对象。
  // 2026-10-23 复现：漏掉 cursor 键 → messages 返回整信封对象而非数组 → 历史空。
  if (
    body && typeof body === 'object' && !Array.isArray(body) &&
    body.data !== undefined &&
    Object.keys(body).every(k => k === 'data' || k === 'cursor' || k === 'location')
  ) {
    return body.data as T;
  }
  return body as T;
}

/** 2.1.0 分页游标（body.cursor）——旧面在 X-Next-Cursor 响应头。 */
function unwrapCursor(result: any): string | undefined {
  const body = result?.data !== undefined ? result.data : result;
  if (body && typeof body === 'object' && typeof body.cursor === 'string' && body.cursor) {
    return body.cursor;
  }
  return undefined;
}

/** directNative 响应体解包：2.1.0 统一 {data:X}（可伴 cursor/location）信封。 */
function unwrapNative<T>(body: any): T {
  if (
    body && typeof body === 'object' && !Array.isArray(body) &&
    body.data !== undefined &&
    Object.keys(body).every((k) => k === 'data' || k === 'cursor' || k === 'location')
  ) {
    return body.data as T;
  }
  return body as T;
}

/** 契约 parts → 2.1.0 PromptInput body（text 必填；file 部件映射到 files.uri）。 */
function promptInputBody(parts: any[], opts?: { delivery?: string }): Record<string, unknown> {
  const texts: string[] = [];
  const files: Array<Record<string, unknown>> = [];
  const agents: Array<{ name: string }> = [];
  for (const p of parts ?? []) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text);
    else if (p.type === 'file' && typeof p.url === 'string') {
      files.push({ uri: p.url, ...(p.filename ? { name: p.filename } : {}) });
    } else if (p.type === 'agent' && typeof p.name === 'string' && p.name) {
      // 2.1.0 PromptInput.agents：@agent 提及载体（旧代码直接丢弃该部件）
      if (!agents.some((a) => a.name === p.name)) agents.push({ name: p.name });
    }
  }
  const body: Record<string, unknown> = { text: texts.join('\n') };
  if (files.length > 0) body.files = files;
  if (agents.length > 0) body.agents = agents;
  // gateway delivery 词汇 → 2.1.0 Session.Inbox.Delivery（steer|queue）
  if (opts?.delivery === 'steer') body.delivery = 'steer';
  else if (opts?.delivery === 'followup' || opts?.delivery === 'queue') body.delivery = 'queue';
  return body;
}

/** 2.1.0 用户消息的正文在 info.text（parts 恒空）——合成 text part 供 desktop 渲染。 */
function ensureUserTextPart(message: any): any {
  if (!message || typeof message !== 'object' || message.role !== 'user') return message;
  if (Array.isArray(message.content) && message.content.length > 0) return message;
  const text = typeof message.text === 'string'
    ? message.text
    : (typeof message.payload?.text === 'string' ? message.payload.text : undefined);
  if (typeof text !== 'string' || text.length === 0) return message;
  return { ...message, content: [{ type: 'text', text }] };
}
function ensurePartIds(message: any): any {  if (!message || typeof message !== 'object' || !Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((p: any, i: number) => {
    if (p && typeof p === 'object' && typeof p.id !== 'string') {
      changed = true;
      return { ...p, id: `${message.id ?? 'msg'}-p${i}` };
    }
    return p;
  });
  return changed ? { ...message, content } : message;
}

function messageToParts(message?: string, parts?: any[]): any[] {
  if (parts && parts.length > 0) return parts;
  if (message) return [{ type: 'text', text: message }];
  return [];
}

// ─── 适配层实现 ─────────────────────────────────────────────

export async function createOpencodeAdapter(config: { baseUrl: string; headers?: Record<string, string> }): Promise<OpencodeAdapter> {
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
  // 2.1.0 兼容（2026-10-22 事故第三层修复）：
  // ① API 全挂 /api 前缀——SDK 模板（/session/...）拼上 /api 后命中 2.1.0 路由；
  // ② serve 强制 Basic auth——headers 补 Authorization（serveAuthHeaders 单源，
  //    与 sidecar spawn 的 OPENCODE_SERVER_PASSWORD 同值；外部传入 headers 优先合并）。
  const buildSdkConfig = (base: string) => ({
    baseUrl: base.replace(/\/+$/, '') + '/api',
    headers: { ...serveAuthHeaders(), ...(config.headers ?? {}) },
  });
  let current = createOpencodeClient(buildSdkConfig(config.baseUrl));
  let clientBaseUrl = config.baseUrl;
  // URL 吸收：runtime 的 spawnServe 会把 sidecar 实际地址写回 config.baseUrl
  // （动态端口前提）。SDK 客户端内部持有构造期 config 快照，感知不到变更——
  // 每次访问按 baseUrl 惰性重建（幂等，无变更零开销）。directNative/
  // healthCheck 直读 config.baseUrl，天然跟随。
  const client = new Proxy(current, {
    get(_t, prop) {
      if (config.baseUrl !== clientBaseUrl) {
        clientBaseUrl = config.baseUrl;
        current = createOpencodeClient(buildSdkConfig(config.baseUrl));
      }
      return Reflect.get(current as object, prop, current as object);
    },
  }) as typeof current;

  // opencode 原生 V1 路由的 workspace 路由细节收敛在 adapter 内（契约保持
  // runtime 中立）——带 directory 的调用直连 fetch（V2 SDK 调用不带 workspace 语义）。
  // 2.1.0：directNative 同样走 /api 前缀 + Basic auth。
  const directNative = async (
    path: string,
    method: string,
    body?: any,
    directory?: string,
  ): Promise<any> => {
    const url = `${config.baseUrl}/api${path}${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`;
    const res = await fetch(url, {
      method,
      headers: {
        ...serveAuthHeaders(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(directory ? { 'x-opencode-directory': encodeURIComponent(directory) } : {}),
        ...(config.headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    } as any);
    if (!res.ok) throw new Error(`opencode native ${path} failed: ${res.status}`);
    try { return await res.json(); } catch { return null; }
  };

  /** 2.1.0 模型切换：Model.Ref = {id, providerID, variant?}（旧 {providerID,modelID} 会 400）。 */
  const switchModel = async (
    sessionID: string,
    model?: { providerID: string; modelID: string },
    variant?: string,
  ) => {
    if (!model) return;
    await directNative(`/session/${sessionID}/model`, 'POST', {
      model: {
        id: model.modelID,
        providerID: model.providerID,
        ...(variant ? { variant } : {}),
      },
    });
  };

  /** 2.1.0 form → desktop AskCard 契约（properties.questions[]）。 */
  const formCache = new Map<string, any>();
  const formToQuestion = (f: any) => {
    const fields = Array.isArray(f?.fields) ? f.fields.filter((x: any) => x && !x.hidden) : [];
    return {
      id: f?.id,
      sessionID: f?.sessionID,
      title: f?.title,
      metadata: f?.metadata,
      tool: f?.metadata?.tool,
      form: f,
      questions: fields.map((x: any) => ({
        id: x.key,
        question: x.title || x.key || 'Input',
        header: x.title,
        multiple: x.type === 'multiselect',
        custom: x.type === 'string' ? x.custom !== false : undefined,
        options: Array.isArray(x.options)
          ? x.options.map((o: any) => ({ label: o.label ?? o.value, value: o.value ?? o.label, description: o.description }))
          : x.type === 'boolean'
            ? [{ label: '是', value: 'true' }, { label: '否', value: 'false' }]
            : undefined,
      })),
      __fields: fields,
    };
  };
  const loadForms = async (directory?: string): Promise<any[]> => {
    // forms 列表按 location 过滤（location[directory] / x-opencode-directory）；
    // 无 directory 时 serve 只回默认 location 的 forms（通常为空）。
    const body = await directNative('/form', 'GET', undefined, directory);
    const list = unwrapNative<any[]>(body) ?? [];
    for (const f of list) if (f?.id) formCache.set(f.id, f);
    return list;
  };
  const findForm = async (id: string, directory?: string): Promise<any | undefined> => {
    const cached = formCache.get(id);
    if (cached) return cached;
    const list = await loadForms(directory);
    return list.find((f: any) => f?.id === id);
  };
  const formAnswerOf = (form: any, answers: string[][]): Record<string, unknown> => {
    const fields: any[] = Array.isArray(form?.fields) ? form.fields.filter((x: any) => x && !x.hidden) : [];
    const out: Record<string, unknown> = {};
    fields.forEach((f: any, i: number) => {
      const vals = Array.isArray(answers?.[i]) ? answers[i] : [];
      if (!f?.key) return;
      if (f.type === 'multiselect') out[f.key] = vals;
      else if (f.type === 'boolean') out[f.key] = /^(true|yes|on|1|是)$/i.test(vals[0] ?? '');
      else if (f.type === 'number' || f.type === 'integer') {
        const n = Number(vals[0]);
        out[f.key] = Number.isFinite(n) ? n : 0;
      } else out[f.key] = vals[0] ?? '';
    });
    return out;
  };

  return {
    session: {
      async create(opts: SessionCreateOpts) {
        // 2.1.0：POST /api/session 必须带 JSON body（无 body = 400），目录在
        // location 里；旧 SDK Session2.create 发 ?directory= 无 body → 400，
        // Manager session 创建因 id 缺失而失败（2026-10-23 实测）。
        const body = await directNative('/session', 'POST', {
          location: { directory: opts.directory },
        });
        return unwrapNative(body);
      },

      async promptAsync(opts: SessionPromptOpts) {
        // 2.1.0：POST /api/session/{id}/prompt（无 prompt_async），顶层 {text}
        // 立即返回（入队），回合进度走 /api/event。
        const parts = messageToParts(opts.message, opts.parts);
        if (opts.agent) await directNative(`/session/${opts.sessionID}/agent`, 'POST', { agent: opts.agent });
        await switchModel(opts.sessionID, opts.model, opts.variant);
        await directNative(
          `/session/${opts.sessionID}/prompt`,
          'POST',
          promptInputBody(parts, { delivery: opts.delivery }),
        );
      },

      async prompt(opts: SessionPromptOpts) {
        const parts = messageToParts(opts.message, opts.parts);
        if (opts.agent) await directNative(`/session/${opts.sessionID}/agent`, 'POST', { agent: opts.agent });
        await switchModel(opts.sessionID, opts.model, opts.variant);
        await directNative(
          `/session/${opts.sessionID}/prompt`,
          'POST',
          promptInputBody(parts, { delivery: opts.delivery }),
        );
        // 2.1.0：无阻塞式 prompt 响应；/wait 阻塞到会话 idle（204），再读最新
        // assistant 消息组装 PromptResultEnvelope。
        await directNative(`/experimental/session/${opts.sessionID}/wait`, 'POST');
        const listBody = await directNative(`/session/${opts.sessionID}/message?limit=20&order=desc`, 'GET');
        const list = unwrapNative<any[]>(listBody);
        const info = Array.isArray(list)
          ? list.find((m: any) => m?.type === 'assistant' || m?.role === 'assistant')
          : undefined;
        const t = info?.tokens;
        return {
          info,
          parts: Array.isArray(info?.content) ? info.content.map((p: any, i: number) =>
            (p && typeof p === 'object' && typeof p.id !== 'string' ? { ...p, id: `${info?.id ?? 'msg'}-p${i}` } : p),
          ) : [],
          finish: info?.finish,
          usage: t
            ? {
                input: t.input ?? 0,
                output: t.output ?? 0,
                cached: t.cache?.read ?? 0,
                reasoning: t.reasoning ?? 0,
                costUsd: typeof info?.cost === 'number' ? info.cost : undefined,
              }
            : undefined,
          error: info?.error
            ? {
                name: info.error.name ?? info.error.type ?? 'Error',
                message: info.error.data?.message ?? info.error.message ?? String(info.error),
              }
            : undefined,
        };
      },

      async messages(opts: SessionMessagesOpts) {
        const result = await client.session.messages({
          sessionID: opts.sessionID,
          limit: opts.limit,
          before: opts.before,
        });
        const raw = unwrap<any[]>(result);
        // 2.1.0 消息角色在 `type`（user/assistant）而非 `role`——desktop 对缺 role 的
        // message.updated 直接丢弃（chat-stream: !info?.role → return）。出口归一：
        // 仅补缺失 role，不覆盖既有；非角色型（system/compaction…）不硬映射。
        const data = Array.isArray(raw)
          ? raw
              .map((m: any) => {
                if (!m || typeof m !== 'object') return m;
                // role：仅补缺失（2.1.0 角色在 type；非角色型 system/compaction 不硬映射）
                const withRole = m.role !== undefined
                  ? m
                  : (m.type === 'user' || m.type === 'assistant' ? { ...m, role: m.type } : m);
                // 2.1.0 用户消息正文在 text（parts 空）→ 合成 text part；
                // canonical flat 契约：part 必须有 id（2.1.0 text/reasoning 部件无 id）
                return ensurePartIds(ensureUserTextPart(withRole));
              })
              // canonical 历史只允许 user|assistant：2.1.0 会混入 idle/synthetic 等
              // 非对话标记，混入会让 normalizeMessages 的 flat 守卫整体回退。
              .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'))
          : raw;
        // 2.1.0：游标在 body.cursor；旧面在 X-Next-Cursor 响应头——双读兜底
        const nextCursor = unwrapCursor(result) || result?.response?.headers?.get('X-Next-Cursor') || undefined;
        return { data, nextCursor };
      },

      async get(opts: { sessionID: string }) {
        const result = await client.session.get({
          sessionID: opts.sessionID,
        });
        return unwrap(result);
      },

      async delete(opts: { sessionID: string }) {
        const result = await client.session.delete({
          sessionID: opts.sessionID,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async update(opts: { sessionID: string; title: string }) {
        // v2 SDK signature is flat: { sessionID, title }
        const result = await client.session.update({
          sessionID: opts.sessionID,
          title: opts.title,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async abort(opts: { sessionID: string }) {
        // 2.1.0：/session/{id}/abort 已移除，中断路由为 /interrupt
        await directNative(`/session/${opts.sessionID}/interrupt`, 'POST');
      },

      async list(opts?: { directory?: string }) {
        const result = await client.session.list({
          directory: opts?.directory,
        });
        return unwrap<any[]>(result);
      },

      async todo(opts: { sessionID: string }) {
        // 2.1.0 无 /session/{id}/todo 路由——旧 serve 走 SDK，404/缺方法一律 fail-open 空列表
        try {
          return unwrap<any[]>(await client.session.todo({ sessionID: opts.sessionID })) ?? [];
        } catch {
          return [] as any[];
        }
      },

      async children(opts: { sessionID: string }) {
        // 2.1.0 无 /session/{id}/children 路由——fail-open 空列表
        try {
          return unwrap<any[]>(await client.session.children({ sessionID: opts.sessionID })) ?? [];
        } catch {
          return [] as any[];
        }
      },

      async summarize(opts: SessionSummarizeOpts) {
        // 2.1.0：summarize → /compact（shape: {id?, delivery?}）
        const result = await directNative(`/session/${opts.sessionID}/compact`, 'POST', {});
        return unwrapNative(result);
      },

      async fork(opts: { sessionID: string; messageID?: string }) {
        const result = await client.session.fork({
          sessionID: opts.sessionID,
          messageID: opts.messageID,
        });
        const session = unwrap<any>(result);
        return { id: session?.id };
      },

      async revert(opts: { sessionID: string; messageID: string; partID?: string }) {
        // 2.1.0：revert 改为两段式——stage（暂存边界，可 clear 撤销）+
        // commit（真正截断历史，不可逆）。旧 POST /session/{id}/revert 已 404。
        // files:true 对齐 v1 revert 的文件回滚语义（stage 响应列出将回滚的文件）。
        await directNative(`/session/${opts.sessionID}/revert/stage`, 'POST', {
          messageID: opts.messageID,
          files: true,
        });
        await directNative(`/session/${opts.sessionID}/revert/commit`, 'POST');
      },

      async unrevert(opts: { sessionID: string }) {
        // 2.1.0 无 unrevert（commit 不可逆）；DELETE /revert 只清未提交的暂存。
        // 桌面侧由 revertUndoApi=false 隐藏撤销入口，这里保留兼容调用。
        await directNative(`/session/${opts.sessionID}/revert`, 'DELETE');
      },

      async diff(opts: { sessionID: string; messageID?: string }) {
        const result = await client.session.diff({
          sessionID: opts.sessionID,
          ...(opts.messageID ? { messageID: opts.messageID } : {}),
        });
        return unwrap<any[]>(result) ?? [];
      },

      vcs: {
        async diff(opts?: { mode?: 'git' | 'branch' }) {
          const result = await client.vcs.diff({ mode: opts?.mode ?? 'git' });
          return unwrap<any[]>(result) ?? [];
        },
        async apply(opts: { patch: string }) {
          await client.vcs.apply({ patch: opts.patch });
        },
      },

      async permissionReply(
        sessionID: string,
        requestId: string,
        reply: 'once' | 'always' | 'reject',
        message?: string,
      ): Promise<boolean> {
        // 2.1.0：应答挂在 session 级（/api/session/{sid}/permission/{requestID}/reply，
        // body {decision, message?}，204）；旧顶层 /permission/{id}/reply 已 404。
        await directNative(
          `/session/${sessionID}/permission/${requestId}/reply`,
          'POST',
          { decision: reply, ...(message ? { message } : {}) },
        );
        return true;
      },

      question: {
        async list(opts?: { directory?: string }) {
          // 2.1.0 移除了 /question 路由：问询机制 = 全局 pending forms
          // （GET /api/form，形状与 /permission/request 同构）。映射成 desktop
          // AskCard 的 questions[] 契约；轮询 reconcile 仍然有效。
          try {
            const forms = await loadForms(opts?.directory);
            return forms.map(formToQuestion);
          } catch {
            return [] as any[];
          }
        },
        async reply(opts: { requestID: string; answers: string[][]; directory?: string }) {
          const form = await findForm(opts.requestID, opts.directory);
          if (!form?.id || !form?.sessionID) throw new Error(`form ${opts.requestID} not found`);
          await directNative(`/session/${form.sessionID}/form/${form.id}/reply`, 'POST', {
            answer: formAnswerOf(form, opts.answers),
          });
          formCache.delete(form.id);
        },
        async reject(opts: { requestID: string; directory?: string }) {
          const form = await findForm(opts.requestID, opts.directory);
          if (!form?.id || !form?.sessionID) return;
          await directNative(`/session/${form.sessionID}/form/${form.id}`, 'DELETE');
          formCache.delete(form.id);
        },
      },

      async permissionList(opts?: { directory?: string }) {
        // 2.1.0：permission 列表路由在 /api/permission/request（+directory query）；
        // 旧 /permission 已 404。返回形状 {location, data[]} — data 兼容提取。
        const data = await directNative('/permission/request', 'GET', undefined, opts?.directory);
        return Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
      },
    },

    global: {
      event() {
        // 2.1.0：SSE 流在 Event class（/event → /api/event，实测 200）；
        // Global class 的 /global/event 已 404（2026-10-22 事故第三层）
        return client.event.subscribe();
      },
    },

    provider: {
      async list() {
        // 2.1.0：/api/provider 只剩 integration 元数据（无 models/connected），
        // /api/model 独立返回模型清单、/api/credential 才是「已连接」权威、
        // /api/model/default 是默认模型。重建 desktop/SDK 期望的 legacy 信封
        // { all: [{...provider, models: {id: model}}], connected, default }。
        const [provBody, modelBody, credBody, defBody, integBody] = await Promise.all([
          directNative('/provider', 'GET').catch(() => null),
          directNative('/model', 'GET').catch(() => null),
          directNative('/credential', 'GET').catch(() => null),
          directNative('/model/default', 'GET').catch(() => null),
          directNative('/integration', 'GET').catch(() => null),
        ]);
        const providers = unwrapNative<any[]>(provBody) ?? [];
        const models = unwrapNative<any[]>(modelBody) ?? [];
        const integrations = unwrapNative<any[]>(integBody) ?? [];
        const creds: any[] = Array.isArray((credBody as any)?.data) ? (credBody as any).data : [];
        const def = unwrapNative<any>(defBody);
        const integrationName = new Map<string, string>();
        for (const i of integrations) if (i?.id) integrationName.set(i.id, i.name || i.id);

        const byProvider = new Map<string, Record<string, any>>();
        for (const m of models) {
          const pid = m?.providerID;
          const mid = m?.modelID ?? m?.id;
          if (!pid || !mid) continue;
          const bucket = byProvider.get(pid) ?? {};
          const input: string[] = Array.isArray(m.capabilities?.input) ? m.capabilities.input : [];
          const output: string[] = Array.isArray(m.capabilities?.output) ? m.capabilities.output : [];
          bucket[mid] = {
            id: mid,
            name: m.name || mid,
            limit: m.limit,
            capabilities: {
              input: { image: input.includes('image') },
              output: { image: output.includes('image') },
              reasoning:
                m.capabilities?.reasoning === true ||
                (Array.isArray(m.variants) && m.variants.some((v: any) => v?.settings?.reasoningEffort)),
            },
          };
          byProvider.set(pid, bucket);
        }

        const all = providers.map((p: any) => ({ ...p, models: byProvider.get(p?.id) ?? {} }));
        // sidecar 以 OPENCODE_CONFIG_CONTENT='{}' 启动时 /api/provider 为空
        // （2.1.0 用 inline config 覆盖了 config 定义，但模型目录仍在）——
        // 从 /api/model 的 providerID ∪ /api/integration 名称补齐。
        const known = new Map<string, any>();
        for (const p of all) if (p?.id) known.set(p.id, p);
        for (const pid of byProvider.keys()) {
          if (!known.has(pid)) {
            known.set(pid, { id: pid, name: integrationName.get(pid) ?? pid, models: byProvider.get(pid) });
          }
        }
        const merged = [...known.values()].map((p: any) => ({
          ...p,
          name: p.name || integrationName.get(p.id) || p.id,
          models: p.models ?? byProvider.get(p.id) ?? {},
        }));
        const connected = [...new Set(creds.filter((c) => c?.active !== false).map((c) => c?.integrationID))]
          .filter((id): id is string => typeof id === 'string' && merged.some((p: any) => p?.id === id));
        const defaultRef = def && (def.modelID || def.id) && def.providerID
          ? { providerID: def.providerID, modelID: def.modelID ?? def.id }
          : undefined;

        return { all: merged, connected, default: defaultRef ?? {} };
      },
    },

    app: {
      async agents() {
        // 2.1.0：agent 列表路由为 /api/agent（旧 /app/agent 404），返回 {location,data}
        const body = await directNative('/agent', 'GET');
        return unwrapNative<any[]>(body) ?? [];
      },
    },

    config: {
      async get() {
        const result = await client.config.get();
        return unwrap(result);
      },

      async update(config: any) {
        const result = await client.config.update({
          config,
        });
        return unwrap(result);
      },
    },

    // 工具注册通道（Tier-0 必选）：六件套由 v1 宿主插件承载（plugin-native 工具）
    // + MCP 面由自接线覆盖——通道已存在，spec 推送 = 通道确认（no-op ack）。
    tools: {
      async registerTools() {
        /* ack — tools hosted by v1 plugin + MCP self-wiring */
      },
      nativeTools() { return OPENCODE_NATIVE_TOOLS; },
    },
  };
}
