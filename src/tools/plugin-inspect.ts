/**
 * `mafw_plugin_inspect` — read-only view of the public plugin contract.
 *
 * The Creator agent must never guess slots, widget fields or limits: this tool
 * answers from the shipped contract snapshot and the three existing read-only
 * gateway endpoints (`/api/plugins`, `/api/plugins/client`,
 * `/api/experience/actions`). It invokes no actions, writes no drafts and asks
 * for no approvals.
 *
 * Every payload is projected onto public fields only. Host-private data (the
 * runtime name, handlers, install paths, fingerprints) must not leak into the
 * model context: the projection whitelist is the boundary, not the gateway.
 */
import { z } from 'zod';
import { pluginGatewayGet, type PluginTool, type PluginToolContext } from './plugin-common';
import { PLUGIN_PUBLIC_CONTRACT } from './plugin-public-contract';

/** Hard ceiling for one inspect answer (UTF-8 bytes of the JSON output). */
export const MAX_INSPECT_OUTPUT_BYTES = 128 * 1024;

export const PLUGIN_INSPECT_QUERIES = [
  'clientDescriptors',
  'actions',
  'events',
  'slots',
  'widgetSchema',
  'package',
  'experience',
] as const;

export type PluginInspectQuery = typeof PLUGIN_INSPECT_QUERIES[number];

export interface PluginInspectArgs {
  query: PluginInspectQuery;
  packageName?: string;
}

// ------------------------------------------------------------ projections

const ACTION_FIELDS = [
  'name', 'title', 'description', 'inputSchema', 'outputSchema', 'timeoutMs',
] as const;

const EVENT_FIELDS = ['type', 'title', 'description', 'schema', 'scope'] as const;

const PANEL_FIELDS = ['id', 'title', 'icon', 'order', 'viewAction', 'refreshOn'] as const;

const TOOL_CARD_FIELDS = ['id', 'tools', 'override', 'viewAction'] as const;

const CONFIG_PAGE_FIELDS = [
  'id', 'title', 'schema', 'loadAction', 'saveAction', 'reloadOnSave',
] as const;

const MESSAGE_WINDOW_FIELDS = [
  'id', 'title', 'triggerEvent', 'viewAction', 'modal', 'dismissible',
] as const;

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function objects(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Copies only the declared keys (undefined is dropped, not serialized as null). */
function pick(source: Record<string, any>, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function projectDiagnostics(source: Record<string, any>): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const entry of objects(source.diagnostics)) {
    if (typeof entry.message !== 'string') continue;
    const item: Record<string, string> = {
      level: typeof entry.level === 'string' ? entry.level : 'info',
      message: entry.message,
    };
    if (typeof entry.code === 'string') item.code = entry.code;
    out.push(item);
  }
  const error = source.error;
  if (typeof error === 'string' && error.length > 0) {
    if (!out.some((item) => item.level === 'error' && item.message === error)) {
      out.push({ level: 'error', message: error });
    }
  }
  return out;
}

/** Public inventory row (`GET /api/plugins` packages[]). */
function projectInventory(row: Record<string, any> | undefined): Record<string, any> | null {
  if (!isRecord(row)) return null;
  return {
    name: typeof row.name === 'string' ? row.name : null,
    version: typeof row.version === 'string' ? row.version : null,
    status: typeof row.status === 'string' ? row.status : null,
    contributions: Array.isArray(row.contributions)
      ? row.contributions.filter((item: unknown) => typeof item === 'string')
      : [],
    // The gateway names the committed token `revision`; the public install
    // vocabulary calls it `activeRevision`.
    activeRevision: row.activeRevision ?? row.revision ?? null,
    pendingRevision: row.pendingRevision ?? null,
    diagnostics: projectDiagnostics(row),
  };
}

function projectUi(ui: unknown): Record<string, Array<Record<string, any>>> {
  const source = isRecord(ui) ? ui : {};
  return {
    panels: objects(source.panels).map((item) => pick(item, PANEL_FIELDS)),
    toolCards: objects(source.toolCards).map((item) => pick(item, TOOL_CARD_FIELDS)),
    configPages: objects(source.configPages).map((item) => pick(item, CONFIG_PAGE_FIELDS)),
    messageWindows: objects(source.messageWindows).map((item) => pick(item, MESSAGE_WINDOW_FIELDS)),
  };
}

/** Public client descriptor (`GET /api/plugins/client` plugins[]). */
function projectClientDescriptor(plugin: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {
    name: plugin.name ?? null,
    version: plugin.version ?? null,
    revision: plugin.revision ?? null,
    ui: projectUi(plugin.ui),
    actions: objects(plugin.actions).map((item) => pick(item, ACTION_FIELDS)),
    events: objects(plugin.events).map((item) => pick(item, EVENT_FIELDS)),
    diagnostics: projectDiagnostics(plugin),
  };
  if (typeof plugin.title === 'string') out.title = plugin.title;
  if (typeof plugin.description === 'string') out.description = plugin.description;
  return out;
}

function projectSnapshot(snapshot: any): {
  revision: string | null;
  plugins: Array<Record<string, any>>;
} {
  return {
    revision: typeof snapshot?.revision === 'string' ? snapshot.revision : null,
    plugins: objects(snapshot?.plugins).map(projectClientDescriptor),
  };
}

/** Removes one key at every depth (used to keep runtime names out of payloads). */
export function stripKeyDeep(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((item) => stripKeyDeep(item, key));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === key) continue;
    out[name] = stripKeyDeep(item, key);
  }
  return out;
}

// ------------------------------------------------------------- serializing

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Deterministic value: object keys are sorted so equal data serializes equal. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'function') return undefined;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      out[key] = stableValue(item);
    }
    return out;
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value)) ?? 'null';
}

