import * as http from 'http';
import type { RuntimeAccess } from '../runtime/runtime-access';
import { surfaceUnavailableMessage } from '../runtime/runtime-access';

export interface RestartAgentDeps {
  /** surface 门（process.restart = agentProcessApi + agentProcess.restart presence）。 */
  getAccess: () => RuntimeAccess | null;
  isRecovering: () => boolean;
  isSwitching: () => boolean;
  begin: () => void;
  end: () => void;
  restartAgent: () => Promise<{ mode: string }>;
}

export async function handleRestartAgent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RestartAgentDeps,
): Promise<void> {
  const json = (status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!deps.getAccess()?.can('process.restart')) {
    json(503, { error: surfaceUnavailableMessage('process.restart') });
    return;
  }
  if (deps.isRecovering() || deps.isSwitching()) {
    json(409, { error: 'agent process recovery/runtime switch already in progress' });
    return;
  }
  deps.begin();
  try {
    const { mode } = await deps.restartAgent();
    json(200, { success: true, mode });
  } catch (err: any) {
    json(500, { error: err.message });
  } finally {
    deps.end();
  }
}
