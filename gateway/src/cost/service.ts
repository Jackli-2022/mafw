import { CostEstimator } from "../core/cost/cost-estimator";
import { CognitiveRouter } from "../core/cost/cognitive-router";

export class CostService {
  estimator: CostEstimator;
  router: CognitiveRouter;

  constructor() {
    this.estimator = new CostEstimator();
    this.router = new CognitiveRouter();
  }

  getModelRoute(agentType: "plan" | "execute" | "review", remainingBudget: number, totalBudget: number) {
    return this.router.selectModel(agentType, remainingBudget, totalBudget);
  }
}
