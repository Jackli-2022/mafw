import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { X509Certificate } from 'crypto';
import { fingerprintCertificate, loadOrCreateRelayIdentity } from '../../../src/mobile/relay-identity';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-relay-id-'));
}

describe('relay identity', () => {
  it('creates a stable room + cert and reloads it', () => {
    const dir = tempDir();
    const first = loadOrCreateRelayIdentity(dir, { domain: 'relay.example.com' });
    const second = loadOrCreateRelayIdentity(dir, { domain: 'relay.example.com' });

    expect(second.roomId).toBe(first.roomId);
    expect(second.roomToken).toBe(first.roomToken);
    expect(second.routeSecret).toBe(first.routeSecret);
    expect(second.host).toBe(first.host);
    expect(second.roomUrl).toBe(`https://${first.host}`);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintCertificate(first.certPem)).toBe(first.fingerprint);

    const cert = new X509Certificate(first.certPem);
    expect(cert.subjectAltName || '').toContain(`DNS:${first.host}`);

    for (const file of ['room.json', 'tls.key', 'tls.crt']) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true);
      if (process.platform !== 'win32') {
        expect(fs.statSync(path.join(dir, file)).mode & 0o777).toBe(0o600);
      }
    }
  });

  it('does not regenerate a corrupt room.json', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'room.json'), '{');
    expect(() => loadOrCreateRelayIdentity(dir, { domain: 'relay.example.com' })).toThrow(/relay identity/i);
  });
});
