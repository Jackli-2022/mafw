/**
 * plugin-check —— 离线插件检查器（spec 2026-10-31-runtime-plugin-ergonomics-design §4.5）。
 *
 * 不切换 active runtime、不需要 LLM 凭据：
 *   require 插件 → 形状校验 → 事件映射校验 → 声明矩阵 → 试实例化 →
 *   能力盖印/校验（validateRuntime）→ sampleEvents 试衣 → preset 缺面清单。
 *
 * 判定规则与 loader / activation 同源（event-declaration / capability-source）；
 * 在线 conformance（真实 LLM 往返）仍由 mafw plugin-test 承担。
 */
import * as path from 'path';
import { config } from '../config';
import { createRuntimePluginContext } from './loader';
import { applyEventMappings, canonicalTypeSet, validateEventMappings, type EventMappingEntry } from './event-mapper';
import { resolveEventDeclaration } from './event-declaration';
import { resolveDeclaredCapabilities, stampDeclaredCapabilities } from './capability-source';
import { validateRuntime } from './validate';
import { buildRuntimeContractManifest } from './contract-manifest';
import type { PresetId } from './contract-manifest-types';
import {
  auditPlugin,
  probeRuntimeApis,
  type AuditContract,
  type PluginAuditReport,
} from './plugin-audit';

export interface PluginCheckOptions {
  file: string;
  preset?: PresetId;
  strict?: boolean;
  /** 附加静态体检：eventMappings × 契约 JSON（翻错/缺结构/没输出/接口面）。 */
  audit?: boolean;
  /** 用外部契约占位（缺省 = contract-manifest 的内存投影）。 */
  contract?: AuditContract;
  /** 覆盖样例事件（如从 JSONL 抓包文件读入）；缺省用 module.exports.sampleEvents。 */
  events?: unknown[];
  /** 真调一次只读接口验返回形状（会触达外部 CLI/网络，超时归 skipped）。 */
  probe?: boolean;
  probeTimeoutMs?: number;
  /** 限定探针面（默认全部）；测试/CI 可用纯函数面子集避免外部依赖。 */
  probeSurfaces?: string[];
}

export interface PluginCheckReport {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  translation: { mode: 'declared' | 'self' | 'legacy-self'; issues: string[] };
  hard: string[];
  downgraded: string[];
  warnings: string[];
  preset: PresetId;
  /** false = preset 名未知或覆盖度未评估（避免「complete」假信息）。 */
  presetEvaluated: boolean;
  presetMissing: string[];
  samples?: {
    total: number;
    translated: number;
    suppressed: number;
    unmatched: number;
    invalid: number;
  };
  /** 可选静态体检报告（--audit；逐条事件 + 接口面）。 */
  audit?: PluginAuditReport;
}

const DEFAULT_PRESET: PresetId = 'conversation';
const PRESET_IDS = new Set<string>(buildRuntimeContractManifest().presets.map((p) => p.id));

export async function runPluginCheck(opts: PluginCheckOptions): Promise<PluginCheckReport> {
  const report: PluginCheckReport = {
    file: opts.file,
    status: 'ok',
    translation: { mode: 'declared', issues: [] },
    hard: [],
    downgraded: [],
    warnings: [],
    preset: opts.preset ?? DEFAULT_PRESET,
    presetEvaluated: false,
    presetMissing: [],
  };

  let mod: any;
  try {
    try {
      const resolved = require.resolve(opts.file);
      delete require.cache[resolved];
    } catch { /* first load */ }
    mod = require(opts.file);
  } catch (err: any) {
    report.status = 'error';
    report.error = `require failed: ${err?.message ?? String(err)}`;
    return report;
  }

  try {
    return await evaluate(mod, report, opts);
  } catch (err: any) {
    report.status = 'error';
    report.error = `check failed: ${err?.message ?? String(err)}`;
    return report;
  }
}

