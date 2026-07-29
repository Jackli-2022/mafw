import { HarmonicUnit } from '../core/memory/harmonic-types';
import { HarmonicIndexManager } from '../core/memory/harmonic-index';
export declare class HarmonicUnitFileStore {
    private baseDir;
    private indexManager;
    private graphManager;
    private eventLog;
    private writeQueue;
    private anchorGraph;
    constructor(baseDir: string, indexManager?: HarmonicIndexManager);
    write(unit: HarmonicUnit, tier?: string): Promise<string>;
    read(id: string): Promise<HarmonicUnit | null>;
    indexManager_(): HarmonicIndexManager;
    archive(id: string): Promise<void>;
}
//# sourceMappingURL=harmonic-file-store.d.ts.map