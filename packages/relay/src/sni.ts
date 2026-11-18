/**
 * Minimal TLS ClientHello SNI reader. The relay never terminates TLS: it reads
 * the first handshake record, extracts `server_name`, then forwards raw bytes.
 */
export const TLS_RECORD_HEADER_BYTES = 5;

const TLS_HANDSHAKE = 22;
const CLIENT_HELLO = 1;
const EXT_SERVER_NAME = 0;
const MAX_CLIENT_HELLO = 16 * 1024;

export function parseClientHelloSni(data: Buffer): string | null {
  if (!data || data.length < TLS_RECORD_HEADER_BYTES + 4) return null;
  if (data[0] !== TLS_HANDSHAKE) return null;

  const recordLength = data.readUInt16BE(3);
  if (recordLength <= 0 || recordLength > MAX_CLIENT_HELLO) return null;
  if (data.length < TLS_RECORD_HEADER_BYTES + recordLength) return null;

  const record = data.subarray(TLS_RECORD_HEADER_BYTES, TLS_RECORD_HEADER_BYTES + recordLength);
  if (record.length < 4 || record[0] !== CLIENT_HELLO) return null;

  const handshakeLength = record.readUIntBE(1, 3);
  if (handshakeLength <= 0 || record.length < 4 + handshakeLength) return null;

  let offset = 4;
  // legacy_version (2) + random (32)
  if (offset + 34 > record.length) return null;
  offset += 34;

  // session_id
  if (offset + 1 > record.length) return null;
  const sessionIdLength = record[offset];
  offset += 1;
  if (offset + sessionIdLength > record.length) return null;
  offset += sessionIdLength;

  // cipher_suites
  if (offset + 2 > record.length) return null;
  const cipherSuitesLength = record.readUInt16BE(offset);
  offset += 2;
  if (offset + cipherSuitesLength > record.length) return null;
  offset += cipherSuitesLength;

  // compression_methods
  if (offset + 1 > record.length) return null;
  const compressionLength = record[offset];
  offset += 1;
  if (offset + compressionLength > record.length) return null;
  offset += compressionLength;

  // extensions
  if (offset + 2 > record.length) return null;
  const extensionsLength = record.readUInt16BE(offset);
  offset += 2;
  const extensionsEnd = Math.min(record.length, offset + extensionsLength);

  while (offset + 4 <= extensionsEnd) {
    const type = record.readUInt16BE(offset);
    const length = record.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + length > extensionsEnd) return null;
    if (type === EXT_SERVER_NAME) {
      return parseServerName(record.subarray(offset, offset + length));
    }
    offset += length;
  }

  return null;
}

function parseServerName(data: Buffer): string | null {
  if (data.length < 2) return null;
  const listLength = data.readUInt16BE(0);
  let offset = 2;
  const end = Math.min(data.length, offset + listLength);

  while (offset + 3 <= end) {
    const type = data[offset];
    const length = data.readUInt16BE(offset + 1);
    offset += 3;
    if (offset + length > end) return null;
    if (type === 0) return data.subarray(offset, offset + length).toString('utf8');
    offset += length;
  }

  return null;
}
