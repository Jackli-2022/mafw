import type { RuntimeAccess } from '../runtime/runtime-access';
import {
  EXPERIENCE_ACTION_IDS,
  type ActionDescriptor,
  type ExperienceActionId,
} from './experience-contract';

export interface ExperienceProjectionContext {
  sessionID?: string;
  busy?: boolean;
}

const unsupported = (): ActionDescriptor => ({ enabled: false, reason: 'unsupported' });

export function projectExperienceActions(
  access: RuntimeAccess | null,
  _ctx: ExperienceProjectionContext = {},
): Record<ExperienceActionId, ActionDescriptor> {
  const actions = Object.fromEntries(
    EXPERIENCE_ACTION_IDS.map((id) => [id, unsupported()]),
  ) as Record<ExperienceActionId, ActionDescriptor>;

  // 首批切片在后续任务点亮；这里保留唯一投影入口，避免前端自行推导。
  if (access?.can('branch.checkpoint')) {
    actions['checkpoint.restore'] = { enabled: true };
  }
  if (access?.can('session.background')) {
    actions['session.background'] = { enabled: true };
  }
  if (access?.can('prompt.delivery.steer')) {
    const semantics = access.semantics<{ boundary?: string }>('prompt.delivery.steer');
    actions['prompt.steer'] = {
      enabled: true,
      semantics: { boundary: semantics.boundary ?? 'unspecified', queue: true },
    };
  }
  return actions;
}
