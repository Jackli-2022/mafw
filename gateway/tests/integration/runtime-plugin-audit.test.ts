/**
 * 真插件体检（用例即脚本）：加载 adapters/claude/dist/claude.js，
 *   1. 走 plugin-check：require → createRuntime → capability/preset 校验
 *   2. 走契约审计：eventMappings × runtime-contract.json + sampleEvents 逐条 trace
 *   3. 真调一次只读接口（纯函数面）验返回形状
 *
 * 换插件：MAFW_RUNTIME_PLUGIN_FILE=<path> npx jest tests/integration/runtime-plugin-audit.test.ts
 * 需要先构建插件产物（cd adapters/claude && npm run build）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { runPluginCheck } from '../../src/runtime/plugin-check';
import type { AuditContract } from '../../src/runtime/plugin-audit';

const repoRoot = path.resolve(__dirname, '../../..');
const pluginFile = path.resolve(
  process.env.MAFW_RUNTIME_PLUGIN_FILE ?? path.join(repoRoot, 'adapters/claude/dist/claude.js'),
);
const contractFile = path.join(repoRoot, 'packages/gateway-sdk/contract/runtime-contract.json');

/** 纯函数面：不 spawn CLI、不碰网络，CI 可稳定调用。 */
const PURE_PROBES = [
  'process.getBaseUrl',
  'process.healthCheck',
  'tools.nativeTools',
  'provider.list',
  'provider.app.agents',
  'provider.config',
];

const describeIfBuilt = fs.existsSync(pluginFile) ? describe : describe.skip;

describeIfBuilt('runtime plugin selftest (real adapter file)', () => {
  test('loads the plugin, translates its samples, and probes read-only APIs', async () => {
    const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8')) as AuditContract;
    const report = await runPluginCheck({
      file: pluginFile,
      preset: 'core',
      audit: true,
      contract,
      probe: true,
      probeSurfaces: PURE_PROBES,
      probeTimeoutMs: 2000,
    });

    // 人类可读摘要（测试即脚本：跑一次就能看到体检结论）
    const audit = report.audit!;
    // eslint-disable-next-line no-console
    console.log([
      `\n[plugin-audit] ${report.name}  contract=${audit.contractVersion}`,
      `  mappings: ${audit.mappings.mapped} mapped / ${audit.mappings.drop} drop`,
      `  samples : ${audit.summary.samplesOk} ok / ${audit.summary.samplesBad} bad-structure / ${audit.summary.samplesMissing} no-output`,
      ...audit.samples.map((s) =>
        `    ${s.outcome.padEnd(13)} ${s.label} -> ${s.outputs.map((o) => o.type).join(', ') || `no output (${s.reason})`}`),
      ...audit.findings.map((f) => `  [${f.severity}] ${f.where}: ${f.message}`),
      ...(audit.probes ?? []).map((p) => `  probe ${p.status.padEnd(7)} ${p.surface}${p.detail ? `: ${p.detail}` : ''}`),
    ].join('\n'));

    // 加载/校验/翻译声明本身必须干净
    expect(report.status).toBe('ok');
    expect(report.translation.issues).toEqual([]);
    expect(report.hard).toEqual([]);

    // 每条 sampleEvent 都必须产出 canonical 事件（没有输出是最贵的静默故障）
    expect(audit.samples).toHaveLength(2);
    expect(audit.samples.every((s) => s.outcome !== 'no-output')).toBe(true);

    // 映射目标必须是契约里的 canonical 类型（防词汇漂移）
    expect(audit.findings.filter((f) => f.kind === 'unknown-target')).toEqual([]);

    // 只读接口真调一遍：全部 ok（形状不对/方法缺失会在这里红）
    expect(audit.probes).toHaveLength(PURE_PROBES.length);
    expect((audit.probes ?? []).filter((p) => p.status !== 'ok')).toEqual([]);

    // 接口面视图：sessionApi 的 surface 清单来自契约（不是手写常量）
    const session = audit.capabilities.find((c) => c.capability === 'sessionApi');
    expect(session?.surfaces).toContain('session.list');
  }, 60_000);
});
