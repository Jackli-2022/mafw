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

export interface PluginCheckOptions {
  file: string;
  preset?: PresetId;
  strict?: boolean;
}

export interface PluginCheckReport {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  translation: { mode: 'declared' | 'self'; issues: string[] };
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

  return report;
}

export function pluginCheckExitCode(report: PluginCheckReport, strict?: boolean): number {
  if (report.status === 'error') return 1;
  if (report.hard.length > 0) return 1;
  if (strict && !report.presetEvaluated) return 1;
  if (strict && report.presetMissing.length > 0) return 1;
  if (report.samples && report.samples.total > 0 && report.samples.translated === 0) return 1;
  return 0;
}
