import { AgentFinish } from '@langchain/core/agents';
import { CodeAgentAdapter } from '../../../gateway/src/core/langchain/agent-adapter';
import { AgentServices } from '../../../gateway/src/core/langchain/node-runner';

function makeServices(): jest.Mocked<AgentServices> {
  return {
    client: {
      session: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
        promptAsync: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    },
    syncToFile: jest.fn(),
  };
}

describe('CodeAgentAdapter', () => {
  it('returns AgentFinish with delegation message', async () => {
    const services = makeServices();
    const adapter = new CodeAgentAdapter(services, 'test instruction', 'goal-1');
    const result = await adapter.plan([], undefined, undefined);
    expect((result as AgentFinish).returnValues.output).toBe('delegated_to_opencode');
    expect(services.client.session.create).toHaveBeenCalledWith({ directory: 'test instruction' });
    expect(services.client.session.promptAsync).toHaveBeenCalledWith({ sessionID: 'session-1', message: 'test instruction' });
    expect(services.client.session.delete).toHaveBeenCalledWith({ sessionID: 'session-1' });
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
