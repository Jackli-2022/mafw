export type FrameType = 1 | 2 | 3;

export const FRAME_HEADER_BYTES = 10;
export const MAX_FRAME_PAYLOAD = 256 * 1024;

export interface Frame {
  type: FrameType;
  streamId: number;
  payload: Buffer;
}

const VALID_TYPES = new Set<number>([1, 2, 3]);

export function encodeFrame(frame: Frame): Buffer {
  if (!VALID_TYPES.has(frame.type)) throw new Error(`invalid frame type: ${frame.type}`);
  if (!Number.isInteger(frame.streamId) || frame.streamId <= 0 || frame.streamId > 0xffffffff) {
    throw new Error(`invalid stream id: ${frame.streamId}`);
  }
  if (frame.payload.length > MAX_FRAME_PAYLOAD) throw new Error(`frame payload too large: ${frame.payload.length}`);

  const out = Buffer.allocUnsafe(FRAME_HEADER_BYTES + frame.payload.length);
  out[0] = frame.type;
  out.writeUInt32BE(frame.streamId, 1);
  out[5] = 0;
  out.writeUInt32BE(frame.payload.length, 6);
  frame.payload.copy(out, FRAME_HEADER_BYTES);
  return out;
}

export function decodeFrame(buffer: Buffer): Frame {
  if (buffer.length < FRAME_HEADER_BYTES) throw new Error('frame too short');
  const type = buffer[0];
  if (!VALID_TYPES.has(type)) throw new Error(`invalid frame type: ${type}`);
  const streamId = buffer.readUInt32BE(1);
  const length = buffer.readUInt32BE(6);
  if (length > MAX_FRAME_PAYLOAD) throw new Error(`frame payload too large: ${length}`);
  if (buffer.length < FRAME_HEADER_BYTES + length) throw new Error('frame too short');
  return {
    type: type as FrameType,
    streamId,
    payload: buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length),
  };
}
