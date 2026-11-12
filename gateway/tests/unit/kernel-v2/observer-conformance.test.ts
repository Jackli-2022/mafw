import { CanonicalObserverRegistry } from '../../../src/kernel-v2/observer';
import { runObserverConformance } from '../../helpers/kernel-v2/observer-conformance';

runObserverConformance('observer', {
  create: () => new CanonicalObserverRegistry({ defaultTimeoutMs: 20, maxQueue: 10 }),
  maxQueue: 10,
});
