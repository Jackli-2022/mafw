#!/usr/bin/env node
/**
 * M1 + M2 real-link e2e:
 *   M1 relay (built) <- WSS <- M2 gateway service <- TLS terminator <- target
 * A real TLS client connects to the relay with the Room SNI; the cert, marker
 * and HTTP response are asserted end-to-end.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const { createRelayServer } = require('../dist/server.js');
const { createRelayService } = require('../../../gateway/dist/mobile/relay-service.js');

const DOMAIN = 'relay.example.com';
const SECRET = 'a'.repeat(64);

async function main() {
  const target = http.createServer((req, res) => {
    assert.equal(req.headers['x-mafw-tunnel'], SECRET);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetPort = target.address().port;

  const relay = createRelayServer({
    domain: DOMAIN,
    listenHost: '127.0.0.1',
    tlsPort: 0,
    controlPort: 0,
    adminPort: 0,
  });
  await relay.start();
  const ports = relay.ports();

  const service = createRelayService({
    enabled: true,
    domain: DOMAIN,
    controlUrl: `ws://127.0.0.1:${ports.control}`,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-relay-e2e-')),
    targetPort,
    tunnelSecret: SECRET,
    localPort: 0,
  });
  const status = await service.start();
  assert.equal(status.enabled, true);
  assert.match(status.roomUrl, /^https:\/\/[a-z2-7]{26}-[a-z2-7]{26}\.relay\.example\.com$/);

  for (let i = 0; i < 100 && !service.status().connected; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(service.status().connected, true, 'gateway relay client did not connect');

  const host = new URL(status.roomUrl).hostname;
  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1',
      port: ports.tls,
      servername: host,
      path: '/api/presence',
      method: 'GET',
      rejectUnauthorized: false,
      headers: { host },
    }, (res) => {
      const tlsSocket = res.socket;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const cert = tlsSocket.getPeerCertificate();
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString(),
          fingerprint: crypto.createHash('sha256').update(cert.raw).digest('hex'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });

  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true, path: '/api/presence' });
  assert.equal(result.fingerprint, status.fingerprint);

  console.log('[relay-e2e] PASS', {
    roomUrl: status.roomUrl,
    tlsPort: ports.tls,
    controlPort: ports.control,
    fingerprint: status.fingerprint,
  });

  await service.stop();
  await relay.stop();
  await new Promise((resolve) => target.close(resolve));
}

main().catch((err) => {
  console.error('[relay-e2e] FAIL', err);
  process.exit(1);
});
