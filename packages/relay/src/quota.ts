export interface QuotaOptions {
  roomsPerIpPerDay?: number;
  streamsPerRoom?: number;
  streamsPerIp?: number;
  roomMbps?: number;
  globalMbps?: number;
  now?: () => number;
}

export class Quota {
  private readonly roomsPerIpPerDay: number;
  private readonly maxStreamsPerRoom: number;
  private readonly maxStreamsPerIp: number;
  private readonly bytesPerSecond: number;
  private readonly globalBytesPerSecond: number;
  private readonly now: () => number;

  private readonly rooms = new Map<string, { day: number; count: number }>();
  private readonly roomStreams = new Map<string, number>();
  private readonly ipStreams = new Map<string, number>();
  private readonly bytes = new Map<string, { second: number; used: number }>();
  private globalBytes: { second: number; used: number } = { second: -1, used: 0 };

  constructor(opts: QuotaOptions = {}) {
    this.roomsPerIpPerDay = opts.roomsPerIpPerDay ?? 5;
    this.maxStreamsPerRoom = opts.streamsPerRoom ?? 32;
    this.maxStreamsPerIp = opts.streamsPerIp ?? 8;
    this.bytesPerSecond = Math.floor(((opts.roomMbps ?? 2) * 1_000_000) / 8);
    this.globalBytesPerSecond = Math.floor(((opts.globalMbps ?? 4) * 1_000_000) / 8);
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
    const roomBucket = this.bytes.get(roomId);
    const roomUsed = roomBucket?.second === second ? roomBucket.used : 0;
    const globalUsed = this.globalBytes.second === second ? this.globalBytes.used : 0;

    if (bytes > this.bytesPerSecond - roomUsed) return false;
    if (bytes > this.globalBytesPerSecond - globalUsed) return false;

    this.bytes.set(roomId, { second, used: roomUsed + bytes });
    this.globalBytes = { second, used: globalUsed + bytes };
    return true;
  }

  stats(): { roomsToday: number; activeStreams: number } {
    const day = Math.floor(this.now() / 86_400_000);
    let roomsToday = 0;
    for (const bucket of this.rooms.values()) {
      if (bucket.day === day) roomsToday += bucket.count;
    }
    let activeStreams = 0;
    for (const count of this.roomStreams.values()) activeStreams += count;
    return { roomsToday, activeStreams };
  }
}
