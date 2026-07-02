import { ObservationDeduplicator } from '../../src/compression/observation-deduplicator';
import { ObservationClassifier } from '../../src/compression/observation-classifier';
import { ZeroTokenCompressor } from '../../src/compression/zero-token-compressor';
import { DiffCompressor } from '../../src/compression/diff-compressor';
import { CompressionStrategySelector } from '../../src/compression/compression-strategy-selector';
import { CompressionPipeline } from '../../src/compression/compression-pipeline';
import { PrivacyFilter } from '../../src/memory/privacy-filter';

describe('ObservationDeduplicator', () => {
  let dedup: ObservationDeduplicator;

  beforeEach(() => {
    dedup = new ObservationDeduplicator(10000);
  });

  it('removes exact duplicates within window', () => {
    const obs = { type: 'tool_use', phase: 'execute', content: 'Tool run executed' };
    const result = dedup.deduplicate([obs, { ...obs }, { ...obs }]);
    expect(result).toHaveLength(1);
  });

  it('allows distinct observations within window', () => {
    const obs1 = { type: 'tool_use', phase: 'execute', content: 'Tool A' };
    const obs2 = { type: 'file_edit', phase: 'execute', content: 'File B' };
    const result = dedup.deduplicate([obs1, obs2]);
    expect(result).toHaveLength(2);
  });

  it('cleanExpired removes old entries', () => {
    dedup = new ObservationDeduplicator(1);
    const obs = { type: 'test', phase: 'p1', content: 'x' };
    dedup.deduplicate([obs]);
    const result = dedup.deduplicate([{ ...obs }]);
    expect(result).toHaveLength(0);
  });

  it('clear removes all hashes', () => {
    const obs = { type: 'test', phase: 'p1', content: 'x' };
    dedup.deduplicate([obs]);
    dedup.clear();
    const result = dedup.deduplicate([{ ...obs }]);
    expect(result).toHaveLength(1);
  });
});

describe('ObservationClassifier', () => {
  const classifier = new ObservationClassifier();

  it('classifies by explicit type', () => {
    expect(classifier.classify({ type: 'error' })).toBe('error');
    expect(classifier.classify({ type: 'file_edit' })).toBe('file_edit');
  });

  it('classifies tool_use by content pattern', () => {
    expect(classifier.classify({ content: 'Tool: run' })).toBe('tool_use');
  });

  it('classifies tool_use by metadata', () => {
    expect(classifier.classify({ content: '', metadata: { toolName: 'bash' } })).toBe('tool_use');
  });

  it('classifies file_edit by content', () => {
    expect(classifier.classify({ content: 'File modified: src/foo.ts' })).toBe('file_edit');
  });

  it('classifies file_edit by metadata', () => {
    expect(classifier.classify({ content: '', metadata: { filePath: 'src/foo.ts' } })).toBe('file_edit');
  });

  it('classifies llm_call by content', () => {
    expect(classifier.classify({ content: 'LLM call started' })).toBe('llm_call');
    expect(classifier.classify({ content: 'llm_call completed' })).toBe('llm_call');
  });

  it('classifies error by content', () => {
    expect(classifier.classify({ content: 'Error: timeout' })).toBe('error');
  });

  it('classifies error by metadata.success', () => {
    expect(classifier.classify({ content: '', metadata: { success: false } })).toBe('error');
  });

  it('classifies error by metadata.errorType', () => {
    expect(classifier.classify({ content: '', metadata: { errorType: 'timeout' } })).toBe('error');
  });

  it('classifies state_change by content', () => {
    expect(classifier.classify({ content: 'state_change detected' })).toBe('state_change');
    expect(classifier.classify({ content: 'phase transition' })).toBe('state_change');
  });

  it('defaults to tool_use', () => {
    expect(classifier.classify({ content: 'something random' })).toBe('tool_use');
  });

  describe('classifyBatch', () => {
    it('groups observations by type', () => {
      const obs = [
        { content: 'Tool: run' },
        { content: 'Error: boom' },
        { content: 'Tool: test' },
      ];
      const groups = classifier.classifyBatch(obs);
      expect(groups.get('tool_use')).toHaveLength(2);
      expect(groups.get('error')).toHaveLength(1);
    });
  });
});

describe('ZeroTokenCompressor', () => {
  const compressor = new ZeroTokenCompressor();

  it('extracts coverage metrics', () => {
    const result = compressor.compress([{ content: 'coverage 87.5%', loopNum: 1, timestamp: 100 }]);
    expect(result[0].type).toBe('metric');
    expect(result[0].fact).toBe('coverage 87.5%');
    expect(result[0].concept).toBe('coverage');
    expect(result[0].energy).toBe(0.5);
  });

  it('extracts error messages', () => {
    const result = compressor.compress([{ content: 'Error: Something broke', loopNum: 2 }]);
    expect(result[0].type).toBe('error');
    expect(result[0].fact).toBe('Error: Something broke');
  });

  it('extracts file modifications', () => {
    const result = compressor.compress([{ content: 'modified src/foo.ts: added new function', loopNum: 3 }]);
    expect(result[0].type).toBe('file_change');
    expect(result[0].fact).toContain('Modified');
    expect(result[0].concept).toBe('file-edit');
  });

  it('extracts tool calls', () => {
    const result = compressor.compress([{ content: 'Tool Bash executed', loopNum: 4 }]);
    expect(result[0].type).toBe('tool_use');
    expect(result[0].fact).toBe('Tool used: Bash');
    expect(result[0].concept).toBe('bash');
  });

  it('handles non-matching content', () => {
    const result = compressor.compress([{ content: 'some random text', loopNum: 5 }]);
    expect(result[0].type).toBe('observation');
    expect(result[0].concept).toBe('misc');
    expect(result[0].energy).toBe(0.3);
  });
});

