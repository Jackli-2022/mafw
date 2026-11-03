import type * as http from 'http';
import type { RouteRegistry } from './registry';
import { handlePods, type PodRouteDeps } from './pods';
import { handlePodCollaboration, type PodCollaborationDeps } from './pod-collaboration';
import { handlePodWork } from './pod-work';

/** Task 18：协作面（Tech Lead 讨论 / 方向 / 探针 / 打回 / revision 历史）。 */
const COLLABORATION_OPERATION_IDS = [
  'pods.goals.techLead',
  'pods.goals.techLead.messages',
  'pods.goals.direction',
  'pods.goals.probes',
  'pods.goals.probes.create',
  'pods.goals.reject',
  'pods.goals.revisions',
];

export function attachPodHandlers(
  registry: RouteRegistry,
  deps: PodRouteDeps,
  collaboration?: PodCollaborationDeps,
): void {
  const operationIds = [
    'pods.ensure',
    'pods.lookup',
    'pods.lead.ensure',
    'pods.create',
    'pods.get',
    'pods.update',
    'pods.tasks.list',
    'pods.tasks.create',
    'pods.tasks.update',
    'pods.tasks.delete',
    'pods.messages.list',
    'pods.messages.create',
    'pods.messages.read',
    'pods.messages.delivery.retry',
    'pods.messages.delivery.dismiss',
    'pods.wake',
    'pods.sleep',
    'pods.cost',
    'pods.goals',
    'pods.goals.create',
    'pods.goals.handoff',
    'pods.goals.cancel',
    'pods.goals.result',
    'pods.transcript',
    'pods.memory.get',
    'pods.memory.write',
  ];
  for (const operationId of operationIds) {
    registry.attachHandler(operationId, async (req, res) =>
      handlePods(req, res, req.url || '', deps));
  }
  registry.attachHandler('work.overview', async (req, res) => {
    if (!deps.goals.views) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'work overview unavailable' }));
      return true;
    }
    return handlePodWork(req, res, req.url || '', {
      pods: deps.pods,
      goals: { views: deps.goals.views },
    });
  });
  // 协作面始终登记 handler（catalog 覆盖率守卫要求），缺 deps 时中性 503。
  for (const operationId of COLLABORATION_OPERATION_IDS) {
    registry.attachHandler(operationId, async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!collaboration) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'pod collaboration unavailable' }));
        return true;
      }
      return handlePodCollaboration(req, res, req.url || '', collaboration);
    });
  }
}
