/**
 * Runtime 契约覆盖矩阵（Coverage Manifest）数据模型。
 *
 * 设计：docs/superpowers/specs/2026-10-30-runtime-contract-coverage-manifest-design.md
 *
 * 三轴：direction（谁调谁）× obligation（missing 会怎样）× domain（功能域）。
 * 清单是唯一事实源；JSON 是生成产物（emit-runtime-contract.ts）。
 */

export type ContractDirection = 'gateway->runtime' | 'runtime->gateway' | 'declaration';

export type ContractObligation = 'required' | 'gated' | 'optional' | 'advisory';

export type Verification = 'presence' | 'behavior' | 'conformance' | 'attested';

export type ContractDomain =
  | 'meta'
  | 'session'
  | 'prompt'
  | 'events'
  | 'tools'
  | 'approval'
  | 'identity'
  | 'discovery'
  | 'mcp'
  | 'branch'
  | 'process'
  | 'provider'
  | 'cognition'
  | 'media'
  | 'usage';

export type CapabilityKind = 'feature' | 'transport' | 'strategy' | 'trust' | 'informational';

export type PresetId = 'core' | 'conversation' | 'autonomous' | 'desktop';

export type SurfaceStatus = 'present' | 'missing' | 'unverified';

export interface ContractSurface {
  /** 稳定点号 id；发布后不可改名。 */
  id: string;
  title: string;
  direction: ContractDirection;
  domain: ContractDomain;
  obligation: ContractObligation;
  /** obligation='gated' 时必填。 */
  capability?: string;
  /** obligation='required' 时的 all-of capability 条件。 */
  requiredWhen?: { capabilities: string[] };
  verification: Verification;
  /** 人可读的实现位置：'session.update' 或 'POST /api/obs/capture'。 */
  implementation: string;
  /** 相对 ContractSubject.rt / .declaration / .plugin 的路径。 */
  probe?: string[];
  /** 确定性行为探针 id（不调 LLM）。 */
  behavior?: string;
  /** gateway 消费方。 */
  consumer: string;
  /** 缺失时用户失去什么。 */
  impact: string;
  /** conformance 场景 id。 */
  conformance?: string[];
  /** 期望该面的预设（反向索引；权威是 ContractPreset.requiredSurfaces）。 */
  presets?: PresetId[];
  /** gated 但不在 requires 中时，不产生 activation warning（只进覆盖率）。 */
  suppressWarning?: boolean;
  since?: string;
  deprecated?: boolean;
}

export interface ContractCapability {
  /** keyof RuntimeCapabilities。 */
  id: string;
  title: string;
  domain: ContractDomain;
  kind: CapabilityKind;
  /** minimalCapabilities() 的默认值。 */
  default: boolean;
  /** AND-group：缺任一 → 降级该能力（保留现有语义）。 */
  requires: string[];
  /** 该能力解锁的 surface；不参与降级判定。 */
  unlocks: string[];
  /** false/降级时的行为。 */
  degrade: string;
  degradeRule?: 'any-requires-missing' | 'none';
  presets?: PresetId[];
}

export type EventFamily =
  | 'lifecycle'
  | 'message'
  | 'tool'
  | 'approval'
  | 'question'
  | 'state'
  | 'usage'
  | 'compaction'
  | 'custom';

export interface ContractEvent {
  type: string;
  family: EventFamily;
  terminal?: boolean;
  requiredFields: string[];
  producers: Array<'runtime' | 'gateway' | 'host'>;
  consumers: string[];
  conformance?: string[];
}

export interface CognitionVerb {
  id: 'observe' | 'injectContext' | 'injectSystem' | 'tools' | 'gate' | 'rewrite';
  method: 'GET' | 'POST';
  path: string;
  timeoutMs: number;
  failOpen: string;
  requiredFields: string[];
  /** 哪些预设期望它（core 不要求）。 */
  presets: PresetId[];
  conformance?: string[];
}

export interface ContractPreset {
  id: PresetId;
  title: string;
  description: string;
  /** 该预设必须存在的面（权威）。 */
  requiredSurfaces: string[];
  /** 该预设必须声明为 true 的能力。 */
  capabilities: string[];
}

export interface RuntimeContractManifest {
  schemaVersion: 1;
  contractVersion: string;
  generatedFrom: 'gateway/src/runtime/contract-manifest.ts';
  domains: Array<{ id: ContractDomain; title: string; description: string }>;
  surfaces: ContractSurface[];
  capabilities: ContractCapability[];
  events: ContractEvent[];
  cognition: CognitionVerb[];
  presets: ContractPreset[];
}
