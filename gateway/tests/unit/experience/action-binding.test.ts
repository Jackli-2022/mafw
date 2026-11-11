/**
 * E3-4：Experience action → catalog operationId 绑定。
 *
 * 每个已有 catalog 路由的动作必须在 `ActionDescriptor.operationId` 上声明其
 * operationId，且该 id 必须存在于 `buildRouteCatalog()`（交叉断言，防止映射表
 * 漂移）。没有路由的动作**不得**携带该字段（可选 = additive，不是占位）。
 */
import {
  EXPERIENCE_ACTION_IDS,
  type ExperienceActionId,
} from '../../../src/experience/experience-contract';
import {
  EXPERIENCE_ACTION_OPERATIONS,
  projectExperienceActions,
} from '../../../src/experience/experience-projector';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

const CATALOG_IDS = new Set(buildRouteCatalog().map((d) => d.operationId));
const MANIFEST_SURFACES = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));

/** 全部 surface 可用的假 access（只有 manifest 声明的 surface 会点亮）。 */
function fakeAccessAll() {
  return {
    can: (id: string) => MANIFEST_SURFACES.has(id),
    semantics: () => ({}),
  } as any;
}

const MAPPED = Object.keys(EXPERIENCE_ACTION_OPERATIONS) as ExperienceActionId[];

describe('E3-4: Experience action → operationId', () => {
  it('every mapped operationId exists in the catalog', () => {
    const missing = MAPPED.filter((id) => {
      const op = EXPERIENCE_ACTION_OPERATIONS[id];
      return !op || !CATALOG_IDS.has(op);
    });
    expect(missing).toEqual([]);
  });

  it('descriptors carry operationId ≡ mapping table (unsupported and supported alike)', () => {
    for (const access of [null, fakeAccessAll()]) {
      const actions = projectExperienceActions(access as any, {});
      for (const id of EXPERIENCE_ACTION_IDS) {
        expect(actions[id].operationId).toBe(EXPERIENCE_ACTION_OPERATIONS[id]);
      }
    }
  });

  it('actions without a route omit operationId', () => {
    const actions = projectExperienceActions(fakeAccessAll(), {});
    for (const id of EXPERIENCE_ACTION_IDS) {
      if (id in EXPERIENCE_ACTION_OPERATIONS) continue;
      expect(actions[id].operationId).toBeUndefined();
    }
  });

  it('at least one supported action is bound to a catalog operation', () => {
    const actions = projectExperienceActions(fakeAccessAll(), {});
    const bound = EXPERIENCE_ACTION_IDS
      .map((id) => actions[id])
      .filter((d) => d.supported && d.operationId);
    expect(bound.length).toBeGreaterThan(0);
    for (const d of bound) expect(CATALOG_IDS.has(d.operationId as string)).toBe(true);
  });
});
