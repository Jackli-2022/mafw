import * as fs from 'fs';
import * as path from 'path';
import { updateState, loadState } from '../utils/state';
import { askUser } from '../tools/run-ask-user';
import { recordFeedback } from '../tools/run-record-feedback';
import { CognitiveRouter } from '../cost/cognitive-router';
import { HarmonicUnit, generateHarmonicId } from '../memory/harmonic-types';
import { HarmonicIndexManager } from '../memory/harmonic-index';
import { calculateSalience } from '../memory/salience-perceptor';

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
const gatewayUrl = process.env.MAFW_GATEWAY_URL || 'http://localhost:3004';
const cognitiveRouter = new CognitiveRouter();
const mafwDir = path.join(projectDir, '.mafw');

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export function registerTools(): { definitions: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const definitions: ToolDefinition[] = [
    {
      name: 'mafw_create_goal',
      description: 'Create a new MAFW goal with charter and request files',
      inputSchema: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Unique goal identifier (e.g. 003-foo)' },
          title: { type: 'string', description: 'Human-readable goal title' },
          charter: { type: 'string', description: 'Goal charter content in markdown' },
          source: { type: 'string', description: 'Source of the goal request', default: 'user' },
          metrics: {
            type: 'object',
            description: 'Success metrics key-value pairs',
            additionalProperties: { type: 'object', properties: { target: { type: 'number' }, unit: { type: 'string' } } }
          },
          boundaries: { type: 'array', items: { type: 'string' }, description: 'Boundary constraints' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Goal priority', default: 'medium' },
          maxLoops: { type: 'number', description: 'Maximum loop iterations', default: 5 },
        },
        required: ['goalId', 'title', 'charter'],
      },
    },
    {
      name: 'mafw_update_state',
      description: 'Update the state file for a goal',
      inputSchema: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Goal identifier' },
          patch: { type: 'object', description: 'Partial state fields to update' },
        },
        required: ['goalId', 'patch'],
      },
    },
    {
      name: 'mafw_search_hybrid',
      description: 'Search memory units using BM25 + vector hybrid retrieval',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          topK: { type: 'number', description: 'Maximum results to return', default: 20 },
          memoryType: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'global'], description: 'Optional memory type filter' },
        },
        required: ['query'],
      },
    },
    {
      name: 'mafw_get_deltas',
      description: 'Get parametric L3 deltas for a goal and agent phase',
      inputSchema: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Goal identifier' },
          agentType: { type: 'string', enum: ['plan', 'execute', 'review'], description: 'Target agent type' },
          loopNum: { type: 'number', description: 'Current loop number' },
        },
        required: ['goalId', 'agentType'],
      },
    },
    {
      name: 'mafw_load_state',
      description: 'Load the current state file for a goal',
      inputSchema: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Goal identifier' },
        },
        required: ['goalId'],
      },
    },
    {
      name: 'mafw_ask_user',
      description: 'Ask the user a non-blocking question during execution',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question to ask the user' },
          goalId: { type: 'string', description: 'Goal identifier' },
          loopNum: { type: 'number', description: 'Current loop number' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional answer choices' },
          priority: { type: 'string', enum: ['normal', 'high'], description: 'Question priority', default: 'normal' },
        },
        required: ['question', 'goalId', 'loopNum'],
      },
    },
    {
      name: 'mafw_record_feedback',
      description: 'Record user feedback for alignment energy adjustment',
      inputSchema: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'Target identifier (e.g. wave-1, task-2)' },
          type: { type: 'string', enum: ['thumbs_up', 'thumbs_down', 'correction'], description: 'Feedback type' },
          goalId: { type: 'string', description: 'Goal identifier' },
          loopNum: { type: 'number', description: 'Current loop number' },
          comment: { type: 'string', description: 'Optional feedback comment' },
        },
        required: ['targetId', 'type', 'goalId', 'loopNum'],
      },
    },
    {
      name: 'mafw_get_model_route',
      description: 'Get the recommended model route for an agent based on budget',
      inputSchema: {
        type: 'object',
        properties: {
          agentType: { type: 'string', enum: ['plan', 'execute', 'review'], description: 'Agent type to route' },
          remainingBudget: { type: 'number', description: 'Remaining token budget' },
          totalBudget: { type: 'number', description: 'Total available token budget' },
        },
        required: ['agentType', 'remainingBudget', 'totalBudget'],
      },
    },
    {
      name: 'mafw_add_memory',
      description: 'Save a memory unit to the harmonic memory system. Agent calls this to persist reusable experiences, solutions, patterns, and insights for future retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Memory content text to remember' },
          memoryType: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'global'], description: 'Memory type. semantic=fact, episodic=narrative, procedural=pattern, global=cross-project' },
          cueAnchors: { type: 'array', items: { type: 'string' }, description: 'Tags/keywords for retrieval (max 8)' },
          primaryAbstraction: { type: 'string', description: '6-8 word summary (auto-generated from content if omitted)' },
        },
        required: ['content', 'memoryType'],
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    mafw_create_goal: async (args) => {
      try {
        const goalId = args.goalId as string;
        const title = args.title as string;
        const charter = args.charter as string;
        const source = (args.source as string) || 'user';
        const metrics = (args.metrics as Record<string, { target: number; unit: string }>) || {};
        const boundaries = (args.boundaries as string[]) || [];
        const priority = (args.priority as string) || 'medium';
        const maxLoops = (args.maxLoops as number) || 5;

        const goalsDir = path.join(projectDir, '.mafw/goals');
        const requestsDir = path.join(projectDir, '.mafw/requests');
        fs.mkdirSync(goalsDir, { recursive: true });
        fs.mkdirSync(requestsDir, { recursive: true });

        const charterPath = path.join(goalsDir, `${goalId}.md`);
        if (fs.existsSync(charterPath)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Goal ${goalId} already exists` }) }], isError: true };
        }

        fs.writeFileSync(charterPath, charter, 'utf-8');

        const request = {
          version: '2',
          goalId,
          title,
          state: 'draft',
          createdAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          source,
          projectDir,
          mafwDir: path.join(projectDir, '.mafw'),
          goalCharter: charterPath,
          metrics,
          boundaries,
          priority,
          maxLoops,
          parallel: false,
          degradeOnLoop: Math.ceil(maxLoops * 0.6),
        };

        const requestPath = path.join(requestsDir, `${goalId}.json`);
        fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), 'utf-8');

        httpPost(`${gatewayUrl}/api/events`, { type: 'goal_created', goalId, projectDir }).catch(() => {});

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, goalId, charterPath, requestPath }),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    },

    mafw_update_state: async (args) => {
      try {
        const goalId = args.goalId as string;
        const patch = args.patch as Record<string, unknown>;
        const state = await updateState(goalId, patch as any, projectDir);
        httpPost(`${gatewayUrl}/api/events`, { type: 'state_change', goalId, patch, projectDir }).catch(() => {});
        return { content: [{ type: 'text', text: JSON.stringify(state) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_search_hybrid: async (args) => {
      try {
        const query = args.query as string;
        const topK = (args.topK as number) || 20;

        const { HarmonicIndexManager } = await import('../memory/harmonic-index');
        const index = new HarmonicIndexManager(projectDir);
        const results = index.search(query, topK);

        let filtered = results;
        if (args.memoryType) {
          filtered = filtered.filter((r) => r.type === args.memoryType);
        }

        return { content: [{ type: 'text', text: JSON.stringify({ results: filtered, count: filtered.length }) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_get_deltas: async (args) => {
      try {
        const goalId = args.goalId as string;
        const agentType = args.agentType as string;
        const loopNum = (args.loopNum as number) || 1;

        const parametricDir = path.join(projectDir, '.mafw/parametric');
        const deltas: any[] = [];

        if (fs.existsSync(parametricDir)) {
          const files = fs.readdirSync(parametricDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
          for (const file of files) {
            try {
              const content = fs.readFileSync(path.join(parametricDir, file), 'utf-8');
              const yaml = await import('js-yaml');
              const doc = yaml.load(content) as any;
              if (doc && doc.scope && doc.scope.includes(agentType)) {
                deltas.push({ ...doc, sourceFile: file });
              }
            } catch {
              // skip malformed files
            }
          }
        }

        const manifestPath = path.join(parametricDir, 'manifest.json');
        const manifest: any = {};
        if (fs.existsSync(manifestPath)) {
          try {
            Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
          } catch {}
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ goalId, agentType, loopNum, deltas, manifest }),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_load_state: async (args) => {
      try {
        const goalId = args.goalId as string;
        const state = await loadState(goalId, projectDir);
        return { content: [{ type: 'text', text: JSON.stringify(state) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_ask_user: async (args) => {
      try {
        const question = args.question as string;
        const goalId = args.goalId as string;
        const loopNum = args.loopNum as number;
        const options = args.options as string[] | undefined;
        const priority = (args.priority as string) || 'normal';

        const result = await askUser({ question, options, priority: priority as 'normal' | 'high', goalId, loopNum });
        httpPost(`${gatewayUrl}/api/events`, { type: 'user_question', goalId, questionId: result.questionId }).catch(() => {});
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_record_feedback: async (args) => {
      try {
        const targetId = args.targetId as string;
        const type = args.type as 'thumbs_up' | 'thumbs_down' | 'correction';
        const goalId = args.goalId as string;
        const loopNum = args.loopNum as number;
        const comment = args.comment as string | undefined;

        const result = await recordFeedback({ targetId, type, goalId, loopNum, comment });
        httpPost(`${gatewayUrl}/api/events`, { type: 'user_feedback', goalId, targetId, feedbackType: type }).catch(() => {});
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_get_model_route: async (args) => {
      try {
        const agentType = args.agentType as 'plan' | 'execute' | 'review';
        const remainingBudget = args.remainingBudget as number;
        const totalBudget = args.totalBudget as number;

        const selection = cognitiveRouter.selectModel(agentType, remainingBudget, totalBudget);
        return { content: [{ type: 'text', text: JSON.stringify(selection) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },

    mafw_add_memory: async (args) => {
      try {
        const content = args.content as string;
        const memoryType = (args.memoryType as string) || 'semantic';
        const cueAnchors = (args.cueAnchors as string[]) || [];
        const primaryAbstraction = (args.primaryAbstraction as string) || content.slice(0, 80);

        if (!['episodic', 'semantic', 'procedural', 'global'].includes(memoryType)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Invalid memoryType: ${memoryType}` }) }], isError: true };
        }

        const now = new Date().toISOString();
        const unit: HarmonicUnit = {
          id: generateHarmonicId(),
          type: memoryType as HarmonicUnit['type'],
          primary_abstraction: primaryAbstraction.slice(0, 200),
          cue_anchors: cueAnchors.slice(0, 8),
          memory_value: content,
          energy: 0.8,
          salience: calculateSalience(content),
          abstraction_level: memoryType === 'procedural' ? 3 : memoryType === 'global' ? 4 : 2,
          created_at: now,
          updated_at: now,
        };

        const tier = 'memories';
        const memoryDir = path.join(mafwDir, 'memory');
        const filePath = path.join(memoryDir, `${tier}.json`);

        if (!fs.existsSync(memoryDir)) {
          fs.mkdirSync(memoryDir, { recursive: true });
        }

        const existing: HarmonicUnit[] = fs.existsSync(filePath)
          ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          : [];
        existing.push(unit);

        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);

        const index = new HarmonicIndexManager(mafwDir);
        index.addEntry(unit, tier);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, id: unit.id, tier, filePath }),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    },
  };

  return { definitions, handlers };
}

export async function httpPost(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // fire-and-forget, ignore network errors
  }
}
