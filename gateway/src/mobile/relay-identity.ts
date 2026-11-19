import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import selfsigned from 'selfsigned';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export interface RelayIdentity {
  roomId: string;
  roomToken: string;
  routeSecret: string;
  host: string;
  roomUrl: string;
  certPem: string;
  keyPem: string;
  fingerprint: string;
}

interface StoredRoom {
  version: 1;
  roomId: string;
  roomToken: string;
  routeSecret: string;
  domain: string;
  host: string;
}

function base32(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function write0600(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function fingerprintCertificate(certPem: string): string {
  const cert = new crypto.X509Certificate(certPem);
  return crypto.createHash('sha256').update(cert.raw).digest('hex');
}

export function loadOrCreateRelayIdentity(
  dir: string,
  opts: { domain: string },
): RelayIdentity {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const roomPath = path.join(dir, 'room.json');
  const keyPath = path.join(dir, 'tls.key');
  const certPath = path.join(dir, 'tls.crt');

  if (fs.existsSync(roomPath)) {
    return loadExisting(roomPath, keyPath, certPath, opts.domain);
  }

  if (fs.existsSync(keyPath) || fs.existsSync(certPath)) {
    throw new Error('Invalid relay identity: certificate files exist without room.json');
  }

  const roomId = base32(crypto.randomBytes(16));
  const routeSecret = base32(crypto.randomBytes(16));
  const host = `${roomId}-${routeSecret}.${opts.domain}`;
  const roomToken = crypto.randomBytes(32).toString('hex');

  const pems = selfsigned.generate(
    [{ name: 'commonName', value: host }],
    {
      days: 3650,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: host }] }],
    },
  );

  const stored: StoredRoom = {
    version: 1,
    roomId,
    roomToken,
    routeSecret,
    domain: opts.domain,
    host,
  };
  write0600(roomPath, JSON.stringify(stored, null, 2));
  write0600(keyPath, pems.private);
  write0600(certPath, pems.cert);

  return {
    roomId,
    roomToken,
    routeSecret,
    host,
    roomUrl: `https://${host}`,
    certPem: pems.cert,
    keyPem: pems.private,
    fingerprint: fingerprintCertificate(pems.cert),
  };
}

function loadExisting(
  roomPath: string,
  keyPath: string,
  certPath: string,
  domain: string,
): RelayIdentity {
  let stored: StoredRoom;
  try {
    stored = JSON.parse(fs.readFileSync(roomPath, 'utf8')) as StoredRoom;
  } catch (err) {
    throw new Error(`Invalid relay identity: ${(err as Error).message}`);
  }

  if (stored?.version !== 1
    || typeof stored.roomId !== 'string'
    || typeof stored.roomToken !== 'string'
    || typeof stored.routeSecret !== 'string'
    || typeof stored.host !== 'string') {
    throw new Error('Invalid relay identity: room.json is missing fields');
  }
  if (stored.domain !== domain || stored.host !== `${stored.roomId}-${stored.routeSecret}.${domain}`) {
    throw new Error('Invalid relay identity: domain mismatch (re-pair required)');
  }
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    throw new Error('Invalid relay identity: certificate files are missing');
  }

  const keyPem = fs.readFileSync(keyPath, 'utf8');
  const certPem = fs.readFileSync(certPath, 'utf8');
  return {
    roomId: stored.roomId,
    roomToken: stored.roomToken,
    routeSecret: stored.routeSecret,
    host: stored.host,
    roomUrl: `https://${stored.host}`,
    certPem,
    keyPem,
    fingerprint: fingerprintCertificate(certPem),
  };
}
