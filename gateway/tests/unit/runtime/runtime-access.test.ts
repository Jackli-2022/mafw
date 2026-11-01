import { RuntimeAccess, RuntimeSurfaceError } from '../../../src/runtime/runtime-access';
import { minimalCapabilities } from '../../../src/runtime/contract';

function runtime(over: any = {}) {
  return {
    name: 'secret-runtime-name',
    capabilities: { ...minimalCapabilities(), ...(over.capabilities ?? {}) },
    session: {
      fork: async () => ({}),
      revert: async () => {},
      unrevert: async () => {},
    },
    mcp: {
      list: async () => [],
      connect: async () => true,
      disconnect: async () => true,
    },
    semantics: over.semantics,
    ...over,
  } as any;
}

describe('RuntimeAccess', () => {
  it('denies gated surfaces when their capability is off', () => {
    const access = new RuntimeAccess(runtime());
    expect(access.can('mcp.list')).toBe(false);
  });

  it('denies a declared capability when any presence probe is missing', () => {
    const access = new RuntimeAccess(runtime({
      capabilities: { mcpApi: true },
      mcp: { list: async () => [], connect: async () => true },
    }));
    expect(access.can('mcp.connect')).toBe(true);
    expect(access.can('mcp.disconnect')).toBe(false);
  });

  it('allows presence surfaces with capability on and probe present', () => {
    const access = new RuntimeAccess(runtime({ capabilities: { mcpApi: true } }));
    expect(access.can('mcp.list')).toBe(true);
    expect(access.can('mcp.connect')).toBe(true);
  });

  it('uses effective capability for non-presence surfaces', () => {
    const on = new RuntimeAccess(runtime({ capabilities: { checkpointApi: true, runStateApi: true } }));
    expect(on.can('branch.checkpoint')).toBe(true);
    expect(on.can('branch.runState')).toBe(true);
    const off = new RuntimeAccess(runtime());
    expect(off.can('branch.checkpoint')).toBe(false);
  });

  it('throws a neutral error for unknown surfaces and denied requireSurface', () => {
    const access = new RuntimeAccess(runtime());
    expect(() => access.can('does.not.exist')).toThrow(RuntimeSurfaceError);
    try {
      access.requireSurface('mcp.list');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RuntimeSurfaceError);
      expect(err.code).toBe('runtime.surface.unavailable');
      expect(err.surface).toBe('mcp.list');
      expect(err.message).toContain('mcp.list');
      expect(err.message).not.toContain('secret-runtime-name');
    }
  });

  it('reads adapter semantic metadata without consulting runtime names', () => {
    const access = new RuntimeAccess(runtime({
      semantics: { 'prompt.delivery.steer': { boundary: 'tool' } },
    }));
    expect(access.semantics('prompt.delivery.steer')).toEqual({ boundary: 'tool' });
    expect(access.semantics('branch.revert')).toEqual({});
  });
});
