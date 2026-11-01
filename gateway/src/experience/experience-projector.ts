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
  if (access) {
    // no-op until slice tasks
  }
  return actions;
}
