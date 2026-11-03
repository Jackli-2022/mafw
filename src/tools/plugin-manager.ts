/**
 * `mafw_plugin_manager` — the only Creator tool that can run draft code or
 * mutate installed packages.
 *
 * Read-only operations (`list`/`status`/`descriptor`) answer from the existing
 * package endpoints and never prompt. Everything else is split in two:
 *
 * - code execution (`check`, `test`) and writes (`install`, `enable`,
 *   `disable`, `remove`, `reload`) pass through the host's native `ask`
 *   exactly once, through `approveCreatorOperation`;
 * - draft-backed operations (`check`/`test`/`install`) additionally fingerprint
 *   the draft before the prompt and re-hash it after, so content edited while
 *   the user is deciding aborts instead of installing something else.
 *
 * `applyPending` is intentionally absent: a staged candidate that owns the
 * active runtime is the user's decision in the Desktop Plugins page. The
 * installation itself stays with the Phase 1 `PackageManager` — this tool only
 * calls the existing REST surface.
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { approveCreatorOperation } from './plugin-approval';
import {
  pluginGatewayGet,
  pluginGatewayPost,
  type PluginTool,
  type PluginToolContext,
} from './plugin-common';
import {
  draftRoot,
  fingerprintDraft,
  readDraftManifest,
  resolveDraftDirectory,
  type DraftManifest,
} from './plugin-draft';
import { runDraftTests } from './plugin-test-runner';

export const PLUGIN_MANAGER_OPERATIONS = [
  'list',
  'status',
  'descriptor',
  'check',
  'test',
  'install',
  'enable',
  'disable',
  'remove',
  'reload',
] as const;

export type PluginManagerOperation = typeof PLUGIN_MANAGER_OPERATIONS[number];

const DRAFT_OPERATIONS: readonly PluginManagerOperation[] = ['check', 'test', 'install'];

/** Same grammar as a draft directory name; used for installed package names. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Full test log ceiling (the model only ever sees the capped runner output). */
const MAX_LOG_BYTES = 8 * 1024 * 1024;

export interface PluginManagerArgs {
  operation: PluginManagerOperation;
  /** Draft directory name under `<project>/.mafw/plugin-drafts/`. */
  draft?: string;
  /** Installed package name (read-only filters and package mutations). */
  packageName?: string;
  overwrite?: boolean;
  requestId?: string;
}

interface ManagerResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}

function jsonResult(
  title: string,
  payload: unknown,
  metadata: Record<string, unknown>,
  isError = false,
): ManagerResult {
  return {
    title,
    output: JSON.stringify(payload),
    metadata,
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(operation: string, message: string, metadata: Record<string, unknown> = {}): ManagerResult {
  return {
    title: `插件操作失败：${operation}`,
    output: message,
    metadata: { operation, ...metadata },
    isError: true,
  };
}

function optionalName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requirePackageName(args: PluginManagerArgs, operation: string): string {
  const name = optionalName(args?.packageName);
  if (!name) {
    throw new Error(`packageName is required for ${operation} (the installed package name)`);
  }
  if (!SAFE_NAME.test(name)) {
    throw new Error(`invalid packageName: expected one package name, got "${name}"`);
  }
  return name;
}

function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

// ------------------------------------------------------------ projections

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function diagnosticsOf(source: any): Array<{ level: string; message: string }> {
  const out: Array<{ level: string; message: string }> = [];
  for (const entry of Array.isArray(source?.diagnostics) ? source.diagnostics : []) {
    if (!entry || typeof entry.message !== 'string') continue;
    out.push({ level: typeof entry.level === 'string' ? entry.level : 'info', message: entry.message });
  }
  return out;
}

/** Public inventory row: no install path or content fingerprint. */
function projectPackage(row: any): Record<string, unknown> {
  return {
    name: typeof row?.name === 'string' ? row.name : null,
    version: typeof row?.version === 'string' ? row.version : null,
    status: typeof row?.status === 'string' ? row.status : null,
    enabled: row?.enabled === true,
    contributions: stringList(row?.contributions),
    activeRevision: row?.activeRevision ?? row?.revision ?? null,
    pendingRevision: row?.pendingRevision ?? null,
  };
}

function descriptorIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => (typeof item === 'string' ? item : item?.id))
      .filter((item): item is string => typeof item === 'string')
    : [];
}

function descriptorNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => item?.name)
      .filter((item): item is string => typeof item === 'string')
    : [];
}

function descriptorTypes(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => item?.type)
      .filter((item): item is string => typeof item === 'string')
    : [];
}

/** Compact descriptor: ids/names only, host-private fields dropped. */
function projectDescriptor(plugin: any): Record<string, unknown> {
  const ui = plugin?.ui && typeof plugin.ui === 'object' ? plugin.ui : {};
  return {
    name: typeof plugin?.name === 'string' ? plugin.name : null,
    version: typeof plugin?.version === 'string' ? plugin.version : null,
    revision: typeof plugin?.revision === 'string' ? plugin.revision : null,
    ...(typeof plugin?.title === 'string' ? { title: plugin.title } : {}),
    ...(typeof plugin?.description === 'string' ? { description: plugin.description } : {}),
    ui: {
      panels: descriptorIds(ui.panels),
      toolCards: descriptorIds(ui.toolCards),
      configPages: descriptorIds(ui.configPages),
      messageWindows: descriptorIds(ui.messageWindows),
    },
    actions: descriptorNames(plugin?.actions),
    events: descriptorTypes(plugin?.events),
    diagnostics: diagnosticsOf(plugin),
  };
}

// --------------------------------------------------------------- drafts

interface PreparedDraft {
  draft: string;
  directory: string;
  name: string;
  overwrite: boolean;
  fingerprint: string;
}

/** Resolve + manifest + fingerprint; nothing asks or calls HTTP here. */
async function prepareDraft(args: PluginManagerArgs, ctx: PluginToolContext): Promise<PreparedDraft> {
  const draft = optionalName(args?.draft);
  if (!draft) {
    throw new Error('draft is required (the directory name under .mafw/plugin-drafts)');
  }
  if (!ctx.directory) {
    throw new Error('session directory unavailable: cannot resolve the project draft root');
  }

  const directory = resolveDraftDirectory(ctx.directory, draft);
  const manifest: DraftManifest = readDraftManifest(directory, draft);
  const fingerprint = await fingerprintDraft(directory);
  return { draft, directory, name: manifest.name, overwrite: args?.overwrite === true, fingerprint };
}

function draftApprovalPattern(operation: 'check' | 'test' | 'install', prepared: PreparedDraft): string {
  const head = `${operation} ${prepared.name} draft=${prepared.draft}`;
  if (operation === 'install') {
    return `${head} overwrite=${prepared.overwrite} fp=${shortFingerprint(prepared.fingerprint)}`;
  }
  return `${head} fp=${shortFingerprint(prepared.fingerprint)}`;
}

/**
 * Asks once for one exact draft operation, then proves the draft did not move.
 *
 * Any content difference aborts: the approved prompt described the old bytes.
 */
async function approveDraft(
  operation: 'check' | 'test' | 'install',
  prepared: PreparedDraft,
  ctx: PluginToolContext,
): Promise<void> {
  await approveCreatorOperation(ctx, {
    operation,
    patterns: [draftApprovalPattern(operation, prepared)],
  });

  let after: string;
  try {
    after = await fingerprintDraft(prepared.directory);
  } catch (err: any) {
    throw new Error(`draft changed during approval: ${err?.message ?? String(err)}`);
  }
  if (after !== prepared.fingerprint) {
    throw new Error('draft changed during approval: the draft content differs from what was approved');
  }
}

// ------------------------------------------------------------ operations

