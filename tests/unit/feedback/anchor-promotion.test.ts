import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AnchorPromotion } from '../../../gateway/src/feedback/anchor-promotion';

describe('AnchorPromotion', () => {
  let tmpDir: string;
  let promo: AnchorPromotion;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-'));
    promo = new AnchorPromotion(tmpDir);
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('suggest adds a candidate', () => {
    promo.suggest('mem_001', 'timeout');
    const queue = promo.getQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].anchor).toBe('timeout');
  });

  test('promote removes from queue', () => {
    promo.suggest('mem_001', 'timeout');
    promo.promote('mem_001', 'timeout');
    expect(promo.getQueue().length).toBe(0);
  });

  test('reject prevents re-suggestion', () => {
    promo.suggest('mem_001', 'timeout');
    promo.reject('mem_001', 'timeout');
    promo.suggest('mem_001', 'timeout');
    expect(promo.getQueue().length).toBe(0);
  });
});
