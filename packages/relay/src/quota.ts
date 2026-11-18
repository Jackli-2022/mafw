export interface QuotaOptions {
  roomsPerIpPerDay?: number;
  streamsPerRoom?: number;
  streamsPerIp?: number;
  roomMbps?: number;
  now?: () => number;
}

export class Quota {
  private readonly roomsPerIpPerDay: number;
  private readonly maxStreamsPerRoom: number;
  private readonly maxStreamsPerIp: number;
  private readonly bytesPerSecond: number;
  private readonly now: () => number;

  private readonly rooms = new Map<string, { day: number; count: number }>();
  private readonly roomStreams = new Map<string, number>();
  private readonly ipStreams = new Map<string, number>();
  private readonly bytes = new Map<string, { second: number; used: number }>();

  constructor(opts: QuotaOptions = {}) {
    this.roomsPerIpPerDay = opts.roomsPerIpPerDay ?? 5;
    this.maxStreamsPerRoom = opts.streamsPerRoom ?? 32;
    this.maxStreamsPerIp = opts.streamsPerIp ?? 8;
    this.bytesPerSecond = Math.floor(((opts.roomMbps ?? 2) * 1_000_000) / 8);
    this.now = opts.now ?? Date.now;
  }

  allowRoom(ip: string): boolean {
    const day = Math.floor(this.now() / 86_400_000);
    const bucket = this.rooms.get(ip);
    if (!bucket || bucket.day !== day) {
      this.rooms.set(ip, { day, count: 1 });
      return true;
    }
    if (bucket.count >= this.roomsPerIpPerDay) return false;
    bucket.count++;
    return true;
  }

  allowStream(roomId: string, ip: string): boolean {
    const roomCount = this.roomStreams.get(roomId) ?? 0;
    const ipCount = this.ipStreams.get(ip) ?? 0;
    if (roomCount >= this.maxStreamsPerRoom) return false;
    if (ipCount >= this.maxStreamsPerIp) return false;
    this.roomStreams.set(roomId, roomCount + 1);
    this.ipStreams.set(ip, ipCount + 1);
    return true;
  }

  releaseStream(roomId: string, ip: string): void {
    const roomCount = this.roomStreams.get(roomId) ?? 0;
    if (roomCount > 0) this.roomStreams.set(roomId, roomCount - 1);
    const ipCount = this.ipStreams.get(ip) ?? 0;
    if (ipCount > 0) this.ipStreams.set(ip, ipCount - 1);
  }

  allowBytes(roomId: string, bytes: number): boolean {
    const second = Math.floor(this.now() / 1000);
    const bucket = this.bytes.get(roomId);
    if (!bucket || bucket.second !== second) {
      if (bytes > this.bytesPerSecond) return false;
      this.bytes.set(roomId, { second, used: bytes });
      return true;
    }
    if (bucket.used + bytes > this.bytesPerSecond) return false;
    bucket.used += bytes;
    return true;
  }
}