async function listInventory(
  args: PluginManagerArgs,
  ctx: PluginToolContext,
  single: boolean,
): Promise<ManagerResult> {
  const requested = optionalName(args?.packageName);
  // Validate the query before spending a gateway request on it.
  if (single && !requested) {
    throw new Error('packageName is required for status (the installed package name)');
  }

  const inventory: any = await pluginGatewayGet('/api/plugins', ctx);
  const rows = Array.isArray(inventory?.packages) ? inventory.packages : [];
  const selected = requested ? rows.filter((row: any) => row?.name === requested) : rows;

  if (single) {
    if (selected.length === 0) {
      throw new Error(`package "${requested}" not found in the plugin inventory`);
    }
    return jsonResult(
      `插件状态：${requested}`,
      { package: projectPackage(selected[0]) },
      { operation: 'status', packageName: requested },
    );
  }

  return jsonResult(
    `插件清单：${selected.length} 个包`,
    { revision: inventory?.revision ?? null, packages: selected.map(projectPackage) },
    { operation: 'list', packageName: requested ?? null, count: selected.length },
  );
}

async function describePackage(
  args: PluginManagerArgs,
  ctx: PluginToolContext,
): Promise<ManagerResult> {
  const requested = optionalName(args?.packageName);
  if (!requested) {
    throw new Error('packageName is required for descriptor (the installed package name)');
  }

  const snapshot: any = await pluginGatewayGet('/api/plugins/client', ctx);
  const plugins = Array.isArray(snapshot?.plugins) ? snapshot.plugins : [];
  const match = plugins.find((plugin: any) => plugin?.name === requested);
  if (!match) {
    throw new Error(`package "${requested}" not found in the client snapshot`);
  }

  return jsonResult(
    `插件描述符：${requested}`,
    { revision: snapshot?.revision ?? null, package: projectDescriptor(match) },
    { operation: 'descriptor', packageName: requested },
  );
}

async function checkDraft(args: PluginManagerArgs, ctx: PluginToolContext): Promise<ManagerResult> {
  const prepared = await prepareDraft(args, ctx);
  await approveDraft('check', prepared, ctx);

  const result: any = await pluginGatewayPost('/api/plugins/check', { path: prepared.directory }, ctx);
  const ok = result?.ok === true;
  return jsonResult(
    `插件检查：${prepared.name}（${ok ? '通过' : '未通过'}）`,
    {
      ...(result && typeof result === 'object' ? result : {}),
      package: prepared.name,
      draft: prepared.draft,
      nextStep: ok
        ? '契约检查通过；继续 test 或请求用户批准安装。'
        : '契约检查未通过；按 diagnostics 修复草稿后重试。',
    },
    {
      operation: 'check',
      packageName: prepared.name,
      draft: prepared.draft,
      ok,
      fingerprint: shortFingerprint(prepared.fingerprint),
    },
    !ok,
  );
}

function installNextStep(result: any): string {
  if (result?.application === 'failed') {
    return `安装失败${result?.error ? `：${result.error}` : ''}；旧 revision 保持不变，修复草稿后用新的 requestId 重试。`;
  }
  if (result?.application === 'pending') {
    return '该包接管当前 active runtime，新 revision 处于 pending；请让用户在 Desktop Plugins 页执行 applyPending，模型工具不提供该操作。';
  }
  return '已安装并提交激活；Desktop 按 revision 局部更新，无需重启。请让用户在真实界面确认效果。';
}

async function installDraft(args: PluginManagerArgs, ctx: PluginToolContext): Promise<ManagerResult> {
  const prepared = await prepareDraft(args, ctx);
  await approveDraft('install', prepared, ctx);

  const requestId = optionalName(args?.requestId);
  const body: Record<string, unknown> = { path: prepared.directory };
  if (args?.overwrite !== undefined) body.overwrite = prepared.overwrite;
  // Only send an id the caller actually supplied: a synthesized key would let
  // a new iteration replay an older install result.
  if (requestId) body.requestId = requestId;

  const result: any = await pluginGatewayPost('/api/plugins/packages/install', body, ctx);
  const application = typeof result?.application === 'string' ? result.application : null;
  return jsonResult(
    `插件安装：${prepared.name}（${application ?? 'unknown'}）`,
    {
      ...(result && typeof result === 'object' ? result : {}),
      package: result?.name ?? prepared.name,
      draft: prepared.draft,
      nextStep: installNextStep(result),
    },
    {
      operation: 'install',
      packageName: result?.name ?? prepared.name,
      draft: prepared.draft,
      application,
      revision: result?.activeRevision ?? null,
      pendingRevision: result?.pendingRevision ?? null,
    },
    application === 'failed',
  );
}

