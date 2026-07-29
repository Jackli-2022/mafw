import { HarmonicUnit, HarmonicIndex, HarmonicIndexEntry } from './harmonic-types';
interface HookManagerLike {
    execute(event: string, context: any): Promise<void>;
}
export declare class HarmonicIndexManager {
    private indexPath;
    private index;
    private hookManager;
    constructor(baseDir: string, hookManager?: HookManagerLike | null);
    private load;
    private save;
    addEntry(unit: HarmonicUnit, tier: string): void;
    removeEntry(id: string): void;
    updateEnergy(id: string, delta: number): void;
    search(query: string, topK?: number): HarmonicIndexEntry[];
    getIndex(): HarmonicIndex;
}
export {};
//# sourceMappingURL=harmonic-index.d.ts.map