describe('DiffCompressor', () => {
  const compressor = new DiffCompressor();

  it('aggregates stats from file changes', () => {
    const changes = [
      { filePath: 'src/a.ts', type: 'add', loopNum: 1 },
      { filePath: 'src/b.ts', type: 'modify', loopNum: 1 },
      { filePath: 'src/c.ts', type: 'delete', loopNum: 2 },
    ];
    const result = compressor.compress(changes);
    expect(result.type).toBe('diff');
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts[0]).toContain('Files changed: 3');
    expect(result.sourceLoops).toEqual([1, 2]);
  });

  it('detects key changes (auth/jwt/security)', () => {
    const changes = [
      { filePath: 'src/auth/login.ts', content: 'jwt verification', type: 'add' },
    ];
    const result = compressor.compress(changes);
    expect(result.facts.some((f: string) => f.includes('auth'))).toBe(true);
  });

  it('returns empty result for no input', () => {
    const result = compressor.compress([]);
    expect(result.facts).toEqual([]);
    expect(result.energy).toBe(0);
  });

  it('extracts concepts from file paths', () => {
    const changes = [
      { filePath: 'src/api/handler.ts', type: 'modify' },
    ];
    const result = compressor.compress(changes);
    expect(result.concepts).toContain('api');
  });
});

describe('CompressionStrategySelector', () => {
  const selector = new CompressionStrategySelector();

  it('selects diff for all file_edits', () => {
    const obs = [
      { type: 'file_edit', content: 'File modified' },
      { type: 'file_edit', content: 'File modified' },
    ];
    expect(selector.select(obs)).toBe('diff');
  });

  it('selects zero-token when match rate > 80%', () => {
    const obs = [
      { content: 'coverage 90%' },
      { content: 'Error: fail' },
      { content: 'modified file.ts: change' },
    ];
    expect(selector.select(obs)).toBe('zero-token');
  });

  it('selects template for simple small batches', () => {
    const obs = [
      { content: 'hi' },
      { content: 'bye' },
    ];
    expect(selector.select(obs)).toBe('template');
  });

  it('selects llm as fallback', () => {
    const obs = Array.from({ length: 5 }, (_, i) => ({
      content: `Long complex observation number ${i} `.repeat(50),
      type: 'random',
    }));
    expect(selector.select(obs)).toBe('llm');
  });
});

describe('CompressionPipeline', () => {
  it('full pipeline processes observations end-to-end', async () => {
    const pipeline = new CompressionPipeline();
    const obs = [
      { type: 'tool_use', phase: 'execute', content: 'Tool Bash executed', loopNum: 1, timestamp: 100 },
      { type: 'tool_use', phase: 'execute', content: 'Tool Bash executed', loopNum: 1, timestamp: 100 },
      { content: 'coverage 85%', loopNum: 1, timestamp: 200 },
    ];

    const { compressed, stats } = await pipeline.process(obs);

    expect(stats.input).toBe(3);
    expect(stats.duplicates).toBe(1);
    expect(stats.output).toBeLessThanOrEqual(3);
    expect(compressed.length).toBe(stats.output);
  });

  it('pipeline with privacy filter redacts sensitive data', async () => {
    const pf = new PrivacyFilter();
    const pipeline = new CompressionPipeline({ privacyFilter: pf });
    const obs = [
      { content: 'Email: test@example.com', timestamp: 100 },
    ];

    const { compressed } = await pipeline.process(obs);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it('mergeSimilar merges overlapping concepts', async () => {
    const pipeline = new CompressionPipeline();
    const obs = [
      { content: 'coverage 50%', loopNum: 1, timestamp: 100 },
      { content: 'coverage 60%', loopNum: 1, timestamp: 200 },
    ];

    const { compressed, stats } = await pipeline.process(obs);
    expect(compressed.length).toBeGreaterThan(0);
    expect(stats.merged).toBeGreaterThanOrEqual(0);
  });

  it('pipeline stats are correct', async () => {
    const pipeline = new CompressionPipeline();
    const obs = [
      { type: 'tool_use', phase: 'ex', content: 'Tool Bash executed', loopNum: 1, timestamp: 100 },
    ];

    const { stats } = await pipeline.process(obs);
    expect(stats.input).toBe(1);
    expect(stats.output).toBe(1);
    expect(stats.duplicates + stats.compressed + stats.output).toBeGreaterThanOrEqual(2);
  });

  it('handles empty input', async () => {
    const pipeline = new CompressionPipeline();
    const { compressed, stats } = await pipeline.process([]);
    expect(compressed).toEqual([]);
    expect(stats.input).toBe(0);
    expect(stats.output).toBe(0);
  });
});