async function runDraftTest(args: PluginManagerArgs, ctx: PluginToolContext): Promise<ManagerResult> {
  const prepared = await prepareDraft(args, ctx);
  await approveDraft('test', prepared, ctx);

  const chunks: string[] = [];
  let logBytes = 0;
  let logTruncated = false;
  const run = await runDraftTests(prepared.directory, {
    onChunk: (chunk: string) => {
      if (logBytes >= MAX_LOG_BYTES) {
        logTruncated = true;
        return;
      }
      chunks.push(chunk);
      logBytes += Buffer.byteLength(chunk, 'utf8');
      if (logBytes >= MAX_LOG_BYTES) logTruncated = true;
    },
  });

  let logPath: string | undefined;
  let logError: string | undefined;
  try {
    const logDir = path.join(draftRoot(ctx.directory!), '.logs');
    fs.mkdirSync(logDir, { recursive: true });
    const target = path.join(logDir, `${prepared.draft}.log`);
    const truncatedLog = logTruncated ? '\n[mafw] log truncated at the 8 MiB ceiling\n' : '';
    fs.writeFileSync(
      target,
      `# mafw draft test: ${prepared.draft}\n# node --test (cwd=${prepared.directory})\n\n` +
        chunks.join('') + truncatedLog,
      'utf-8',
    );
    logPath = target;
  } catch (err: any) {
    logError = err?.message ?? String(err);
  }

  const passed = !run.timedOut && run.exitCode === 0;
  const nextStep = run.timedOut
    ? '测试超时（60s）已被终止；缩小或修复测试后重试。'
    : passed
      ? '测试通过；这不等于沙箱隔离，安装仍需用户逐次批准。'
      : '测试未通过；按输出修复草稿后重试，当前没有任何安装发生。';

  return jsonResult(
    `插件测试：${prepared.name}（${run.timedOut ? '超时' : passed ? '通过' : '失败'}）`,
    {
      package: prepared.name,
      draft: prepared.draft,
      passed,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      truncated: run.truncated,
      ...(logPath ? { logPath } : {}),
      ...(logError ? { logError } : {}),
      output: run.output,
      nextStep,
    },
    {
      operation: 'test',
      packageName: prepared.name,
      draft: prepared.draft,
      truncated: run.truncated,
      timedOut: run.timedOut,
      exitCode: run.exitCode,
      ...(logPath ? { logPath } : {}),
    },
    !passed,
  );
}

async function mutatePackage(
  operation: 'enable' | 'disable' | 'remove' | 'reload',
  args: PluginManagerArgs,
  ctx: PluginToolContext,
): Promise<ManagerResult> {
  const name = requirePackageName(args, operation);
  await approveCreatorOperation(ctx, { operation, patterns: [`${operation} ${name}`] });

  let result: any;
  if (operation === 'enable' || operation === 'disable') {
    result = await pluginGatewayPost(`/api/plugins/${operation}`, { package: name }, ctx);
  } else if (operation === 'remove') {
    result = await pluginGatewayPost('/api/plugins/delete', { package: name }, ctx);
  } else {
    result = await pluginGatewayPost(`/api/plugins/${encodeURIComponent(name)}/reload`, undefined, ctx);
  }

  const application = typeof result?.application === 'string' ? result.application : null;
  const labels: Record<typeof operation, string> = {
    enable: '启用',
    disable: '禁用',
    remove: '删除',
    reload: '重载',
  };
  const nextStep = operation === 'remove'
    ? '已删除安装副本与 active 贡献；项目内的源草稿默认保留。'
    : operation === 'disable'
      ? '已禁用并清理其 active 贡献；源草稿与安装副本仍在。'
      : operation === 'reload'
        ? '已通过 staging/commit 重扫；接管 active runtime 的变更会保持 pending，需用户执行 applyPending。'
        : '已启用；接管 active runtime 的变更会保持 pending，需用户执行 applyPending。';

  return jsonResult(
    `插件${labels[operation]}：${name}（${application ?? 'unknown'}）`,
    {
      ...(result && typeof result === 'object' ? result : {}),
      package: result?.name ?? name,
      nextStep,
    },
    {
      operation,
      packageName: result?.name ?? name,
      application,
      revision: result?.activeRevision ?? result?.revision ?? null,
    },
    application === 'failed',
  );
}

