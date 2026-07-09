import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateGoalCreation, validatePhaseCompletion } from '../../../src/mcp/validator';
import { registerTools } from '../../../src/mcp/tools';

describe('validateGoalCreation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-val-'));
    fs.mkdirSync(path.join(tmpDir, '.mafw', 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.mafw', 'requests'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when both charter and request exist and are valid', async () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'goals', '001-test.md'), '# Test Goal\nDo the thing.', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', '001-test.json'), JSON.stringify({
      goalId: '001-test', title: 'Test Goal', maxLoops: 5, priority: 'medium', metrics: {}, boundaries: []
    }), 'utf-8');

    const result = await validateGoalCreation('001-test', tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when charter file is missing', async () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', '001-test.json'), JSON.stringify({
      goalId: '001-test', title: 'Test', maxLoops: 3
    }), 'utf-8');

    const result = await validateGoalCreation('001-test', tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('charter');
  });

  it('fails when request file is missing', async () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'goals', '001-test.md'), '# Test', 'utf-8');

    const result = await validateGoalCreation('001-test', tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/request/i);
  });

  it('fails when request has goalId mismatch', async () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'goals', '001-test.md'), '# Test', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', '001-test.json'), JSON.stringify({
      goalId: '002-wrong'
    }), 'utf-8');

    const result = await validateGoalCreation('001-test', tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('goalId mismatch'))).toBe(true);
  });

  it('warns when charter is empty', async () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'goals', '001-test.md'), '', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', '001-test.json'), JSON.stringify({
      goalId: '001-test', title: 'Test', maxLoops: 5
    }), 'utf-8');

    const result = await validateGoalCreation('001-test', tmpDir);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('empty'))).toBe(true);
  });
});

describe('validatePhaseCompletion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-phase-'));
    fs.mkdirSync(path.join(tmpDir, '.mafw'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('PLANNING', () => {
    it('passes when waves.json exists with waves', async () => {
      fs.writeFileSync(path.join(tmpDir, '.mafw', 'waves.json'), JSON.stringify({
        waves: [{ waveNum: 1, tasks: ['task-1'] }]
      }), 'utf-8');

      const result = await validatePhaseCompletion('g1', 'PLANNING', tmpDir);
      expect(result.valid).toBe(true);
    });

    it('fails when waves.json is missing', async () => {
      const result = await validatePhaseCompletion('g1', 'PLANNING', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Waves');
    });

    it('fails when waves array is empty', async () => {
      fs.writeFileSync(path.join(tmpDir, '.mafw', 'waves.json'), JSON.stringify({ waves: [] }), 'utf-8');
      const result = await validatePhaseCompletion('g1', 'PLANNING', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('no waves');
    });

    it('fails when waves.json is malformed JSON', async () => {
      fs.writeFileSync(path.join(tmpDir, '.mafw', 'waves.json'), '{invalid}', 'utf-8');
      const result = await validatePhaseCompletion('g1', 'PLANNING', tmpDir);
      expect(result.valid).toBe(false);
    });
  });

  describe('EXECUTING', () => {
    it('passes when receipts exist', async () => {
      const receiptsDir = path.join(tmpDir, '.mafw', 'receipts', 'g1');
      fs.mkdirSync(receiptsDir, { recursive: true });
      fs.writeFileSync(path.join(receiptsDir, 'task-1.json'), JSON.stringify({ taskId: 'task-1', waveNum: 1 }), 'utf-8');

      const result = await validatePhaseCompletion('g1', 'EXECUTING', tmpDir);
      expect(result.valid).toBe(true);
    });

    it('fails when receipts directory is missing', async () => {
      const result = await validatePhaseCompletion('g1', 'EXECUTING', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Receipts');
    });

    it('fails when receipts directory is empty', async () => {
      fs.mkdirSync(path.join(tmpDir, '.mafw', 'receipts', 'g1'), { recursive: true });
      const result = await validatePhaseCompletion('g1', 'EXECUTING', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('receipt');
    });

    it('warns when receipt is missing required fields', async () => {
      const receiptsDir = path.join(tmpDir, '.mafw', 'receipts', 'g1');
      fs.mkdirSync(receiptsDir, { recursive: true });
      fs.writeFileSync(path.join(receiptsDir, 'bad.json'), JSON.stringify({ foo: 'bar' }), 'utf-8');

      const result = await validatePhaseCompletion('g1', 'EXECUTING', tmpDir);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('taskId'))).toBe(true);
    });
  });

  describe('REVIEWING', () => {
    it('passes when review file exists with verdict', async () => {
      const reviewsDir = path.join(tmpDir, '.mafw', 'reviews');
      fs.mkdirSync(reviewsDir, { recursive: true });
      fs.writeFileSync(path.join(reviewsDir, 'g1-loop1.md'), '# Review\nVerdict: PASS\nScore: 90', 'utf-8');

      const result = await validatePhaseCompletion('g1', 'REVIEWING', tmpDir);
      expect(result.valid).toBe(true);
    });

    it('fails when reviews directory is missing', async () => {
      const result = await validatePhaseCompletion('g1', 'REVIEWING', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Reviews');
    });

    it('fails when review file is missing', async () => {
      fs.mkdirSync(path.join(tmpDir, '.mafw', 'reviews'), { recursive: true });
      const result = await validatePhaseCompletion('g1', 'REVIEWING', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Review');
    });

    it('warns when review file is empty', async () => {
      const reviewsDir = path.join(tmpDir, '.mafw', 'reviews');
      fs.mkdirSync(reviewsDir, { recursive: true });
      fs.writeFileSync(path.join(reviewsDir, 'g1-loop1.md'), '', 'utf-8');

      const result = await validatePhaseCompletion('g1', 'REVIEWING', tmpDir);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('empty'))).toBe(true);
    });

    it('warns when review file lacks verdict or score', async () => {
      const reviewsDir = path.join(tmpDir, '.mafw', 'reviews');
      fs.mkdirSync(reviewsDir, { recursive: true });
      fs.writeFileSync(path.join(reviewsDir, 'g1-loop1.md'), '# Just notes nothing else', 'utf-8');

      const result = await validatePhaseCompletion('g1', 'REVIEWING', tmpDir);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('verdict'))).toBe(true);
    });
  });

  describe('invalid phase', () => {
    it('fails for unknown phase', async () => {
      const result = await validatePhaseCompletion('g1', 'INVALID', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown');
    });
  });
});

describe('registerTools', () => {
  it('returns 9 tool definitions', () => {
    const { definitions, handlers } = registerTools();
    expect(definitions).toHaveLength(9);
  });

  it('each definition has name, description, and inputSchema', () => {
    const { definitions } = registerTools();
    for (const def of definitions) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.inputSchema).toBeTruthy();
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('all 9 tool names match mafw_* pattern', () => {
    const { definitions } = registerTools();
    const names = definitions.map(d => d.name);
    expect(names).toEqual([
      'mafw_create_goal',
      'mafw_update_state',
      'mafw_search_hybrid',
      'mafw_get_deltas',
      'mafw_load_state',
      'mafw_ask_user',
      'mafw_record_feedback',
      'mafw_get_model_route',
      'mafw_add_memory',
    ]);
  });

  it('each tool has a registered handler', () => {
    const { definitions, handlers } = registerTools();
    for (const def of definitions) {
      expect(handlers[def.name]).toBeDefined();
      expect(typeof handlers[def.name]).toBe('function');
    }
  });
});
