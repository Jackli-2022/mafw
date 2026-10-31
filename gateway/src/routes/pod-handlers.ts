import type { RouteRegistry } from './registry';
import { handlePods, type PodRouteDeps } from './pods';

export function attachPodHandlers(registry: RouteRegistry, deps: PodRouteDeps): void {
  const operationIds = [
    'pods.ensure',
    'pods.lookup',
    'pods.create',
    'pods.get',
    'pods.update',
    'pods.tasks.list',
    'pods.tasks.create',
    'pods.tasks.update',
    'pods.messages.list',
    'pods.messages.create',
    'pods.messages.read',
    'pods.wake',
    'pods.sleep',
    'pods.cost',
    'pods.goals',
    'pods.transcript',
    'pods.memory.get',
    'pods.memory.write',
  ];
  for (const operationId of operationIds) {
    registry.attachHandler(operationId, async (req, res) =>
      handlePods(req, res, req.url || '', deps));
  }
}
