/**
 * MAFW Plugin — OpenCode Official Format v5.0
 *
 * Architecture: §8.1
 * Returns an object with config, command, tool, hooks.
 * No activate() function. No registerSkill/registerCommand API.
 */
interface HybridSearchResult {
    semantic: Array<{
        id: string;
        score: number;
        facts: string[];
        concepts: string[];
        energy: number;
    }>;
    procedural: Array<{
        id: string;
        score: number;
        pattern: string;
        successRate: number;
        energy: number;
    }>;
    parametric: Array<{
        id: string;
        score: number;
        content: string;
        energy: number;
        type: string;
    }>;
    episodic: Array<{
        id: string;
        score: number;
        summary: string;
        verdict: string;
        energy: number;
    }>;
    totalTokens: number;
}
export default function MafwPlugin({ directory }: {
    directory: string;
}): Promise<{
    config: (config: any) => Promise<void>;
    'experimental.chat.messages.transform': (input: any, output: any) => Promise<void>;
    command: {
        goal: {
            description: string;
            execute(args: string, context: any): Promise<{
                type: string;
                goalId: any;
                message: string;
            } | undefined>;
        };
        status: {
            description: string;
            execute(args: string, context: any): Promise<{
                text: string;
            }>;
        };
        'mafw-loop': {
            description: string;
            execute(args: string, context: any): Promise<any>;
        };
        triage: {
            description: string;
            execute(args: string, context: any): Promise<{
                type: string;
                items: never[];
                actions?: undefined;
            } | {
                type: string;
                items: any[];
                actions: string[];
            }>;
        };
        'triage-confirm': {
            description: string;
            execute(args: string, context: any): Promise<{
                type: string;
                triageId: string;
            }>;
        };
        'automation-add': {
            description: string;
            execute(args: string, context: any): Promise<{
                type: string;
                message: string;
            }>;
        };
        'automation-list': {
            description: string;
            execute(args: string, context: any): Promise<{
                type: string;
                rules: any[];
            }>;
        };
        'automation-toggle': {
            description: string;
            execute(args: string, context: any): Promise<{
                type: string;
                autoId: string;
                enabled: any;
            }>;
        };
    };
    tool: {
        mafw_search_hybrid: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    goalId: {
                        type: string;
                    };
                    query: {
                        type: string;
                    };
                    maxResults: {
                        type: string;
                        default: number;
                    };
                    tokenBudget: {
                        type: string;
                        default: number;
                    };
                };
                required: string[];
            };
            execute({ goalId, query, maxResults, tokenBudget }: any): Promise<HybridSearchResult>;
        };
        mafw_get_deltas: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    goalId: {
                        type: string;
                    };
                    phase: {
                        type: string;
                    };
                    maxResults: {
                        type: string;
                        default: number;
                    };
                };
                required: string[];
            };
            execute({ goalId, phase, maxResults }: any): Promise<{
                deltas: any[];
            }>;
        };
        mafw_update_state: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    goalId: {
                        type: string;
                    };
                    patch: {
                        type: string;
                        description: string;
                    };
                };
                required: string[];
            };
            execute({ goalId, patch }: any): Promise<{
                updated: import("./utils/state").StateFile;
                path: string;
            }>;
        };
        mafw_load_state: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    goalId: {
                        type: string;
                    };
                };
                required: string[];
            };
            execute({ goalId }: any): Promise<any>;
        };
        mafw_ask_user: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    question: {
                        type: string;
                    };
                    goalId: {
                        type: string;
                    };
                    options: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    priority: {
                        type: string;
                        enum: string[];
                    };
                };
                required: string[];
            };
            execute({ question, goalId, options, priority }: any): Promise<import("./tools/run-ask-user").AskUserOutput>;
        };
        mafw_record_feedback: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    targetId: {
                        type: string;
                    };
                    type: {
                        type: string;
                        enum: string[];
                    };
                    goalId: {
                        type: string;
                    };
                    comment: {
                        type: string;
                    };
                };
                required: string[];
            };
            execute({ targetId, type, goalId, comment }: any): Promise<import("./tools/run-record-feedback").FeedbackOutput>;
        };
        mafw_get_model_route: {
            description: string;
            parameters: {
                type: string;
                properties: {
                    taskType: {
                        type: string;
                        enum: string[];
                    };
                    remainingBudget: {
                        type: string;
                    };
                };
                required: string[];
            };
            execute({ taskType, remainingBudget }: any): Promise<any>;
        };
    };
    hooks: {
        'session.end': (ctx: any) => Promise<void>;
        'tool.execute.after': (ctx: any, result: any) => Promise<void>;
    };
    'experimental.session.compacting': ({ sessionID }: any, { snapshot }: any) => Promise<void>;
    event: ({ event }: any) => Promise<void>;
}>;
export {};
//# sourceMappingURL=plugin.d.ts.map