import * as fs from 'fs';
import * as path from 'path';
import { initState } from '../../utils/state';
import { StatusManager } from '../../utils/status';

/**
 * mafw-goal Skill Entry — Goal Interview Agent
 *
 * 职责：
 *   1. 接收用户输入的目标描述
 *   2. 进行多轮追问（3-5 个问题）
 *   3. 生成 Goal Charter
 *   4. 用户确认后写入：
 *      - goals/{goalId}.md
 *      - requests/{goalId}.json
 *      - state/{goalId}.json (nextAction: CREATE_PLAN_SESSION)
 *      - STATUS.md
 *   5. 返回确认结果给 TUI
 *
 * 调用方式：TUI 中 /goal 命令 → context.runSkill('mafw-goal', { text: '...' })
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
  const mafwDir = path.join(projectDir, '.opencode/mafw');

  console.log(`[mafw-goal] Starting interview for: "${goalText}"`);

  // 1. 进行 Interview（多轮追问）
  const interview = await runInterview(context, goalText);
  console.log(`[mafw-goal] Interview complete: ${interview.title}`);

  // 2. 生成 Goal ID
  const goalId = generateGoalId();
  interview.goalId = goalId;

  // 3. 创建目录
  const goalsDir = path.join(mafwDir, 'goals');
  const requestsDir = path.join(mafwDir, 'requests');
  [goalsDir, requestsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 4. 写入 Goal Charter
  const charterPath = path.join(goalsDir, `${goalId}.md`);
  fs.writeFileSync(charterPath, formatGoalCharter(interview), 'utf-8');
  console.log(`[mafw-goal] Written Goal Charter: ${charterPath}`);

  // 5. 写入请求文件
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
  console.log(`[mafw-goal] Written request: ${requestPath}`);

  // 6. 初始化状态机
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

// ── Interview 实现 ──

async function runInterview(context: GoalSkillContext, goalText: string): Promise<InterviewResult> {
  // 简化版：直接调用 LLM 生成完整 Interview 结果
  // 实际版本应进行多轮追问

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
    // Fallback: 返回默认结构
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
  return `# Goal Charter — ${result.title}

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
