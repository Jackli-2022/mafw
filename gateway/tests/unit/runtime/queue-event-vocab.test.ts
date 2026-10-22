import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
const vocab = readFileSync(join(__dirname, '../../../src/runtime/mafw-vocabulary.ts'), 'utf8');
const sdkEvents = readFileSync(join(__dirname, '../../../../packages/gateway-sdk/src/events.ts'), 'utf8');
const tuiConn = readFileSync(join(__dirname, '../../../../packages/tui/src/store/connection.ts'), 'utf8');

describe('queue.updated 词汇四层守卫（C7）+ 事件发射 wiring（C8）', () => {
  it('词汇单源：MAFW map 含 queueUpdated', () => {
    expect(vocab).toMatch(/queueUpdated: 'queue\.updated'/);
  });
  it('SDK events union 含 queue.updated（守卫层 2）', () => {
    expect(sdkEvents).toContain('"queue.updated"');
  });
  it('TUI KNOWN_EVENTS 含 queue.updated（守卫层 4）', () => {
    expect(tuiConn).toContain("'queue.updated'");
  });
  it('emit 走 this.broadcast + mafwBroadcast（C8：骑回放持久化，Review Focus #4）', () => {
    expect(src).toMatch(/emitQueueUpdated/);
    expect(src).toMatch(/this\.broadcast\(mafwBroadcast\(\{\s*type: MAFW\.queueUpdated/);
  });
  it('发射点覆盖：enqueue / flush / cancel / clear / expire（≥5 调用）', () => {
    const hits = src.match(/emitQueueUpdated\(/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(5);
  });
  it('管理路由三条（GET/DELETE queue + DELETE queue/:itemId）', () => {
    expect(src).toContain('/queue(?:\\?|$)');
    expect(src).toContain('queueCancelMatch');
    expect(src).toContain('queueClearMatch');
    expect(src).toContain('queueListMatch');
  });
  it('route-catalog 登记 3 行', () => {
    const catalog = readFileSync(join(__dirname, '../../../src/routes/route-catalog.ts'), 'utf8');
    const hits = catalog.match(/queue/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
