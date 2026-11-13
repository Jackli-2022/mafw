/**
 * E7-4: mafw_add_memory must honor live disk pressure — a critical disk
 * rejects the write with a stable `disk_low` code before any store touch.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { handleAddMemory } from '../../../src/mcp/handlers/add-memory';

const mockWrite = jest.fn();
jest.mock('../../../src/memory/harmonic-file-store', () => ({
  HarmonicUnitFileStore: class {
    async write(unit: any) {
      mockWrite(unit);
    }
    markSuperseded() {
      return false;
    }
  },
}));

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-addmem-pressure-'));
}

const parse = (r: any) => JSON.parse(r.content[0].text);

const args = {
  content: 'disk gate content',
  memoryType: 'semantic',
  primaryAbstraction: 'disk gate',
  importance: 5,
};

beforeEach(() => mockWrite.mockClear());

describe('handleAddMemory disk pressure gate (E7-4)', () => {
  test('disk critical → disk_low, no store write', async () => {
    const dir = tmp();
    const res: any = await handleAddMemory(args, {
      mafwDir: dir,
      pressure: () => ({ disk: 'critical', degraded: [] }),
    } as any);

    expect(res.isError).toBe(true);
    expect(parse(res)).toMatchObject({ success: false, code: 'disk_low' });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  test('degraded disk_critical → disk_low, no store write', async () => {
    const dir = tmp();
    const res: any = await handleAddMemory(args, {
      mafwDir: dir,
      pressure: () => ({ disk: 'ok', degraded: ['disk_critical'] }),
    } as any);

    expect(res.isError).toBe(true);
    expect(parse(res)).toMatchObject({ success: false, code: 'disk_low' });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  test('disk ok → write proceeds', async () => {
    const dir = tmp();
    const res: any = await handleAddMemory(args, {
      mafwDir: dir,
      pressure: () => ({ disk: 'ok', degraded: [] }),
    } as any);

    expect(res.isError).toBeUndefined();
    expect(parse(res).success).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  test('pressure null (governor absent) → write proceeds', async () => {
    const dir = tmp();
    const res: any = await handleAddMemory(args, {
      mafwDir: dir,
      pressure: () => null,
    } as any);

    expect(res.isError).toBeUndefined();
    expect(parse(res).success).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  test('no pressure dep at all → write proceeds (back-compat)', async () => {
    const dir = tmp();
    const res: any = await handleAddMemory(args, { mafwDir: dir } as any);

    expect(res.isError).toBeUndefined();
    expect(parse(res).success).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  test('validation still wins over pressure (invalid memoryType reported first)', async () => {
    const dir = tmp();
    const res: any = await handleAddMemory(
      { ...args, memoryType: 'bogus' },
      { mafwDir: dir, pressure: () => ({ disk: 'critical', degraded: [] }) } as any,
    );

    expect(res.isError).toBe(true);
    const body = parse(res);
    expect(body.code).toBeUndefined();
    expect(body.error).toContain('Invalid memoryType');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
