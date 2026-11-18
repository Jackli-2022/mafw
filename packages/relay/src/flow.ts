export class StreamWindow {
  private readonly initial: number;
  private remaining: number;

  constructor(initial: number) {
    if (!Number.isInteger(initial) || initial <= 0) throw new Error('window must be positive');
    this.initial = initial;
    this.remaining = initial;
  }

  available(): number {
    return this.remaining;
  }

  take(bytes: number): boolean {
    if (bytes < 0) return false;
    if (bytes > this.remaining) return false;
    this.remaining -= bytes;
    return true;
  }

  credit(bytes: number): void {
    if (bytes < 0) throw new Error('window credit must be positive');
    if (this.remaining + bytes > this.initial) throw new Error('window credit overflows initial window');
    this.remaining += bytes;
  }
}
