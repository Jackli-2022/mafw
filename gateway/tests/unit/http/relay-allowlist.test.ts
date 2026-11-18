/**
 * M0: the relay principal gets the mobile surface only. Desktop-only routes
 * (terminal, python, tools, cognition, A2A, media upload, admin) stay closed
 * even though the socket is loopback.
 */
import { isRelayAllowed } from '../../../src/http/relay-allowlist';

describe('relay allowlist (M0)', () => {
  it('allows the mobile read/write surface', () => {
    for (const [method, path] of [
      ['GET', '/health'],
      ['GET', '/api/presence'],
      ['GET', '/api/projects/p1/work'],
      ['POST', '/api/session'],
      ['GET', '/api/sessions'],
      ['POST', '/api/chat/enriched'],
      ['GET', '/api/memory/search'],
      ['GET', '/api/memory/energy-distribution'],
      ['GET', '/api/pods/p1/goals'],
      ['GET', '/api/goals/g1/plan'],
      ['GET', '/api/approvals'],
      ['POST', '/api/triage/t1/confirm'],
      ['GET', '/api/events/replay'],
      ['POST', '/api/mobile/pairing/verify'],
      ['GET', '/api/mobile/devices'],
      ['POST', '/api/mobile/media/tasks'],
      ['GET', '/api/tts/voices'],
      ['GET', '/api/ws'],
    ] as const) {
      expect(`${method} ${path}:${isRelayAllowed(method, path)}`).toBe(`${method} ${path}:true`);
    }
  });

  it('denies desktop-only and privileged surfaces', () => {
    for (const [method, path] of [
      ['POST', '/a2a'],
      ['GET', '/api/terminal/sessions'],
      ['POST', '/api/python/execute'],
      ['POST', '/api/tools/execute'],
      ['POST', '/api/cognition/gate'],
      ['POST', '/api/media/upload'],
      ['POST', '/api/media/upload-and-create'],
      ['GET', '/api/file-history'],
      ['GET', '/api/mcp/servers'],
      ['GET', '/api/plugins'],
      ['GET', '/api/config'],
      ['POST', '/api/human-token/rotate'],
      ['GET', '/api/devices'],
      ['POST', '/api/mobile/pairing-code'],
      ['POST', '/api/mobile/remote-access'],
      ['GET', '/api/mobile/tts/artifacts/a1'],
      ['POST', '/api/tts'],
      ['GET', '/dashboard'],
      ['POST', '/register'],
      ['POST', '/control'],
    ] as const) {
      expect(`${method} ${path}:${isRelayAllowed(method, path)}`).toBe(`${method} ${path}:false`);
    }
  });

  it('does not allow unknown routes by default', () => {
    expect(isRelayAllowed('GET', '/api/secret')).toBe(false);
    expect(isRelayAllowed('POST', '/')).toBe(false);
  });
});
