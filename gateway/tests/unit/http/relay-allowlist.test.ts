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
      ['GET', '/api/projects'],
      ['GET', '/api/projects/p1/work'],
      ['GET', '/api/projects/p1/pod/lookup'],
      ['POST', '/api/projects/p1/pod'],
      ['GET', '/api/sessions'],
      ['GET', '/api/sessions/s1/messages'],
      ['POST', '/api/session'],
      ['POST', '/api/chat'],
      ['POST', '/api/chat/enriched'],
      ['POST', '/api/pods/p1/goals'],
      ['POST', '/api/pods/p1/goals/handoff'],
      ['GET', '/api/pods/p1'],
      ['GET', '/api/pods/p1/goals'],
      ['GET', '/api/pods/p1/goals/g1/tech-lead'],
      ['POST', '/api/pods/p1/goals/g1/tech-lead/messages'],
      ['POST', '/api/pods/p1/goals/g1/direction-decision'],
      ['POST', '/api/pods/p1/goals/g1/reject'],
      ['GET', '/api/pods/p1/sessions/s1/transcript'],
      ['POST', '/api/mobile/devices/register'],
      ['POST', '/api/mobile/media/tasks'],
      ['POST', '/api/mobile/media/tasks/t1/ask'],
      ['GET', '/api/memory/search'],
      ['GET', '/api/memory/energy-distribution'],
      ['GET', '/api/goals/g1/plan'],
      ['GET', '/api/approvals'],
      ['POST', '/api/triage/t1/confirm'],
      ['GET', '/api/events/replay'],
      ['POST', '/api/mobile/pairing/verify'],
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
      ['GET', '/api/mobile/devices'],
      ['DELETE', '/api/mobile/devices/d1'],
      ['GET', '/api/approvals/allowlist'],
      ['POST', '/api/approvals/rules'],
      ['POST', '/api/goals/control'],
      ['POST', '/api/sessions/s1/permission-mode'],
      ['POST', '/api/sessions/s1/data'],
      ['POST', '/api/sessions/s1/diff/revert'],
      ['GET', '/api/sessions/s1/message'],
      ['GET', '/api/mobile/tts/artifacts/a1'],
      ['POST', '/api/tts'],
      ['GET', '/dashboard'],
      ['POST', '/register'],
      ['POST', '/control'],
      // traversal / encoded separators must never reach the runtime proxy
      ['POST', '/api/mobile/../../api/pty'],
      ['POST', '/api/projects/%2e%2e/api/pty'],
      ['POST', '/api/session/..%2f..%2fapi/pty'],
      ['POST', '/api/mobile/..\\..\\api\\pty'],
    ] as const) {
      expect(`${method} ${path}:${isRelayAllowed(method, path)}`).toBe(`${method} ${path}:false`);
    }
  });

  it('does not allow unknown routes by default', () => {
    expect(isRelayAllowed('GET', '/api/secret')).toBe(false);
    expect(isRelayAllowed('POST', '/')).toBe(false);
  });

  // Regression: the mobile work tab passes the whole project dir as ONE
  // percent-encoded segment (`Uri.encodeComponent(projectDir)`). On Windows
  // that is `C%3A%5Cwork%5Cproj`, on POSIX `%2Fhome%2Fu%2Fproj`. Rejecting
  // encoded separators outright turned every work-tab call into HTTP 403
  // over the relay (found on a real device, 2026-11-21).
  it('allows percent-encoded absolute project paths', () => {
    for (const [method, path] of [
      ['GET', '/api/projects/C%3A%5Cwork%5Cproj/work'],
      ['GET', '/api/projects/%2Fhome%2Fu%2Fproj/work'],
      ['GET', '/api/projects/C%3A%5Cwork%5Cproj/pod/lookup'],
      ['POST', '/api/projects/C%3A%5Cwork%5Cproj/pod'],
    ] as const) {
      expect(`${method} ${path}:${isRelayAllowed(method, path)}`).toBe(`${method} ${path}:true`);
    }
  });

  it('rejects traversal hidden inside an encoded project path', () => {
    for (const [method, path] of [
      ['GET', '/api/projects/..%5C..%5Capi%5Cpty/work'],
      ['GET', '/api/projects/..%2F..%2Fapi%2Fpty/work'],
      ['GET', '/api/projects/a%5C..%5C..%5Cb/work'],
      ['GET', '/api/projects/%2E%2E%2Fapi%2Fpty/work'],
      ['GET', '/api/projects/%2e%2e%5capi%5cpty/work'],
      ['GET', '/api/projects/..%5C..%5C..%5Cetc/work'],
    ] as const) {
      expect(`${method} ${path}:${isRelayAllowed(method, path)}`).toBe(`${method} ${path}:false`);
    }
  });
});
