import * as fs from 'fs';
import * as path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { SchedulerState } from './types';

export class DashboardAPI {
  private projectDir: string;
  private mafwDir: string;
  private scheduler?: SchedulerState;

  constructor(projectDir: string = '.', scheduler?: SchedulerState) {
    this.projectDir = projectDir;
    this.mafwDir = path.join(projectDir, '.opencode', 'mafw');
    this.scheduler = scheduler;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = req.url || '/';
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;
      const method = req.method || 'GET';

      // GET /api/health
      if (pathname === '/api/health' && method === 'GET') {
        const result = { status: 'ok' };
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/goals
      if (pathname === '/api/goals' && method === 'GET') {
        const goals = await this.getGoals();
        res.writeHead(200);
        res.end(JSON.stringify(goals));
        return;
      }

      // GET /api/memory/search?query=&goalId=
      if (pathname === '/api/memory/search' && method === 'GET') {
        const query = parsedUrl.searchParams.get('query') || '';
        const goalId = parsedUrl.searchParams.get('goalId') || '';
        const result = await this.searchMemory(goalId, query);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/memory/energy-distribution?goalId=
      if (pathname === '/api/memory/energy-distribution' && method === 'GET') {
        const goalId = parsedUrl.searchParams.get('goalId') || undefined;
        const result = await this.getEnergyDistribution(goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/goals/:id/loops/:loop
      const loopMatch = pathname.match(/^\/api\/goals\/([^/]+)\/loops\/(\d+)$/);
      if (loopMatch && method === 'GET') {
        const [, goalId, loop] = loopMatch;
        const result = await this.getSessionReplay(goalId, parseInt(loop, 10));
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/goals/:id/loops
      const loopsMatch = pathname.match(/^\/api\/goals\/([^/]+)\/loops$/);
      if (loopsMatch && method === 'GET') {
        const [, goalId] = loopsMatch;
        const result = await this.getGoalLoops(goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/goals/:id
      const goalMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (goalMatch && method === 'GET') {
        const [, goalId] = goalMatch;
        const result = await this.getGoalDetail(goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/memory/:goalId/:tier
      const memoryTierMatch = pathname.match(/^\/api\/memory\/([^/]+)\/([^/]+)$/);
      if (memoryTierMatch && method === 'GET') {
        const [, goalId, tier] = memoryTierMatch;
        const result = await this.getMemory(goalId, tier);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/memory/:goalId
      const memoryMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
      if (memoryMatch && method === 'GET') {
        const [, goalId] = memoryMatch;
        const result = await this.getMemory(goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/stats
      if (pathname === '/api/stats' && method === 'GET') {
        const result = await this.getStats();
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/sessions
      if (pathname === '/api/sessions' && method === 'GET') {
        const result = await this.getSessions();
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/sessions/:id/metrics
      const sessionMetricsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/metrics$/);
      if (sessionMetricsMatch && method === 'GET') {
        const [, sessionId] = sessionMetricsMatch;
        const result = await this.getSessionMetrics(sessionId);
        if (result === null) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Session not found' }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify(result));
        }
        return;
      }

      // GET /api/costs/summary
      if (pathname === '/api/costs/summary' && method === 'GET') {
        const result = await this.getCostSummary();
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/costs/:goalId
      const costGoalMatch = pathname.match(/^\/api\/costs\/([^/]+)$/);
      if (costGoalMatch && method === 'GET') {
        const [, goalId] = costGoalMatch;
        const loop = parsedUrl.searchParams.get('loop') || undefined;
        const result = await this.getCosts(goalId, loop ? parseInt(loop, 10) : undefined);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/gateway/pause — pause a goal
      if (pathname === '/api/gateway/pause' && method === 'POST') {
        const body = await this.readBody(req);
        const { goalId } = JSON.parse(body);
        const result = await this.gatewayControl('pause', goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/gateway/resume — resume a goal
      if (pathname === '/api/gateway/resume' && method === 'POST') {
        const body = await this.readBody(req);
        const { goalId } = JSON.parse(body);
        const result = await this.gatewayControl('resume', goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/gateway/cancel — cancel a goal
      if (pathname === '/api/gateway/cancel' && method === 'POST') {
        const body = await this.readBody(req);
        const { goalId } = JSON.parse(body);
        const result = await this.gatewayControl('cancel', goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/gateway/checkpoint — save checkpoint for all running goals
      if (pathname === '/api/gateway/checkpoint' && method === 'POST') {
        const result = await this.gatewayControl('checkpoint');
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/gateway/rollback — rollback to last checkpoint
      if (pathname === '/api/gateway/rollback' && method === 'POST') {
        const body = await this.readBody(req);
        const { goalId } = JSON.parse(body);
        const result = await this.gatewayControl('rollback', goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/alignment?goalId=
      if (pathname === '/api/alignment' && method === 'GET') {
        const goalId = parsedUrl.searchParams.get('goalId') || undefined;
        const result = await this.getAlignment(goalId);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/feedback — record user feedback
      if (pathname === '/api/feedback' && method === 'POST') {
        const body = await this.readBody(req);
        const input = JSON.parse(body);
        const result = await this.recordFeedback(input);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/feedback — list all feedback for timeline
      if (pathname === '/api/feedback' && method === 'GET') {
        const result = await this.listFeedback();
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/user-answers/:questionId
      const answerMatch = pathname.match(/^\/api\/user-answers\/([^/]+)$/);
      if (answerMatch && method === 'POST') {
        const [, questionId] = answerMatch;
        const body = await this.readBody(req);
        const { answer } = JSON.parse(body);
        const ok = this.recordAnswer(questionId, answer);
        res.writeHead(ok ? 200 : 404);
        res.end(JSON.stringify({ success: ok }));
        return;
      }

      // POST /api/alignment — save user weight preferences
      if (pathname === '/api/alignment' && method === 'POST') {
        const body = await this.readBody(req);
        const weights = JSON.parse(body);
        const weightsPath = path.join(this.mafwDir, 'user-weights.json');
        fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2), 'utf-8');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/llm/compress — LLM compression proxy
      if (pathname === '/api/llm/compress' && method === 'POST') {
        const body = await this.readBody(req);
        const { observations, model } = JSON.parse(body);
        const result = await this.llmCompress(observations || [], model);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/l5/axioms
      if (pathname === '/api/l5/axioms' && method === 'GET') {
        const topK = parseInt(parsedUrl.searchParams.get('topK') || '10', 10);
        const { L5Store } = require('../../src/memory/l5-store');
        const store = new L5Store();
        const result = store.getTop(topK);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/l5/heuristics
      if (pathname === '/api/l5/heuristics' && method === 'GET') {
        const { L5Store } = require('../../src/memory/l5-store');
        const store = new L5Store();
        const heuristics = store.loadHeuristics();
        res.writeHead(200);
        res.end(JSON.stringify({ heuristics }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
    }
  }

  async llmCompress(observations: string[], model?: string): Promise<any> {
    const config = this.loadLLMConfig();
    const apiKey = process.env[config.compression.apiKeyEnv];
    if (!apiKey) throw new Error(`API key not found in env ${config.compression.apiKeyEnv}`);

    const prompt = `Analyze the following agent observations and extract structured memories.
Return JSON only:
{
  "narrative": "summary of what happened",
  "facts": ["specific fact 1", "specific fact 2"],
  "concepts": ["keyword1", "keyword2"],
  "energy": 0.5
}

Observations:
${observations.map((o, i) => `[${i + 1}] ${o}`).join('\n')}`;

    const modelName = model || config.compression.model;
    try {
      if (config.compression.provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: modelName, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(15000)
        });
        const data: any = await res.json();
        return this.parseLLMResponse(data.content?.[0]?.text || '');
      }
      if (config.compression.provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelName, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(15000)
        });
        const data: any = await res.json();
        return this.parseLLMResponse(data.choices?.[0]?.message?.content || '');
      }
      throw new Error(`Unknown provider: ${config.compression.provider}`);
    } catch (err: any) {
      return { narrative: 'Compression failed: ' + err.message, facts: [], concepts: [], energy: 0.3 };
    }
  }

  parseLLMResponse(text: string): any {
    try {
      const parsed = JSON.parse(text);
      return { narrative: parsed.narrative || '', facts: Array.isArray(parsed.facts) ? parsed.facts : [], concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [], energy: typeof parsed.energy === 'number' ? parsed.energy : 0.5 };
    } catch {
      return { narrative: text.slice(0, 200), facts: [], concepts: [], energy: 0.5 };
    }
  }

  private loadLLMConfig(): any {
    const configPath = path.join(this.mafwDir, '..', '..', '.mafw', 'llm-config.json');
    if (fs.existsSync(configPath)) {
      try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
    }
    return { compression: { provider: 'anthropic', model: 'claude-3-haiku-20240307', apiKeyEnv: 'MAFW_LLM_API_KEY' } };
  }

  private async recordFeedback(input: any): Promise<any> {
    const { recordFeedback } = require('../../src/tools/run-record-feedback');
    return recordFeedback(input);
  }

  private async listFeedback(): Promise<any[]> {
    const dir = path.join(this.mafwDir, 'user-feedback');
    if (!fs.existsSync(dir)) return [];
    const all: any[] = [];
    const goals = fs.readdirSync(dir);
    for (const goal of goals) {
      const goalDir = path.join(dir, goal);
      if (!fs.statSync(goalDir).isDirectory()) continue;
      for (const file of fs.readdirSync(goalDir).filter(f => f.endsWith('.json'))) {
        try {
          all.push(JSON.parse(fs.readFileSync(path.join(goalDir, file), 'utf-8')));
        } catch {}
      }
    }
    return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  private async gatewayControl(action: string, goalId?: string): Promise<any> {
    const stateDir = path.join(this.mafwDir, 'state');
    if (!fs.existsSync(stateDir)) return { success: false, error: 'No state directory' };

    if (action === 'checkpoint') {
      const { RecoveryManager } = require('../../src/recovery');
      const recovery = new RecoveryManager(this.projectDir);
      const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      let count = 0;
      for (const file of files) {
        try {
          const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
          recovery.saveCheckpoint(state.goalId, state.loop || 1, { phase: state.phase, currentWave: state.currentWave });
          count++;
        } catch {}
      }
      return { success: true, message: `Checkpoint saved for ${count} goal(s)` };
    }

    if (!goalId) return { success: false, error: 'goalId required' };
    const statePath = path.join(stateDir, `${goalId}.json`);
    if (!fs.existsSync(statePath)) return { success: false, error: 'Goal not found' };

    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

      switch (action) {
        case 'pause':
          state._resumePhase = state.phase;
          state.phase = 'PAUSED';
          state.nextAction = 'PAUSED';
          break;
        case 'resume':
          state.phase = state._resumePhase || state.phase;
          state.nextAction = state._resumePhase === 'PLANNING' ? 'CREATE_PLAN_SESSION' :
            state._resumePhase === 'EXECUTING' ? 'CREATE_EXECUTE_SESSION' :
            state._resumePhase === 'REVIEWING' ? 'CREATE_REVIEW_SESSION' : 'WAIT_PHASE_COMPLETE';
          delete state._resumePhase;
          break;
        case 'cancel':
          state.phase = 'FAILED';
          state.nextAction = 'CANCELLED';
          break;
        case 'rollback': {
          const { RecoveryManager } = require('../../src/recovery');
          const recovery = new RecoveryManager(this.projectDir);
          const cp = recovery.findLastCheckpoint(goalId);
          if (cp) {
            await recovery.restoreLoop(goalId, state.loop || 1);
            state.phase = 'PLANNING';
            state.nextAction = 'CREATE_PLAN_SESSION';
          } else {
            return { success: false, error: 'No checkpoint found' };
          }
          break;
        }
        default:
          return { success: false, error: 'Unknown action' };
      }

      state.updatedAt = new Date().toISOString();
      const tmpPath = statePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmpPath, statePath);
      return { success: true, message: `${action} successful` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  private async getAlignment(goalId?: string): Promise<any> {
    const weights = { speed: 0.3, quality: 0.5, cost: 0.2 };
    let actualWeights = { speed: 0.35, quality: 0.45, cost: 0.2 };
    let score = 80;

    if (goalId) {
      // Try to read goal-specific weights from state or request
      const requestPath = path.join(this.mafwDir, 'requests', `${goalId}.json`);
      if (fs.existsSync(requestPath)) {
        try {
          const req = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
          const p = req.priority || 'normal';
          if (p === 'high') { weights.speed = 0.5; weights.quality = 0.3; weights.cost = 0.2; }
          if (p === 'low') { weights.speed = 0.2; weights.quality = 0.3; weights.cost = 0.5; }
        } catch {}
      }

      // Derive actual weights from cost data
      const costPath = path.join(this.mafwDir, 'cost', `${goalId}.json`);
      if (fs.existsSync(costPath)) {
        try {
          const records = JSON.parse(fs.readFileSync(costPath, 'utf-8'));
          if (Array.isArray(records) && records.length > 0) {
            const totalCost = records.reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0);
            if (totalCost > 0) {
              const planCost = records.filter(r => r.toolName === 'mafw_search_hybrid').reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0);
              const reviewCost = records.filter(r => r.toolName === 'mafw_review').reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0);
              const executeCost = totalCost - planCost - reviewCost;
              actualWeights = {
                speed: totalCost > 0 ? parseFloat((executeCost / totalCost).toFixed(2)) : 0,
                quality: totalCost > 0 ? parseFloat((reviewCost / totalCost).toFixed(2)) : 0,
                cost: totalCost > 0 ? parseFloat((planCost / totalCost).toFixed(2)) : 0
              };
            }
          }
        } catch {}
      }

      // Compute alignment score: 1 - Σ|userWeight - actualWeight| / 2
      const diff = Math.abs(weights.speed - actualWeights.speed) + Math.abs(weights.quality - actualWeights.quality) + Math.abs(weights.cost - actualWeights.cost);
      score = Math.round((1 - diff / 2) * 100);
    }

    return { weights, actualWeights, score };
  }

  private recordAnswer(questionId: string, answer: string): boolean {
    const dir = path.join(this.mafwDir, 'user-questions');
    if (!fs.existsSync(dir)) return false;
    const goals = fs.readdirSync(dir);
    for (const goal of goals) {
      const p = path.join(dir, goal, `${questionId}.json`);
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        data.answered = true;
        data.answer = answer;
        data.answeredAt = new Date().toISOString();
        fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
        return true;
      }
    }
    return false;
  }

  private async getGoals(): Promise<any[]> {
    // Prefer runtime data
    if (this.scheduler) {
      return this.getGoalsFromRuntime();
    }
    return this.getGoalsFromFS();
  }

  private getGoalsFromRuntime(): any[] {
    return Array.from(this.scheduler!.activeGoals.values()).map((state: any) => {
      const activeSessions = Object.entries(state.sessions || {})
        .filter(([, s]: any) => s?.active)
        .map(([id]) => id);
      return {
        goalId: state.goalId,
        phase: state.phase,
        nextAction: state.nextAction,
        loop: state.loop,
        currentWave: state.currentWave,
        totalWaves: state.totalWaves,
        updatedAt: state.updatedAt,
        sessions: activeSessions.length,
        sessionId: activeSessions[0] || undefined
      };
    });
  }

  private async getGoalsFromFS(): Promise<any[]> {
    const stateDir = path.join(this.mafwDir, 'state');
    if (!fs.existsSync(stateDir)) return [];

    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    const goals: any[] = [];

    for (const file of files) {
      try {
        const statePath = path.join(stateDir, file);
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        const activeSessions = Object.entries(state.sessions || {})
          .filter(([, s]: any) => s?.active)
          .map(([id]) => id);
        goals.push({
          goalId: state.goalId,
          phase: state.phase,
          nextAction: state.nextAction,
          loop: state.loop,
          currentWave: state.currentWave,
          totalWaves: state.totalWaves,
          updatedAt: state.updatedAt,
          sessions: activeSessions.length,
          sessionId: activeSessions[0] || undefined
        });
      } catch {
        // skip malformed files
      }
    }

    return goals;
  }

  private async getGoalDetail(goalId: string): Promise<any> {
    const stateDir = path.join(this.mafwDir, 'state');
    const requestsDir = path.join(this.mafwDir, 'requests');
    const wavesPath = path.join(this.mafwDir, 'waves.json');

    const statePath = path.join(stateDir, `${goalId}.json`);
    const requestPath = path.join(requestsDir, `${goalId}.json`);

    const detail: any = { goalId };

    if (fs.existsSync(statePath)) {
      detail.state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }

    if (fs.existsSync(requestPath)) {
      detail.request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    }

    if (fs.existsSync(wavesPath)) {
      detail.waves = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
    }

    return detail;
  }

  private async getGoalLoops(goalId: string): Promise<any[]> {
    const reviewsDir = path.join(this.mafwDir, 'reviews');
    if (!fs.existsSync(reviewsDir)) return [];

    const files = fs.readdirSync(reviewsDir)
      .filter(f => f.startsWith(goalId) && f.endsWith('.json'))
      .sort();

    const loops: any[] = [];

    for (const file of files) {
      try {
        const reviewPath = path.join(reviewsDir, file);
        const review = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
        const loopMatch = file.match(/loop-(\d+)/);
        const loopNum = loopMatch ? parseInt(loopMatch[1], 10) : loops.length + 1;
        loops.push({
          loop: loopNum,
          verdict: review.verdict,
          file: file
        });
      } catch {
        // skip
      }
    }

    return loops;
  }

  private async getMemory(goalId: string, tier?: string): Promise<any> {
    const lessonsDir = path.join(this.mafwDir, 'lessons');
    const parametricDir = path.join(this.mafwDir, 'parametric');
    const entries: any[] = [];
    const tierCounts: Record<string, number> = { L5: 0, T4: 0, T3: 0, T2: 0, T1: 0 };

    const scanDir = (dir: string, sourceLabel: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        let tierLabel = sourceLabel;
        if (file.startsWith('L5') || sourceLabel === 'L5') tierLabel = 'L5';
        else if (sourceLabel === 'procedural' || file.startsWith('T4')) tierLabel = 'T4';
        else if (sourceLabel === 'semantic' || file.startsWith('T3')) tierLabel = 'T3';
        else if (file.includes('L2')) tierLabel = 'L2';
        else if (file.includes('L3') || file.includes('constraint') || file.includes('prompt')) tierLabel = 'L3';

        // Map to user-facing tier labels
        let displayTier = 'T1';
        if (tierLabel === 'L5' || sourceLabel === 'L5') displayTier = 'L5';
        else if (tierLabel === 'T4' || tierLabel === 'procedural' || tierLabel === 'pattern') displayTier = 'T4';
        else if (tierLabel === 'T3' || tierLabel === 'semantic' || tierLabel === 'fact') displayTier = 'T3';
        else if (tierLabel === 'L2' || tierLabel === 'lesson' || tierLabel === 'T2') displayTier = 'T2';
        else if (tierLabel === 'L3' || tierLabel === 'L3_constraint' || tierLabel === 'L3_prompt') displayTier = 'L3';

        tierCounts[displayTier] = (tierCounts[displayTier] || 0) + 1;
        entries.push({ file, tier: displayTier, content: content.substring(0, 500), path: path.join(dir, file) });
      }
    };

    const costDir = path.join(this.mafwDir, 'cost');
    if (fs.existsSync(costDir)) {
      const costFiles = fs.readdirSync(costDir).filter(f => f.endsWith('.json'));
      for (const f of costFiles) { tierCounts.T1 = (tierCounts.T1 || 0) + 1; }
    }

    scanDir(lessonsDir, 'L2');
    scanDir(parametricDir, 'parametric');

    if (tier) {
      const filtered = entries.filter(i => i.tier === tier || i.tier.toLowerCase() === tier.toLowerCase());
      return { tiers: tierCounts, entries: filtered, total: filtered.length };
    }

    return { tiers: tierCounts, entries, total: entries.length };
  }

  private async searchMemory(goalId: string, query: string): Promise<any> {
    const memResult = await this.getMemory(goalId);
    const allItems: any[] = memResult.entries || [];
    if (!query) return { query, results: allItems };

    const lowerQuery = query.toLowerCase();
    const results = allItems.filter((item: any) => {
      const content = item.content ? item.content.toLowerCase() : '';
      const file = item.file ? item.file.toLowerCase() : '';
      return content.includes(lowerQuery) || file.includes(lowerQuery);
    });

    return {
      query,
      total: results.length,
      results: results.slice(0, 50)
    };
  }

  private async getEnergyDistribution(goalId?: string): Promise<{ critical: number; high: number; medium: number; low: number; total: number }> {
    const memResult = goalId ? await this.getMemory(goalId) : await this.getMemory('');
    const items: any[] = memResult.entries || [];
    let critical = 0, high = 0, medium = 0, low = 0;

    for (const item of items) {
      const content = item.content || '';
      const energyScore = (content.match(/energy/i) || []).length +
        (content.match(/critical/i) || []).length * 3 +
        (content.match(/high/i) || []).length * 2 +
        (content.match(/medium/i) || []).length;
      if (energyScore >= 5) critical++;
      else if (energyScore >= 3) high++;
      else if (energyScore >= 1) medium++;
      else low++;
    }

    return { critical, high, medium, low, total: memResult.total || items.length };
  }

  private async getSessionReplay(goalId: string, loop: number): Promise<any[]> {
    const events: any[] = [];

    const lessonsDir = path.join(this.mafwDir, 'lessons');
    const receiptsDir = path.join(this.mafwDir, 'receipts');
    const reviewsDir = path.join(this.mafwDir, 'reviews');

    const addFile = (dir: string, label: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(goalId) && f.includes(`loop-${loop}`));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          events.push({
            type: label,
            file,
            timestamp: new Date().toISOString(),
            content: content.substring(0, 1000)
          });
        } catch { /* skip */ }
      }
    };

    addFile(lessonsDir, 'lesson');
    addFile(receiptsDir, 'receipt');
    addFile(reviewsDir, 'review');

    return events;
  }

  private async getStats(): Promise<any> {
    // Prefer runtime scheduler data
    if (this.scheduler) {
      return this.getStatsFromRuntime();
    }
    return this.getStatsFromFS();
  }

  private getStatsFromRuntime(): any {
    const goals = Array.from(this.scheduler!.activeGoals.values());
    const activeGoalCount = goals.filter((g: any) =>
      g.nextAction !== 'COMPLETED' && g.nextAction !== 'FAILED'
    ).length;
    const loopsToday = goals.reduce((sum: number, g: any) => sum + (g.loop || 0), 0);
    const wavesToday = goals.reduce((sum: number, g: any) => sum + (g.currentWave || 0), 0);
    const activeSessions = goals.filter((g: any) =>
      Object.values(g.sessions || {}).some((s: any) => s?.active)
    ).length;

    // Compute total duration from state file timestamps
    const timestamps = goals
      .map(g => g.updatedAt ? new Date(g.updatedAt).getTime() : 0)
      .filter(t => t > 0);
    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : Date.now() - 3600000;
    const totalDurationMinutes = Math.round((Date.now() - earliest) / 60000);

    // Compute memory entries from FS
    const mafwDir = path.join(this.projectDir, '.opencode', 'mafw');
    let l1Count = 0, l2Count = 0, l3Count = 0, totalMemory = 0;
    const lessonsDir = path.join(mafwDir, 'lessons');
    const parametricDir = path.join(mafwDir, 'parametric');
    const countFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        totalMemory++;
        if (file.endsWith('.yml') || file.endsWith('.yaml')) l2Count++;
        else if (file.includes('constraint') || file.includes('prompt')) l3Count++;
        else l1Count++;
      }
    };
    countFiles(lessonsDir);
    countFiles(parametricDir);
    const memoryEntries = totalMemory;
    const memoryL1 = l1Count;
    const memoryL2 = l2Count;
    const memoryL3 = l3Count;

    // Compute loop success rate from FS reviews
    let passed = 0, total = 0;
    const reviewsDir = path.join(mafwDir, 'reviews');
    if (fs.existsSync(reviewsDir)) {
      for (const file of fs.readdirSync(reviewsDir).filter(f => f.endsWith('.json'))) {
        try {
          const review = JSON.parse(fs.readFileSync(path.join(reviewsDir, file), 'utf-8'));
          total++;
          if (review.verdict === 'passed' || review.verdict === 'approved') passed++;
        } catch {}
      }
    }
    for (const g of goals) { total++; if (g.nextAction === 'COMPLETED') passed++; }
    const loopSuccessRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    // Agent workload from cost data
    const agentPcts = this.computeAgentPcts();

    return {
      activeGoals: activeGoalCount,
      loopsToday,
      wavesToday,
      activeSessions,
      serveRunning: this.scheduler!.serveRunning,
      totalDuration: `${Math.floor(totalDurationMinutes / 60)}h ${totalDurationMinutes % 60}m`,
      totalDurationMinutes,
      memoryEntries,
      memoryL1,
      memoryL2,
      memoryL3,
      loopSuccessRate,
      avgWavesPerLoop: 0,
      ...agentPcts
    };
  }

  private computeAgentPcts(): any {
    const costDir = path.join(this.mafwDir, 'cost');
    if (!fs.existsSync(costDir)) {
      return { planAgentPct: 0, executeAgentPct: 0, reviewAgentPct: 0, toolAgentPct: 0, totalAgentCalls: 0 };
    }
    const toolCounts: Record<string, number> = {};
    const files = fs.readdirSync(costDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const records = JSON.parse(fs.readFileSync(path.join(costDir, file), 'utf-8'));
        for (const r of (Array.isArray(records) ? records : [])) {
          const name = r.toolName || 'unknown';
          toolCounts[name] = (toolCounts[name] || 0) + 1;
        }
      } catch {}
    }
    const total = Object.values(toolCounts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      return { planAgentPct: 0, executeAgentPct: 0, reviewAgentPct: 0, toolAgentPct: 0, totalAgentCalls: 0 };
    }
    const getPct = (name: string) => Math.round(((toolCounts[name] || 0) / total) * 100);
    // Map tool names to agent types
    const planTools = (toolCounts['mafw_search_hybrid'] || 0) + (toolCounts['mafw_get_deltas'] || 0);
    const executeTools = (toolCounts['file_edit'] || 0) + (toolCounts['file_write'] || 0);
    const reviewTools = (toolCounts['mafw_review'] || 0) + (toolCounts['mafw_ask_user'] || 0) + (toolCounts['mafw_record_feedback'] || 0);
    const otherTools = total - planTools - executeTools - reviewTools;
    return {
      planAgentPct: total > 0 ? Math.round((planTools / total) * 100) : 0,
      executeAgentPct: total > 0 ? Math.round((executeTools / total) * 100) : 0,
      reviewAgentPct: total > 0 ? Math.round((reviewTools / total) * 100) : 0,
      toolAgentPct: total > 0 ? Math.round((otherTools / total) * 100) : 0,
      totalAgentCalls: total
    };
  }

  private async getStatsFromFS(): Promise<any> {
    const stateDir = path.join(this.mafwDir, 'state');
    const reviewsDir = path.join(this.mafwDir, 'reviews');
    const lessonsDir = path.join(this.mafwDir, 'lessons');
    const parametricDir = path.join(this.mafwDir, 'parametric');

    const states: any[] = [];
    if (fs.existsSync(stateDir)) {
      const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
          states.push(state);
        } catch { /* skip */ }
      }
    }

    const activeGoals = states.filter(s =>
      s.nextAction !== 'COMPLETED' && s.nextAction !== 'FAILED'
    ).length;

    const loopsToday = states.reduce((sum, s) => sum + (s.loop || 0), 0);
    const wavesToday = states.reduce((sum, s) => sum + (s.currentWave || 0), 0);

    const activeSessions = states.filter(s => {
      const sessions = s.sessions;
      if (!sessions) return false;
      return Object.values(sessions).some((ses: any) => ses && ses.status === 'active');
    }).length;

    const timestamps = states
      .map(s => s.updatedAt ? new Date(s.updatedAt).getTime() : 0)
      .filter(t => t > 0);
    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : Date.now() - 3600000;
    const totalDurationMinutes = Math.round((Date.now() - earliest) / 60000);

    let l1Count = 0, l2Count = 0, l3Count = 0, totalMemory = 0;
    const countFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        totalMemory++;
        if (file.endsWith('.yml') || file.endsWith('.yaml')) l2Count++;
        else if (file.includes('constraint') || file.includes('prompt')) l3Count++;
        else l1Count++;
      }
    };
    countFiles(lessonsDir);
    countFiles(parametricDir);
    const memoryEntries = totalMemory;
    const memoryL1 = l1Count;
    const memoryL2 = l2Count;
    const memoryL3 = l3Count;

    let passed = 0, total = 0;
    if (fs.existsSync(reviewsDir)) {
      const reviewFiles = fs.readdirSync(reviewsDir).filter(f => f.endsWith('.json'));
      for (const file of reviewFiles) {
        try {
          const review = JSON.parse(fs.readFileSync(path.join(reviewsDir, file), 'utf-8'));
          total++;
          if (review.verdict === 'passed' || review.verdict === 'approved') passed++;
        } catch { /* skip */ }
      }
    }
    for (const s of states) {
      if (s.nextAction === 'COMPLETED') passed++;
      total++;
    }
    const loopSuccessRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    const goalsWithWaves = states.filter(s => s.totalWaves != null);
    const avgWavesPerLoop = goalsWithWaves.length > 0
      ? parseFloat((goalsWithWaves.reduce((sum, s) => sum + s.totalWaves, 0) / goalsWithWaves.length).toFixed(1))
      : 0;

    return {
      activeGoals,
      loopsToday,
      wavesToday,
      activeSessions,
      totalDuration: `${Math.floor(totalDurationMinutes / 60)}h ${totalDurationMinutes % 60}m`,
      totalDurationMinutes,
      memoryEntries,
      memoryL1,
      memoryL2,
      memoryL3,
      loopSuccessRate,
      avgWavesPerLoop,
      ...this.computeAgentPcts()
    };
  }

  private async getSessions(): Promise<any[]> {
    // Prefer runtime data
    if (this.scheduler) {
      return this.getSessionsFromRuntime();
    }
    return this.getSessionsFromFS();
  }

  private getSessionsFromRuntime(): any[] {
    const sessions: any[] = [];
    for (const [, state] of this.scheduler!.activeGoals) {
      for (const [phase, session] of Object.entries(state.sessions || {})) {
        const s = session as any;
        if (s?.active) {
          const idleMs = s.createdAt ? Date.now() - new Date(s.createdAt).getTime() : 0;
          const idleSec = Math.floor(idleMs / 1000);
          sessions.push({
            id: s.id, goalId: state.goalId, agent: phase,
            status: 'active', idle: idleSec < 60 ? `${idleSec}s` : `${Math.floor(idleSec / 60)}m ${idleSec % 60}s`,
            phase
          });
        }
      }
    }
    return sessions;
  }

  private async getSessionsFromFS(): Promise<any[]> {
    const stateDir = path.join(this.mafwDir, 'state');
    if (!fs.existsSync(stateDir)) return [];

    const sessions: any[] = [];
    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
        const goalId = state.goalId || path.basename(file, '.json');
        const sesObj = state.sessions;
        if (!sesObj) continue;

        for (const [sesId, ses] of Object.entries(sesObj)) {
          const s = ses as any;
          if (s && s.status === 'active') {
            const updatedAt = s.updatedAt || state.updatedAt;
            const idleMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : 0;
            const idleSec = Math.floor(idleMs / 1000);
            const idle = idleSec < 60 ? `${idleSec}s` : `${Math.floor(idleSec / 60)}m ${idleSec % 60}s`;
            sessions.push({
              id: sesId,
              projectDir: s.projectDir || s.project_dir || state.projectDir || '',
              agent: s.phase || s.agent || state.nextAction || 'default',
              status: 'active',
              idle,
              goalId,
              phase: s.phase || s.agent || state.phase || 'idle'
            });
          }
        }
      } catch { /* skip */ }
    }

    return sessions;
  }

  private async getSessionMetrics(sessionId: string): Promise<any | null> {
    const stateDir = path.join(this.mafwDir, 'state');
    if (!fs.existsSync(stateDir)) return null;

    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
        const sesObj = state.sessions;
        if (!sesObj) continue;

        if (sesObj[sessionId]) {
          const ses = sesObj[sessionId];
          const createdAt = ses.createdAt || ses.startedAt || state.updatedAt || new Date().toISOString();
          const uptimeMs = Date.now() - new Date(createdAt).getTime();
          const uptimeSec = Math.floor(uptimeMs / 1000);
          const uptime = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

          // Estimate token usage from cost data if available
          let totalTokens = 0;
          const costPath = path.join(this.mafwDir, 'cost', `${state.goalId || 'unknown'}.json`);
          if (fs.existsSync(costPath)) {
            try {
              const records = JSON.parse(fs.readFileSync(costPath, 'utf-8'));
              if (Array.isArray(records)) {
                totalTokens = records.reduce((s: number, r: any) => s + (r.estimatedTokens || 0), 0);
              }
            } catch {}
          }

          return {
            uptime,
            uptimeSeconds: uptimeSec,
            sseReconnects: 0,
            messagesSent: state.loop || 1,
            totalTokens
          };
        }
      } catch { /* skip */ }
    }

    return null;
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: string) => body += chunk);
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  private async getCosts(goalId: string, loop?: number): Promise<any> {
    const costDir = path.join(this.mafwDir, 'cost');
    const filePath = path.join(costDir, `${goalId}.json`);
    if (!fs.existsSync(filePath)) {
      return { totalTokens: 0, totalCost: 0, byWave: [], byTool: [] };
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const records = JSON.parse(raw);
      return this.aggregateCosts(records, loop);
    } catch {
      return { totalTokens: 0, totalCost: 0, byWave: [], byTool: [] };
    }
  }

  private async getCostSummary(): Promise<any> {
    const costDir = path.join(this.mafwDir, 'cost');
    if (!fs.existsSync(costDir)) {
      return { totalTokens: 0, totalCost: 0, totalGoals: 0, daily: [], weekly: [] };
    }
    const files = fs.readdirSync(costDir).filter(f => f.endsWith('.json'));
    let totalTokens = 0;
    let totalCost = 0;
    for (const file of files) {
      try {
        const records = JSON.parse(fs.readFileSync(path.join(costDir, file), 'utf-8'));
        totalTokens += records.reduce((s: number, r: any) => s + (r.estimatedTokens || 0), 0);
        totalCost += records.reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0);
      } catch {}
    }
    return { totalTokens, totalCost, totalGoals: files.length };
  }

  private aggregateCosts(records: any[], loop?: number): any {
    let filtered = records;
    if (loop !== undefined) {
      filtered = filtered.filter((r: any) => r.loopNum === loop);
    }
    if (filtered.length === 0) {
      return { totalTokens: 0, totalCost: 0, byWave: [], byTool: [] };
    }
    const waveMap = new Map<number, { tokens: number; cost: number }>();
    const toolMap = new Map<string, { tokens: number; cost: number }>();
    for (const r of filtered) {
      const wn = r.waveNum ?? 0;
      const we = waveMap.get(wn) || { tokens: 0, cost: 0 };
      we.tokens += r.estimatedTokens || 0; we.cost += r.estimatedCost || 0;
      waveMap.set(wn, we);
      const te = toolMap.get(r.toolName) || { tokens: 0, cost: 0 };
      te.tokens += r.estimatedTokens || 0; te.cost += r.estimatedCost || 0;
      toolMap.set(r.toolName, te);
    }
    return {
      totalTokens: filtered.reduce((s: number, r: any) => s + (r.estimatedTokens || 0), 0),
      totalCost: filtered.reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0),
      byWave: Array.from(waveMap.entries()).map(([waveNum, d]) => ({ waveNum, ...d })),
      byTool: Array.from(toolMap.entries()).map(([toolName, d]) => ({ toolName, ...d }))
    };
  }
}