async function dispatch(
  operation: PluginManagerOperation,
  args: PluginManagerArgs,
  ctx: PluginToolContext,
): Promise<ManagerResult> {
  switch (operation) {
    case 'list':
      return listInventory(args, ctx, false);
    case 'status':
      return listInventory(args, ctx, true);
    case 'descriptor':
      return describePackage(args, ctx);
    case 'check':
      return checkDraft(args, ctx);
    case 'test':
      return runDraftTest(args, ctx);
    case 'install':
      return installDraft(args, ctx);
    case 'enable':
    case 'disable':
    case 'remove':
    case 'reload':
      return mutatePackage(operation, args, ctx);
    default:
      // `applyPending` and anything else new stays out of the model surface.
      throw new Error(
        `unknown operation "${String(operation)}"; use one of ${PLUGIN_MANAGER_OPERATIONS.join(', ')}`,
      );
  }
}

export const pluginManagerTool: PluginTool<PluginManagerArgs> = {
  description:
    '管理项目内插件草稿与已安装的统一插件包。只读：list / status / descriptor。' +
    '执行草稿代码：check（宿主契约检查）/ test（固定 node --test）。写入：install / enable / disable / remove / reload。' +
    'check/test/install 需要 draft（.mafw/plugin-drafts 下的目录名，plugin.json 的 name 必须与目录名一致）；' +
    'enable/disable/remove/reload 需要 packageName。只读操作不提示；其余每次调用都会请求一次原生人工审批（full-access 会话按既有策略直接执行），' +
    '草稿内容在审批期间改变会中止。test 不是沙箱。applyPending 只能由用户在 Desktop Plugins 页执行，本工具不提供。',
  args: {
    operation: z.enum(PLUGIN_MANAGER_OPERATIONS).describe(
      'list=列出已安装包，status=单个包状态，descriptor=单个包公开描述符，check=草稿契约检查，' +
      'test=在草稿目录运行 node --test，install=安装草稿，enable/disable/remove/reload=管理已安装包',
    ),
    draft: z.string().optional().describe('草稿目录名（.mafw/plugin-drafts/<name>）；check/test/install 必填'),
    packageName: z.string().optional().describe('已安装包名；status/descriptor/enable/disable/remove/reload 必填'),
    overwrite: z.boolean().optional().describe('install 时覆盖同名已安装包（默认 false）'),
    requestId: z.string().optional().describe('install 幂等键；新的迭代必须使用新的随机 id，省略则不发送'),
  },
  async execute(args, ctx) {
    // `applyPending` is user-only. Reject it before any approval or HTTP even
    // when a caller smuggles it in beside another operation.
    if (String(args?.operation) === 'applyPending' || (args as any)?.applyPending) {
      return errorResult(
        'applyPending',
        'applyPending is user-only: 请让用户在 Desktop Plugins 页执行 applyPending；模型工具不提供该操作',
      );
    }

    const operation = args?.operation;
    if (!PLUGIN_MANAGER_OPERATIONS.includes(operation as PluginManagerOperation)) {
      return errorResult(
        String(operation),
        `unknown operation "${String(operation)}"; use one of ${PLUGIN_MANAGER_OPERATIONS.join(', ')}`,
      );
    }

    try {
      return await dispatch(operation as PluginManagerOperation, args, ctx);
    } catch (err: any) {
      // `pluginGateway*` already embeds the HTTP status in its message; draft
      // and approval errors are already actionable text.
      return errorResult(String(operation), err?.message ?? String(err), {
        packageName: optionalName(args?.packageName) ?? null,
        draft: DRAFT_OPERATIONS.includes(operation as PluginManagerOperation)
          ? optionalName(args?.draft) ?? null
          : null,
      });
    }
  },
};
