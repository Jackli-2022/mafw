import type { MediaProvider } from '../../../src/kernel-v2/providers/media';
import type { PromptFn } from '../../../src/media/media-service';

/**
 * Test-package media provider. Registered with `registerMediaProvider(..., 'package')`
 * by the G2 test; no gateway core file changes are involved.
 */
export function createMediaEchoProvider(): MediaProvider {
  const prompt: PromptFn & { __label?: string } = async () => 'echo';
  prompt.__label = 'echo';
  return {
    id: 'echo',
    modalities: ['image'],
    prompt,
  };
}
