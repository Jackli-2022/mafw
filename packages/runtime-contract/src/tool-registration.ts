/** Runtime-neutral tool registration DTO (gateway factories, driver plumbing). */

export interface RuntimeToolRegistration {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  execute(params: any, signal?: unknown): Promise<{ text: string; isError?: boolean }>;
}