async function evaluate(mod: any, report: PluginCheckReport, opts: PluginCheckOptions): Promise<PluginCheckReport> {
  report.name = typeof mod?.name === 'string' ? mod.name : undefined;
  if (!report.name) {
    report.status = 'error';
    report.error = "missing 'name' export";
    return report;
  }
  if (typeof mod.createRuntime !== 'function') {
    report.status = 'error';
    report.error = "missing 'createRuntime(ctx)' export";
    return report;
  }

  const presetCandidate = String(opts.preset ?? mod.preset ?? DEFAULT_PRESET);
  if (!PRESET_IDS.has(presetCandidate)) {
    report.status = 'error';
    report.error = `unknown preset '${presetCandidate}' (choose ${[...PRESET_IDS].join('|')})`;
    return report;
  }
  report.preset = presetCandidate as PresetId;

  const entry: EventMappingEntry = {
    eventSource: mod.eventSource,
    eventMappings: Array.isArray(mod.eventMappings) ? mod.eventMappings : undefined,
    transformEvent: typeof mod.transformEvent === 'function' ? mod.transformEvent : undefined,
    ...(mod.eventTranslation === 'self' ? { eventTranslation: 'self' as const } : {}),
  };

  const canonical = canonicalTypeSet();
  const mappingIssues = validateEventMappings(entry, canonical);
  const capabilities = resolveDeclaredCapabilities(mod.capabilities);
  const declaration = resolveEventDeclaration(capabilities, entry);
  report.translation = { mode: declaration.mode, issues: [...mappingIssues, ...declaration.issues] };
  if (mappingIssues.length > 0 || !declaration.eventStream) capabilities.eventStream = false;
  if (report.translation.issues.length > 0) report.status = 'error';

  let rt: any;
  try {
    rt = await mod.createRuntime(createRuntimePluginContext(undefined, {
      gatewayPort: config.server.apiPort,
      rootDir: path.dirname(opts.file),
    }));
  } catch (err: any) {
    report.status = 'error';
    report.error = `createRuntime failed: ${err?.message ?? String(err)}`;
    return report;
  }

  stampDeclaredCapabilities(rt, capabilities);
  const validation = validateRuntime(rt, opts.file, {
    declaration: entry,
    plugin: {
      name: report.name,
      createRuntime: mod.createRuntime,
      external: mod.external !== false,
      capabilities,
    },
    source: 'active',
    declaredCapabilityKeys: Object.keys(mod.capabilities ?? {}),
  });
  report.hard = validation.hard;
  report.downgraded = validation.downgraded;
  report.warnings = validation.warnings;
  if (validation.hard.length > 0) report.status = 'error';
  const preset = validation.staticCoverage?.static.presets[report.preset];
  if (preset) {
    report.presetMissing = preset.missing;
    report.presetEvaluated = true;
  }

  if (Array.isArray(mod.sampleEvents)) {
    const samples = { total: 0, translated: 0, suppressed: 0, unmatched: 0, invalid: 0 };
    for (const raw of mod.sampleEvents) {
      samples.total += 1;
      const out = applyEventMappings(raw, entry, (t) => canonical.has(t), {
        onSuppressed: () => { samples.suppressed += 1; },
        onUnmatched: () => { samples.unmatched += 1; },
        onTranslationError: () => { samples.invalid += 1; },
      });
      for (const evt of out) {
        const type = evt?.payload?.type ?? evt?.type;
        if (typeof type === 'string' && canonical.has(type)) samples.translated += 1;
        else samples.invalid += 1;
      }
    }
    report.samples = samples;
  }

  if (opts.audit || opts.probe) {
    const audit = auditPlugin({
      entry,
      capabilities: capabilities as unknown as Record<string, unknown>,
      contract: (opts.contract ?? buildRuntimeContractManifest()) as unknown as AuditContract,
      preset: report.preset,
      samples: opts.events ?? (Array.isArray(mod.sampleEvents) ? mod.sampleEvents : undefined),
      runtimeValidation: {
        hard: validation.hard,
        downgraded: validation.downgraded,
        warnings: validation.warnings,
        surfaces: validation.staticCoverage?.static.surfaces,
      },
    });
    if (opts.probe) {
      audit.probes = await probeRuntimeApis(rt, {
        timeoutMs: opts.probeTimeoutMs,
        ...(opts.probeSurfaces ? { only: opts.probeSurfaces } : {}),
      });
      audit.summary.probesBad = audit.probes.filter((p) => p.status === 'error').length;
    }
    report.audit = audit;
  }

  return report;
}

export function pluginCheckExitCode(report: PluginCheckReport, strict?: boolean): number {
  if (report.status === 'error') return 1;
  if (report.hard.length > 0) return 1;
  // --audit 的错误（翻错/缺结构/接口面不一致）是门禁失败；未开 audit 时字段缺席。
  if (report.audit && report.audit.summary.errors > 0) return 1;
  if (report.audit?.probes?.some((p) => p.status === 'error')) return 1;
  if (strict && !report.presetEvaluated) return 1;
  if (strict && report.presetMissing.length > 0) return 1;
  if (report.samples && report.samples.total > 0 && report.samples.translated === 0) return 1;
  return 0;
}
