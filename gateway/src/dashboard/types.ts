export interface SchedulerState {
  activeGoals: Map<string, any>;
  registeredProjects: Map<string, any>;
  serveRunning: boolean;
}
