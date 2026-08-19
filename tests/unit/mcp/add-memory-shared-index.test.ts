import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleAddMemory } from '../../../gateway/src/mcp/handlers/add-memory';
import { MemoryService } from '../../../gateway/src/memory/service';

describe('handleAddMemory shared index visibility', () => {
  let tmpDir: string;
  let mafwDir: string;
  let memory: MemoryService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-addmem-'));
    mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    memory = new MemoryService(mafwDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('makes the written memory visible to the shared harmonic index immediately', async () => {
    const result = await handleAddMemory(
      {
        content: 'I live in Beijing and prefer sunny weather',
        memoryType: 'semantic',
        cueAnchors: ['location', 'weather'],
      },
      { memory, mafwDir } as any,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);

    // The shared index must see the memory immediately (without restarting gateway)
    const hits = memory.harmonicIndex.search('Beijing', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].primary_abstraction).toContain('I live in Beijing');

    // MCP search wrapper should also work
    const searchResult = memory.search('Beijing', 5);
    expect(searchResult).toHaveLength(1);
  });

  it('falls back to a private store when no shared memory context is provided', async () => {
    const result = await handleAddMemory(
      { content: 'fallback memory' },
      { mafwDir } as any,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);

    // OKF file should exist on disk
    const files = fs.readdirSync(path.join(mafwDir, 'memory', 'concepts', 'semantic'));
    expect(files.length).toBeGreaterThan(0);
  });
});
