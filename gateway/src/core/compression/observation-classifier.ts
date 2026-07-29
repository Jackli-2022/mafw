export type ObservationType = 'tool_use' | 'file_edit' | 'llm_call' | 'error' | 'state_change';

export class ObservationClassifier {
  classify(observation: { type?: string; content?: string; metadata?: any }): ObservationType {
    const knownTypes = ['tool_use', 'file_edit', 'llm_call', 'error', 'state_change'];

    if (observation.type && knownTypes.includes(observation.type)) {
      return observation.type as ObservationType;
    }

    const content = observation.content || '';
    const metadata = observation.metadata || {};

    if (content.includes('Tool:') || metadata.toolName) {
      return 'tool_use';
    }
    if (content.includes('File modified') || metadata.filePath) {
      return 'file_edit';
    }
    if (content.includes('LLM call') || content.includes('llm_call')) {
      return 'llm_call';
    }
    if (content.includes('Error:') || metadata.errorType || metadata.success === false) {
      return 'error';
    }
    if (content.includes('state_change') || content.includes('phase')) {
      return 'state_change';
    }

    return 'tool_use';
  }

  classifyBatch(observations: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const obs of observations) {
      const type = this.classify(obs);
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(obs);
    }

    return groups;
  }
}
