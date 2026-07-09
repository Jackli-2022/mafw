import { AgentFinish } from '@langchain/core/agents';
import { CodeAgentAdapter } from '../../../src/langchain/agent-adapter';
import { AgentServices } from '../../../src/langchain/node-runner';

function makeServices(): jest.Mocked<AgentServices> {
  return {
    createSession: jest.fn().mockResolvedValue('session-1'),
    sendPrompt: jest.fn().mockResolvedValue(undefined),
    destroySession: jest.fn().mockResolvedValue(undefined),
    syncToFile: jest.fn(),
  };
}

describe('CodeAgentAdapter', () => {
  it('returns AgentFinish with delegation message', async () => {
    const services = makeServices();
    const adapter = new CodeAgentAdapter(services, 'test instruction', 'goal-1');
    const result = await adapter.plan([], undefined, undefined);
    expect((result as AgentFinish).returnValues.output).toBe('delegated_to_opencode');
    expect(services.createSession).toHaveBeenCalledWith('goal-1');
    expect(services.sendPrompt).toHaveBeenCalledWith('session-1', 'test instruction');
    expect(services.destroySession).toHaveBeenCalledWith('session-1');
  });

  it('has correct input/output keys', () => {
    const services = makeServices();
    const adapter = new CodeAgentAdapter(services, 'test', 'goal-1');
    expect(adapter.inputKeys).toEqual(['input']);
    expect(adapter.outputKeys).toEqual(['output']);
  });

  it('sets lc_namespace correctly', () => {
    const services = makeServices();
    const adapter = new CodeAgentAdapter(services, 'test', 'goal-1');
    expect(adapter.lc_namespace).toEqual(['mafw', 'agent']);
  });
});
