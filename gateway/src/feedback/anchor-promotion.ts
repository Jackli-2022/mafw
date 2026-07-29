import * as fs from 'fs';
import * as path from 'path';

const QUEUE_FILE = '.suggested-anchors.json';
const REJECTED_FILE = '.suggested-anchors-rejected.json';

export interface Suggestion {
  unitId: string;
  anchor: string;
  ts: number;
}

export class AnchorPromotion {
  private baseDir: string;
  private rejected = new Set<string>();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.loadRejected();
  }

  private rejectedPath(): string {
    const dir = path.join(this.baseDir, 'memory');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, REJECTED_FILE);
  }

  private loadRejected(): void {
    const p = this.rejectedPath();
    if (fs.existsSync(p)) {
      const data: string[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
      this.rejected = new Set(data);
    }
  }

  private saveRejected(): void {
    fs.writeFileSync(this.rejectedPath(), JSON.stringify([...this.rejected], null, 2), 'utf-8');
  }

  private queuePath(): string {
    const dir = path.join(this.baseDir, 'memory');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, QUEUE_FILE);
  }

  getQueue(): Suggestion[] {
    const p = this.queuePath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }

  private saveQueue(queue: Suggestion[]): void {
    fs.writeFileSync(this.queuePath(), JSON.stringify(queue, null, 2), 'utf-8');
  }

  suggest(unitId: string, anchor: string): void {
    const key = `${unitId}:${anchor}`;
    if (this.rejected.has(key)) return;
    const queue = this.getQueue();
    if (queue.some(s => s.unitId === unitId && s.anchor === anchor)) return;
    queue.push({ unitId, anchor, ts: Date.now() });
    this.saveQueue(queue);
  }

  promote(unitId: string, anchor: string): void {
    const queue = this.getQueue().filter(s => !(s.unitId === unitId && s.anchor === anchor));
    this.saveQueue(queue);
  }

  reject(unitId: string, anchor: string): void {
    this.rejected.add(`${unitId}:${anchor}`);
    this.saveRejected();
    this.promote(unitId, anchor);
  }
}
