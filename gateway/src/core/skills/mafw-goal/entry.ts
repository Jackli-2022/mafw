import { log } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { initState } from '../../utils/state';
import { StatusManager } from '../../utils/status';

/**
 * mafw-goal Skill Entry —Goal Interview Agent
 *
 * 鑱岃矗锛?
 *   1. 鎺ユ敹鐢ㄦ埛杈撳叆鐨勭洰鏍囨弿杩?
 *   2. 杩涜澶氳疆杩介棶锛?-5 涓棶棰橈級
 *   3. 鐢熸垚 Goal Charter
 *   4. 鐢ㄦ埛纭鍚庡啓鍏ワ細
 *      - goals/{goalId}.md
 *      - requests/{goalId}.json
 *      - state/{goalId}.json (nextAction: CREATE_PLAN_SESSION)
 *      - STATUS.md
 *   5. 杩斿洖纭缁撴灉缁?TUI
 *
 * 璋冪敤鏂瑰紡锛歍UI 涓?/goal 鍛戒护 鈫?context.runSkill('mafw-goal', { text: '...' })
 */

export interface GoalSkillContext {
  message: string;
  llm: {
    chat: (options: { model: string; messages: any[] }) => Promise<{ content: string }>;
  };
  config: { model: string };
  projectDir: string;
}

export interface InterviewResult {
  goalId: string;
  title: string;
  metrics: Record<string, { target: number; unit: string }>;
  boundaries: string[];
  scope: { include: string[]; exclude: string[] };
  risks: any[];
  priority: string;
  maxLoops: number;
  parallel: boolean;
  remoteCli?: {
    host: string;
    projectDir: string;
    syncOnExecute: boolean;
    testCommand: string;
  };
}

export async function mafwGoalEntry(context: GoalSkillContext): Promise<InterviewResult> {
  const goalText = context.message;
  const projectDir = context.projectDir || process.cwd();
  const mafwDir = path.join(projectDir, '.mafw');

  log.info(`[mafw-goal] Starting interview for: "${goalText}"`);

  // 1. 杩涜 Interview锛堝杞拷闂級
  const interview = await runInterview(context, goalText);
  log.info(`[mafw-goal] Interview complete: ${interview.title}`);

  // 2. 鐢熸垚 Goal ID
  const goalId = generateGoalId();
  interview.goalId = goalId;

  // 3. 鍒涘缓鐩綍
  const goalsDir = path.join(mafwDir, 'goals');
  const requestsDir = path.join(mafwDir, 'requests');
  [goalsDir, requestsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 4. 鍐欏叆 Goal Charter
  const charterPath = path.join(goalsDir, `${goalId}.md`);
  fs.writeFileSync(charterPath, formatGoalCharter(interview), 'utf-8');
  log.info(`[mafw-goal] Written Goal Charter: ${charterPath}`);

  // 5. 鍐欏叆璇锋眰鏂囦欢
  const requestPath = path.join(requestsDir, `${goalId}.json`);
  const requestData = {
    version: '1',
    goalId,
    title: interview.title,
    state: 'PENDING',
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    source: 'tui',
    projectDir,
    mafwDir,
    goalCharter: `goals/${goalId}.md`,
    metrics: interview.metrics,
    boundaries: interview.boundaries,
    priority: interview.priority || 'normal',
    maxLoops: interview.maxLoops || 5,
    parallel: interview.parallel || false,
    degradeOnLoop: interview.maxLoops || 5,
    remoteCli: interview.remoteCli
  };
  fs.writeFileSync(requestPath, JSON.stringify(requestData, null, 2), 'utf-8');
  log.info(`[mafw-goal] Written request: ${requestPath}`);

  // 6. 鍒濆鍖栫姸鎬佹満
  initState(goalId, projectDir);
  const statusManager = new StatusManager(projectDir);
  statusManager.update(goalId, {
    state: 'PENDING',
    loop: 0,
    wave: 0,
    task: '',
    progress: '0%',
    sessionId: null,
    directory: projectDir
  });

  return interview;
}

// 鈹€鈹€ Interview 瀹炵幇 鈹€鈹€

async function runInterview(context: GoalSkillContext, goalText: string): Promise<InterviewResult> {
  // 绠€鍖栫増锛氱洿鎺ヨ皟鐢?LLM 鐢熸垚瀹屾暣 Interview 缁撴灉
  // 瀹為檯鐗堟湰搴旇繘琛屽杞拷闂?

  const prompt = buildInterviewPrompt(goalText);
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  return parseInterviewResponse(response.content, goalText);
}

function buildInterviewPrompt(goalText: string): string {
  return `# Goal Interview Agent

User wants to create a new development goal: "${goalText}"

Please generate a structured goal definition with the following fields:

1. title: Clear, concise title
2. metrics: Key metrics with target values (e.g., test_coverage: {target: 80, unit: '%'})
3. boundaries: Technical constraints and rules (e.g., "Must use RS256", "Password must be bcrypt")
4. scope: What to include and exclude
5. risks: Potential risks with probability and impact
6. priority: normal, high, or critical
7. maxLoops: Maximum retry loops (default 5)
8. parallel: Whether to allow parallel task execution (default false)

Output as JSON.
`;
}

function parseInterviewResponse(content: string, goalText: string): InterviewResult {
  try {
    const data = JSON.parse(content);
    return {
      goalId: '',
      title: data.title || goalText,
      metrics: data.metrics || { test_coverage: { target: 80, unit: '%' } },
      boundaries: data.boundaries || [],
      scope: data.scope || { include: [], exclude: [] },
      risks: data.risks || [],
      priority: data.priority || 'normal',
      maxLoops: data.maxLoops || 5,
      parallel: data.parallel || false,
      remoteCli: data.remoteCli
    };
  } catch {
    // Fallback: 杩斿洖榛樿缁撴瀯
    return {
      goalId: '',
      title: goalText,
      metrics: { test_coverage: { target: 80, unit: '%' } },
      boundaries: ['Must follow project coding standards'],
      scope: { include: [goalText], exclude: [] },
      risks: [{ description: 'Implementation complexity', probability: 'medium', impact: 'medium' }],
      priority: 'normal',
      maxLoops: 5,
      parallel: false
    };
  }
}

function formatGoalCharter(result: InterviewResult): string {
  return `# Goal Charter —${result.title}

> Goal ID: ${result.goalId}
> Created: ${new Date().toISOString()}
> Priority: ${result.priority}
> Max Loops: ${result.maxLoops}

## Objective

${result.title}

## Metrics

| Metric | Target | Unit | Verification |
|--------|--------|------|-------------|
${Object.entries(result.metrics).map(([k, v]) => `| ${k} | ${v.target} | ${v.unit} | Automated test |`).join('\n')}

## Boundaries

${result.boundaries.map(b => `- [ ] ${b}`).join('\n')}

## Scope

- Include: ${result.scope.include.join(', ')}
- Exclude: ${result.scope.exclude.join(', ')}

## Risks

${result.risks.map((r: any) => `- ${r.description} (Probability: ${r.probability}, Impact: ${r.impact})`).join('\n')}

## Remote CLI

${result.remoteCli ? `Host: ${result.remoteCli.host}\nProject Dir: ${result.remoteCli.projectDir}\nTest Command: ${result.remoteCli.testCommand}` : 'Not configured'}
`;
}

function generateGoalId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 900 + 100);
  return `${date}-${seq}`;
}



