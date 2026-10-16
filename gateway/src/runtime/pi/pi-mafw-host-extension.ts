import {
  MEMORY_GUIDE, contentToText, buildRecallQuery,
  createCognitionClient, createRecallCursor,
} from '../host-adapter';
import type { MafwToolRegistration } from '../contract';

/**
 * mafw-host —— pi 认知面宿主扩展（HostAdapter 的 pi 实现，Phase 2/3）。
 *
 * 本文件是**薄事件映射层**：pi 事件 → HostAdapter 四动词，认知逻辑全部在
 * `runtime/host-adapter.ts`（契约核心 + CognitionClient）。六件套 spec/执行
 * 的单源在 `runtime/mafw-tools.ts`——经 runtime 契约 tools.registerTools 注入
 * toolFactory，本扩展只做注册桥接（T.Unsafe 翻译 + execute 包装）。
 *
 * 事件映射：observe→message_end/tool_result；injectContext→context；
 * injectSystem→before_agent_start；tools→registerTool ×6（gateway 单源 factory）。
 * ingestMedia 不在此（pi 原生 ImageContent + mafw-media wire 注入，§5.14）；
 * commands 不在此（gateway 命令注册表已 host-neutral，§5.13c）。
 */

export interface MafwHostDeps {
  sessionId: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** ESM 桥取 pi 同实例 typebox 的 Type（registerTool 需要 TSchema 实例） */
  getType?: () => Promise<any>;
  /** MAFW 基础工具 factory（runtime tools.registerTools 注入；gateway 单源） */
  toolFactory?: (sessionId: string) => MafwToolRegistration[];
}

/** 注入到 pi user 消息的 content（string→array 转换是 pi 形状特有）。 */
function appendRecall(userMsg: any, pointers: string): void {
  const part = { type: 'text', text: pointers, synthetic: true };
  if (typeof userMsg.content === 'string') {
    userMsg.content = [{ type: 'text', text: userMsg.content }, part];
  } else if (Array.isArray(userMsg.content)) {
    userMsg.content.push(part);
  } else {
    userMsg.content = [part];
  }
}

export function createMafwHostExtension(deps: MafwHostDeps) {
  const client = createCognitionClient({ sessionId: deps.sessionId, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
  const cursor = createRecallCursor();

  return {
    name: 'mafw-host' as const,
    on: (pi: any) => {
      // === observe：user/assistant 文本 + thinking ===
      pi.on('message_end', async (event: any) => {
        const msg = event?.message;
        if (!msg) return;
        if (msg.role === 'user') {
          client.observe('user_input', contentToText(msg.content));
        } else if (msg.role === 'assistant') {
          const arr = Array.isArray(msg.content) ? msg.content : [];
          const text = arr.filter((c: any) => c?.type === 'text').map((c: any) => c?.text || '').join('\n');
          const thinking = arr.filter((c: any) => c?.type === 'thinking').map((c: any) => c?.thinking || c?.text || '').join('\n');
          client.observe('assistant_reply', text);
          if (thinking.trim()) client.observe('reasoning', thinking);
        }
      });
      // === observe：工具结果（含 isError） ===
      pi.on('tool_result', async (event: any) => {
        const raw = event?.content;
        const text = Array.isArray(raw)
          ? raw.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
          : String(raw ?? '');
        client.observe('tool_result', `[${event?.toolName}]\n${text}`, Boolean(event?.isError));
      });
      // === injectContext：边界 recall（100ms 契约，fail-open） ===
      pi.on('context', async (event: any) => {
        const messages: any[] = Array.isArray(event?.messages) ? event.messages : [];
        if (messages.length === 0) return undefined;
        const real = messages.filter((m: any) => m && typeof m.role === 'string');
        if (real.length === 0) return undefined;
        const query = buildRecallQuery(real, cursor.next(real));
        if (query.trim()) {
          const pointers = await client.fetchRecallPointers(query);
          if (pointers) {
            const lastUser = [...real].reverse().find((m: any) => m.role === 'user');
            if (lastUser) appendRecall(lastUser, pointers);
          }
        }
        cursor.advance(real);
        return { messages };
      });
      // === injectSystem：memory-guide（静态）+ pinned profile（150ms fail-open） ===
      pi.on('before_agent_start', async (event: any) => {
        let extra = MEMORY_GUIDE;
        const profile = await client.fetchPinnedProfile();
        if (profile) extra += '\n\n' + profile;
        return { systemPrompt: `${event?.systemPrompt ?? ''}\n\n${extra}` };
      });
      // === tools：六件套（gateway 单源 factory；T.Unsafe 包 JSON Schema——Clone 产生
      //     新对象且 ~unsafe 键 non-enumerable 不入 wire；typebox 不可达 fail-open 跳过） ===
      void registerFactoryTools(pi, deps).catch(() => { /* 工具面缺失不阻塞会话 */ });
    },
  };
}

async function registerFactoryTools(pi: any, deps: MafwHostDeps): Promise<void> {
  const T = await (deps.getType ? deps.getType() : Promise.resolve(null));
  if (!T) return; // typebox 不可达 → fail-open 跳过注册
  const registrations = deps.toolFactory ? deps.toolFactory(deps.sessionId) : [];
  for (const r of registrations) {
    pi.registerTool({
      name: r.name,
      label: r.label,
      description: r.description,
      parameters: T.Unsafe(r.parameters),
      async execute(_id: string, params: any, signal: AbortSignal) {
        const out = await r.execute(params, signal);
        return out.isError
          ? { content: [{ type: 'text', text: out.text }], details: {}, isError: true }
          : { content: [{ type: 'text', text: out.text }], details: {} };
      },
    });
  }
}
