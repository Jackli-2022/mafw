/**
 * 预设：域/面的组合，不是新的层级。
 *
 * `requiredSurfaces` 从每个 surface 的 `presets` 反向索引派生，保证两处不会漂移；
 * 旧的 Tier 0/1/2 只做映射说明（spec §5.3）。
 */
import type { ContractPreset, PresetId } from './contract-manifest-types';
import { CORE_SURFACES } from './contract-surfaces-core';
import { AGENT_SURFACES } from './contract-surfaces-agent';

const ALL_SURFACES = [...CORE_SURFACES, ...AGENT_SURFACES];

function surfacesFor(id: PresetId): string[] {
  return ALL_SURFACES.filter((s) => (s.presets ?? []).includes(id)).map((s) => s.id);
}

export const CONTRACT_PRESETS: ContractPreset[] = [
  {
    id: 'core',
    title: 'Core（旧 Tier 0）',
    description: 'headless 协作/记忆 worker：会话 + prompt + tools + loader 元数据。',
    requiredSurfaces: surfacesFor('core'),
    capabilities: ['sessionApi', 'promptWhileBusy'],
  },
  {
    id: 'conversation',
    title: 'Conversation（旧 Tier 1）',
    description: '聊天流式 + prompt 用量：core + eventStream + turn/part 事件。',
    requiredSurfaces: surfacesFor('conversation'),
    capabilities: ['sessionApi', 'promptWhileBusy', 'eventStream'],
  },
  {
    id: 'autonomous',
    title: 'Autonomous（旧 Tier 1+）',
    description: 'goal 编排/自治执行：conversation + 审批/问答 + steer。',
    requiredSurfaces: surfacesFor('autonomous'),
    capabilities: ['sessionApi', 'promptWhileBusy', 'eventStream', 'steerApi', 'nativeApprovals', 'questionApi'],
  },
  {
    id: 'desktop',
    title: 'Desktop（旧 Tier 2）',
    description: '桌面完整：autonomous + 身份/发现/MCP/分支/provider/instructions。',
    requiredSurfaces: surfacesFor('desktop'),
    capabilities: [
      'sessionApi', 'promptWhileBusy', 'eventStream', 'steerApi', 'nativeApprovals', 'questionApi',
      'providerConfigApi', 'sessionStorageApi', 'agentConfigApi', 'completionApi',
      'sessionBranchApi', 'diffApi', 'worktreeApi', 'instructionsApi',
      'discoveryApi', 'mcpApi', 'mcpConfigApi', 'checkpointApi', 'runStateApi',
    ],
  },
];
