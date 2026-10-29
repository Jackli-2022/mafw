import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodMemoryService } from '../../../src/core/pod/pod-memory-service';
import { PodError } from '../../../src/core/pod/pod-store';

describe('PodMemoryService', () => {
  let root: string;
  let nowValue: string;
  let service: PodMemoryService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-memory-'));
    nowValue = '2026-10-29T12:00:00.000Z';
    service = new PodMemoryService({ memoryRoot: root, now: () => nowValue });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('ensurePodMemory creates POD.md, POD_MEMORY.md, and glossary.md', () => {
    service.ensurePodMemory('pod_1', 'Project Alpha');
    const dir = service.memoryDir('pod_1');

    for (const file of ['POD.md', 'POD_MEMORY.md', 'glossary.md']) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, 'POD.md'), 'utf-8')).toContain('Project Alpha');
    expect(fs.readFileSync(path.join(dir, 'POD_MEMORY.md'), 'utf-8')).toContain('Decisions');
  });

  test('renderContext returns a bounded, path-free block with node label', () => {
    service.ensurePodMemory('pod_1', 'Project Alpha');
    const context = service.renderContext('pod_1', 'execute');

    expect(context).toContain('[POD CONTEXT]');
    expect(context).toContain('Node: execute');
    expect(context).toContain('Project Alpha');
    expect(context).toContain('Decisions');
    expect(context!.length).toBeLessThanOrEqual(4096);
    expect(context).not.toContain(root);
  });

  test('renderContext returns null when all memory files are missing', () => {
    expect(service.renderContext('pod_missing', 'plan')).toBeNull();
  });

  test('renderContext truncates oversized memory deterministically', () => {
    service.ensurePodMemory('pod_1', 'Project Alpha');
    fs.writeFileSync(
      path.join(service.memoryDir('pod_1'), 'POD_MEMORY.md'),
      `# Pod Memory\n\n${'x'.repeat(10_000)}`,
      'utf-8',
    );

    const first = service.renderContext('pod_1', 'review');
    const second = service.renderContext('pod_1', 'review');

    expect(first!.length).toBeLessThanOrEqual(4096);
    expect(first).toBe(second);
  });

  test('captureGoal writes a decision record and returns its path', () => {
    service.ensurePodMemory('pod_1', 'Project Alpha');
    const file = service.captureGoal('pod_1', {
      goalId: 'g1',
      ok: false,
      reviewFeedback: 'tests failed',
      receiptPath: '/tmp/receipt.json',
    });

    expect(file).toBe(path.join(service.memoryDir('pod_1'), 'decisions', '2026-10-29-g1.md'));
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf-8');
    expect(text).toContain('ok: false');
    expect(text).toContain('tests failed');
    expect(text).toContain('/tmp/receipt.json');
  });

  test('writeMemory writes allowed files and rejects unknown files', () => {
    service.ensurePodMemory('pod_1', 'Project Alpha');
    const file = service.writeMemory('pod_1', 'POD', '# Updated');
    expect(file).toBe(path.join(service.memoryDir('pod_1'), 'POD.md'));
    expect(fs.readFileSync(file, 'utf-8')).toBe('# Updated');
    expect(() => service.writeMemory('pod_1', 'NOPE' as any, 'x')).toThrow(PodError);
  });
});
