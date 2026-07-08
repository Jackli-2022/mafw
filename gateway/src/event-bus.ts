import { EventEmitter } from "events";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export type GatewayEvent =
  | { type: "goal_created"; goalId: string; projectDir: string }
  | { type: "state_change"; goalId: string; patch: Record<string, unknown>; projectDir: string }
  | { type: "user_question"; goalId: string; questionId: string }
  | { type: "user_feedback"; goalId: string; targetId: string; feedbackType: string }
  | { type: string; [key: string]: unknown };
