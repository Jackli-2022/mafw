/**
 * opencode SDK 词表快照 —— 89 成员基线 + @v1 表处置覆盖（F6/N3 门禁）。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-mapping-audit.md §F6/F7/N3
 * 设计: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.7.1
 *
 * 三道闸：
 * ① 基线计数——SDK 升级带来 union 漂移时先红这里，强制重审两张方言表；
 * ② rename/drop 行的 native from 必须真实存在（N3 幽灵拼写错误在此现形；
 *    identity 行 from===to 是 canonical 收编词，豁免——词汇合法性由
 *    vocabulary-sync 钉扎）；
 * ③ union 全成员处置覆盖——任何未被 rename/identity/drop 覆盖的成员都会
 *    落 default-deny unmatched（监控噪音 + F6 处置未完成的信号）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPENCODE_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';

const SDK_TYPES = join(__dirname, '..', '..', '..', 'node_modules', '@opencode-ai', 'sdk', 'dist', 'v2', 'gen', 'types.gen.d.ts');

/** 解析 SDK Event union → wire 名全集（文本解析，不 import 类型）。 */
function parseSdkEventUnion(): string[] {
  const src = readFileSync(SDK_TYPES, 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('export type Event ='));
  if (!line) throw new Error('Event union not found in SDK types');
  const members = line
    .replace(/^export type Event =/, '')
    .replace(/;\s*$/, '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const wire: string[] = [];
  for (const m of members) {
    const re = new RegExp(`export type ${m} = \\{[\\s\\S]*?type: "([^"]+)"`);
    const hit = src.match(re);
    if (!hit) throw new Error(`wire name not found for union member ${m}`);
    wire.push(hit[1]);
  }
  return wire;
}

/** @v1 声明但不在 SDK union 的防御行（legacy 兼容 / runtime 原生信封）。 */
const DEFENSIVE_FROMS = new Set([
  'message.error',      // legacy 防御（2026-10-12 spec :30-31）
  'message.aborted',    // 同上
  'message.part.complete', // 同上
  'sync',               // runtime 原生信封（RUNTIME_NATIVE_DROPPED 同款）
]);

/** N3 幽灵名：drop 行写过的不存在事件（2026-10-21 审计埋葬证明）。 */
const N3_GHOSTS = ['session.next.tool.started', 'session.next.tool.updated', 'session.next.tool.ended'];

/** 经 transformEvent 处理的类型（identity 行排除、映射行不承载——Plan 2 Task 6
 *  message.updated 载荷 flat 翻转经 OPENCODE_TRANSFORM_EVENT 产 {message}）。 */
const TRANSFORM_HANDLED = new Set(['message.updated']);

describe('opencode SDK 词表快照（89 基线）', () => {
  const union = parseSdkEventUnion();

  it('union 恰好 89 成员且无重复（基线漂移 = SDK 升级需重审两张方言表）', () => {
    expect(union).toHaveLength(89);
    expect(new Set(union).size).toBe(89);
  });

  it('N3 幽灵名不在 union（过时 drop 行埋葬证明）', () => {
    for (const ghost of N3_GHOSTS) {
      expect(union).not.toContain(ghost);
    }
  });

  it('rename/drop 行的 native from 真实存在（identity 行 from===to 豁免）', () => {
    for (const row of OPENCODE_EVENT_MAPPINGS) {
      if (row.from === row.to) continue; // canonical identity 行
      const froms = Array.isArray(row.from) ? row.from : [row.from];
      for (const f of froms) {
        if (DEFENSIVE_FROMS.has(f)) continue;
        expect(union).toContain(f);
      }
    }
  });

  it('union 全成员处置覆盖：rename/identity 消费 ∪ drop = 89 全集（零 unmatched 漏网）', () => {
    const consumed = new Set<string>();
    const dropped = new Set<string>();
    for (const row of OPENCODE_EVENT_MAPPINGS) {
      const froms = Array.isArray(row.from) ? row.from : [row.from];
      for (const f of froms) {
        (row.to === 'drop' ? dropped : consumed).add(f);
      }
    }
    const undispositioned = union.filter((w) => !consumed.has(w) && !dropped.has(w) && !TRANSFORM_HANDLED.has(w));
    expect(undispositioned).toEqual([]);
  });
});
