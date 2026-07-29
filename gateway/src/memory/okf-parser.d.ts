export interface OKFResult {
    unit: Record<string, any>;
    body: string;
    links: string[];
}
export declare function parseOKF(content: string): OKFResult;
export declare function readOKFFile(filePath: string): OKFResult;
//# sourceMappingURL=okf-parser.d.ts.map