export default function MafwPlugin({ directory }: {
    directory: string;
}): Promise<{
    config: {
        skills: {
            name: string;
            enabled: boolean;
        }[];
    };
    hooks: {
        'session.end': (ctx: any) => Promise<void>;
        'tool.execute.before': (ctx: any) => Promise<void>;
        'tool.execute.after': (ctx: any, result: any) => Promise<void>;
        'chat.message': (ctx: any) => Promise<void>;
        'experimental.chat.messages.transform': (input: any, output: any) => Promise<any>;
        'experimental.chat.system.transform': (input: any, output: any) => any;
    };
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
        'merge-memory': {
            description: string;
            execute(args: string, context: any): Promise<{
                text: string;
            }>;
        };
    };
}>;
//# sourceMappingURL=plugin.d.ts.map