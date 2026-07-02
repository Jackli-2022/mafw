import { TokenBudgetAllocator, BudgetCategory } from '../../src/compression/token-budget-allocator';

describe('TokenBudgetAllocator', () => {
  describe('allocate', () => {
    test('exact budget fits all items', () => {
      const allocator = new TokenBudgetAllocator();
      const memories: BudgetCategory = {
        parametric: [{ content: 'aaaa', energy: 5 }],
        procedural: [{ pattern: 'bbbb', energy: 5 }],
        semantic: [{ facts: ['cccc'], energy: 5 }],
        episodic: [{ summary: 'dddd', energy: 5 }],
      };
      const result = allocator.allocate(memories, 10000);

      expect(result.parametric).toHaveLength(1);
      expect(result.procedural).toHaveLength(1);
      expect(result.semantic).toHaveLength(1);
      expect(result.episodic).toHaveLength(1);
      expect(result.totalTokens).toBe(11 + 16 + 21 + 11);
    });

    test('partial selection when budget is too small', () => {
      const allocator = new TokenBudgetAllocator({
        allocations: { parametric: 1.0, procedural: 0, semantic: 0, episodic: 0, buffer: 0 },
      });
      const result = allocator.allocate({
        parametric: [
          { content: 'x'.repeat(60), energy: 10 },
          { content: 'x'.repeat(60), energy: 5 },
          { content: 'x'.repeat(60), energy: 1 },
        ],
        procedural: [], semantic: [], episodic: [],
      }, 50);

      expect(result.parametric).toHaveLength(2);
      expect(result.totalTokens).toBe(50);
    });

    test('empty category', () => {
      const allocator = new TokenBudgetAllocator();
      const result = allocator.allocate({
        parametric: [{ content: 'aaaa', energy: 5 }],
        procedural: [{ pattern: 'bbbb', energy: 5 }],
        semantic: [{ facts: ['cccc'], energy: 5 }],
        episodic: [],
      }, 10000);

      expect(result.parametric).toHaveLength(1);
      expect(result.procedural).toHaveLength(1);
      expect(result.semantic).toHaveLength(1);
      expect(result.episodic).toHaveLength(0);
      expect(result.totalTokens).toBe(11 + 16 + 21);
    });

    test('high energy items selected first within category', () => {
      const allocator = new TokenBudgetAllocator({
        allocations: { parametric: 1.0, procedural: 0, semantic: 0, episodic: 0, buffer: 0 },
      });
      const result = allocator.allocate({
        parametric: [
          { content: 'x'.repeat(60), energy: 1 },
          { content: 'x'.repeat(60), energy: 10 },
          { content: 'x'.repeat(60), energy: 5 },
        ],
        procedural: [], semantic: [], episodic: [],
      }, 50);

      expect(result.parametric).toHaveLength(2);
      expect(result.parametric[0].energy).toBe(10);
      expect(result.parametric[1].energy).toBe(5);
    });

    test('buffer allocation carries unused budget across categories', () => {
      const allocator = new TokenBudgetAllocator();
      const result = allocator.allocate({
        parametric: [
          { content: 'x'.repeat(96), energy: 10 },
          { content: 'aaaa', energy: 5 },
        ],
        procedural: [],
        semantic: [],
        episodic: [],
      }, 100);

      expect(result.parametric).toHaveLength(2);
      expect(result.parametric[0].energy).toBe(5);
      expect(result.parametric[1].energy).toBe(10);
      expect(result.totalTokens).toBe(11 + 34);
    });

    test('custom allocations override defaults', () => {
      const allocator = new TokenBudgetAllocator({
        allocations: { parametric: 0.5, procedural: 0.5, semantic: 0, episodic: 0, buffer: 0 },
      });
      const result = allocator.allocate({
        parametric: [{ content: 'aaaa', energy: 5 }],
        procedural: [{ pattern: 'bbbb', energy: 5 }],
        semantic: [],
        episodic: [],
      }, 100);

      expect(result.parametric).toHaveLength(1);
      expect(result.procedural).toHaveLength(1);
      expect(result.totalTokens).toBe(11 + 16);
    });

    test('items without energy default to 0', () => {
      const allocator = new TokenBudgetAllocator({
        allocations: { parametric: 1.0, procedural: 0, semantic: 0, episodic: 0, buffer: 0 },
      });
      const result = allocator.allocate({
        parametric: [
          { content: 'aaaa' },
          { content: 'bbbb', energy: 10 },
        ],
        procedural: [], semantic: [], episodic: [],
      }, 30);

      expect(result.parametric).toHaveLength(2);
      expect(result.parametric[0].energy).toBe(10);
    });

    test('uses default budget when totalBudget not provided', () => {
      const allocator = new TokenBudgetAllocator({ defaultBudget: 10000 });
      const result = allocator.allocate({
        parametric: [{ content: 'aaaa', energy: 5 }],
        procedural: [],
        semantic: [],
        episodic: [],
      });

      expect(result.parametric).toHaveLength(1);
      expect(result.totalTokens).toBe(11);
    });
  });

  describe('estimateItemTokens', () => {
    test('returns correct estimates per category', () => {
      const allocator = new TokenBudgetAllocator();

      const parametric = allocator.estimateItemTokens({ content: 'abcd' }, 'parametric');
      expect(parametric).toBe(11);

      const procedural = allocator.estimateItemTokens({ pattern: 'abcd' }, 'procedural');
      expect(procedural).toBe(16);

      const semantic = allocator.estimateItemTokens({ facts: ['abcd'] }, 'semantic');
      expect(semantic).toBe(21);

      const episodic = allocator.estimateItemTokens({ summary: 'abcd' }, 'episodic');
      expect(episodic).toBe(11);
    });

    test('uses default estimate for unknown category', () => {
      const allocator = new TokenBudgetAllocator();
      expect(allocator.estimateItemTokens({}, 'unknown')).toBe(50);
    });

    test('parametric uses content or rule', () => {
      const allocator = new TokenBudgetAllocator();
      const fromContent = allocator.estimateItemTokens({ content: 'abcd' }, 'parametric');
      const fromRule = allocator.estimateItemTokens({ rule: 'abcd' }, 'parametric');
      expect(fromContent).toBe(11);
      expect(fromRule).toBe(11);
    });

    test('semantic joins facts array', () => {
      const allocator = new TokenBudgetAllocator();
      const tokens = allocator.estimateItemTokens({ facts: ['a', 'b'] }, 'semantic');
      expect(tokens).toBe(21);
    });

    test('episodic uses summary or content', () => {
      const allocator = new TokenBudgetAllocator();
      const fromSummary = allocator.estimateItemTokens({ summary: 'abcd' }, 'episodic');
      const fromContent = allocator.estimateItemTokens({ content: 'abcd' }, 'episodic');
      expect(fromSummary).toBe(11);
      expect(fromContent).toBe(11);
    });
  });

  describe('setDefaultBudget', () => {
    test('updates default budget', () => {
      const allocator = new TokenBudgetAllocator({ defaultBudget: 5000 });
      allocator.setDefaultBudget(10000);
      const result = allocator.allocate({
        parametric: [{ content: 'a'.repeat(1000), energy: 5 }],
        procedural: [],
        semantic: [],
        episodic: [],
      });

      expect(result.parametric).toHaveLength(1);
      expect(result.totalTokens).toBe(Math.ceil(1000 / 4) + 10);
    });
  });
});
