import { captureObservation } from '../../../src/hooks/observation-capture';

describe('captureObservation', () => {
  test('captures tool output as observation', async () => {
    const result = await captureObservation({
      toolName: 'read',
      output: 'file content here',
      args: '{"path": "/test.txt"}'
    });
    expect(result).toBeDefined();
    expect(result.observation?.type).toBe('observation');
    expect(result.observation?.tool).toBe('read');
  });
});
