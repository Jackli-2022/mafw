/**
 * MAFW Plugin — OpenCode Official Format v4.1
 *
 * Architecture: §8.1
 * Returns an object with config, command, tool, hooks.
 * No activate() function. No registerSkill/registerCommand API.
 */
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
                updated: any;
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
    };
    'tool.execute.after': ({ tool }: any, { output }: any) => Promise<void>;
    'experimental.session.compacting': ({ sessionID }: any, { snapshot }: any) => Promise<void>;
    event: ({ event }: any) => Promise<void>;
}>;
//# sourceMappingURL=plugin.d.ts.map