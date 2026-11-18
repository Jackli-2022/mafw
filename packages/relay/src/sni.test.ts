import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { parseClientHelloSni } from './sni.ts';

async function captureClientHello(servername?: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const server = net.createServer((socket) => socket.on('data', (chunk) => chunks.push(chunk)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  const client = tls.connect({
    host: '127.0.0.1',
    port,
    ...(servername ? { servername } : {}),
    rejectUnauthorized: false,
  });
  client.on('error', () => { /* server never completes the handshake */ });
  await new Promise((resolve) => setTimeout(resolve, 50));
  client.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return Buffer.concat(chunks);
}

test('parses SNI from a real ClientHello', async () => {
  const hello = await captureClientHello('room.example.com');
  assert.equal(parseClientHelloSni(hello), 'room.example.com');
});

test('parses the same hello when it arrives in arbitrary fragments', async () => {
  const hello = await captureClientHello('fragmented.example.com');
  for (const cut of [1, 2, 5, 7, hello.length - 1]) {
    const chunks = [hello.subarray(0, cut), hello.subarray(cut)];
    assert.equal(parseClientHelloSni(Buffer.concat(chunks)), 'fragmented.example.com');
  }
});

test('returns null without SNI or with a truncated record', async () => {
  const hello = await captureClientHello('room.example.com');
  const noSni = await captureClientHello();
  assert.equal(parseClientHelloSni(noSni), null);
  assert.equal(parseClientHelloSni(hello.subarray(0, 4)), null);
  assert.equal(parseClientHelloSni(hello.subarray(0, 12)), null);
});

test('returns null for a malformed handshake', () => {
  const notTls = Buffer.from('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n');
  assert.equal(parseClientHelloSni(notTls), null);
});