/** UTF-8 safe prefix of at most `maxBytes` bytes. */
function sliceUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (byteLength(value) <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(value.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low);
}

export interface CappedOutput {
  output: string;
  truncated: boolean;
  bytes: number;
}

/**
 * Serializes a payload, replacing anything above `maxBytes` with a marker that
 * carries a preview. The marker keeps the output machine-readable: callers can
 * still parse it and branch on `truncated`.
 */
export function capInspectOutput(
  payload: unknown,
  maxBytes: number = MAX_INSPECT_OUTPUT_BYTES,
): CappedOutput {
  const full = stableJson(payload);
  const bytes = byteLength(full);
  if (bytes <= maxBytes) return { output: full, truncated: false, bytes };

  let budget = Math.floor(maxBytes / 2);
  for (;;) {
    const candidate = stableJson({
      truncated: true,
      bytes,
      limit: maxBytes,
      preview: sliceUtf8(full, budget),
    });
    if (byteLength(candidate) <= maxBytes || budget <= 0) {
      return { output: candidate, truncated: true, bytes };
    }
    budget = Math.floor(budget * 0.8) - 64;
    if (budget < 0) budget = 0;
  }
}

// ---------------------------------------------------------------- the tool

interface InspectResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}

function payloadResult(query: PluginInspectQuery, payload: unknown): InspectResult {
  const capped = capInspectOutput(payload);
  return {
    title: `插件契约：${query}`,
    output: capped.output,
    metadata: { query, bytes: capped.bytes, truncated: capped.truncated },
  };
}

function errorResult(query: string, message: string): InspectResult {
  return { title: `插件契约检查失败：${query}`, output: message, isError: true };
}

async function fetchSnapshot(ctx: PluginToolContext) {
  return projectSnapshot(await pluginGatewayGet('/api/plugins/client', ctx));
}

async function experiencePath(ctx: PluginToolContext): Promise<string> {
  const params = new URLSearchParams();
  if (ctx.sessionID) params.set('sessionID', ctx.sessionID);
  if (ctx.directory) params.set('directory', ctx.directory);
  const query = params.toString();
  return `/api/experience/actions${query ? `?${query}` : ''}`;
}

export const pluginInspectTool: PluginTool<PluginInspectArgs> = {
  description:
    '只读检查宿主公开插件契约：slots / widgetSchema / package / clientDescriptors / actions / events / experience。' +
    '返回内容来自真实契约快照与 gateway 只读端点；不执行动作、不写草稿、不需要审批。' +
    '生成或修改插件前先调用它，不要凭记忆猜 slot、widget 字段或限制。',
  args: {
    query: z.enum(PLUGIN_INSPECT_QUERIES).describe(
      '查询类型：slots=UI slot 名，widgetSchema=widget 类型与限制，package=单个包（需 packageName），' +
      'clientDescriptors=全部公开 client 描述符，actions/events=扁平动作/事件清单，experience=公开 Experience 动作',
    ),
    packageName: z.string().optional().describe('query=package 时的精确包名'),
  },
  async execute(args, ctx) {
    const query = args?.query;
    if (!PLUGIN_INSPECT_QUERIES.includes(query as PluginInspectQuery)) {
      return errorResult(String(query), `unknown query "${String(query)}"`);
    }

    try {
      switch (query as PluginInspectQuery) {
        case 'slots':
          return payloadResult('slots', {
            slots: PLUGIN_PUBLIC_CONTRACT.slots,
            widgets: PLUGIN_PUBLIC_CONTRACT.widgetTypes,
          });

        case 'widgetSchema':
          return payloadResult('widgetSchema', {
            widgets: PLUGIN_PUBLIC_CONTRACT.widgetTypes,
            limits: PLUGIN_PUBLIC_CONTRACT.limits,
            slots: PLUGIN_PUBLIC_CONTRACT.slots,
          });

        case 'clientDescriptors':
          return payloadResult('clientDescriptors', await fetchSnapshot(ctx));

        case 'actions': {
          const snapshot = await fetchSnapshot(ctx);
          return payloadResult('actions', {
            revision: snapshot.revision,
            actions: snapshot.plugins.flatMap((plugin) =>
              (plugin.actions as Array<Record<string, any>>).map((action) => ({
                package: plugin.name,
                ...action,
              }))),
          });
        }

        case 'events': {
          const snapshot = await fetchSnapshot(ctx);
          return payloadResult('events', {
            revision: snapshot.revision,
            events: snapshot.plugins.flatMap((plugin) =>
              (plugin.events as Array<Record<string, any>>).map((event) => ({
                package: plugin.name,
                ...event,
              }))),
          });
        }

        case 'package': {
          const name = typeof args.packageName === 'string' ? args.packageName : '';
          if (!name) return errorResult('package', 'packageName is required when query is "package"');
          const [inventory, snapshot] = await Promise.all([
            pluginGatewayGet('/api/plugins', ctx),
            fetchSnapshot(ctx),
          ]);
          const rows = objects((inventory as any)?.packages);
          const row = rows.find((item) => item.name === name);
          const descriptor = snapshot.plugins.find((item) => item.name === name);
          return payloadResult('package', {
            package: name,
            found: Boolean(row || descriptor),
            inventory: projectInventory(row),
            client: descriptor ?? null,
          });
        }

        case 'experience': {
          const body = await pluginGatewayGet(await experiencePath(ctx), ctx);
          return payloadResult('experience', stripKeyDeep(body, 'runtimeName'));
        }

        default:
          return errorResult(String(query), `unknown query "${String(query)}"`);
      }
    } catch (err: any) {
      // `pluginGateway*` already embeds the HTTP status in its message.
      return errorResult(String(query), err?.message ?? String(err));
    }
  },
};
