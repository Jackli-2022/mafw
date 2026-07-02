export interface WaveDependency {
  waveNum: number;
  dependsOn: number[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export class WaveDependencyManager {
  private dependencies: Map<string, WaveDependency[]> = new Map();

  private key(goalId: string, loopNum: number): string {
    return `${goalId}:${loopNum}`;
  }

  setDependencies(goalId: string, loopNum: number, deps: WaveDependency[]): void {
    this.dependencies.set(this.key(goalId, loopNum), deps);
  }

  canStartWave(goalId: string, loopNum: number, waveNum: number): boolean {
    const deps = this.dependencies.get(this.key(goalId, loopNum));
    if (!deps) return false;
    const wave = deps.find(d => d.waveNum === waveNum);
    if (!wave) return false;
    if (wave.dependsOn.length === 0) return true;
    return wave.dependsOn.every(depNum => {
      const dep = deps.find(d => d.waveNum === depNum);
      return dep && dep.status === 'completed';
    });
  }

  updateWaveStatus(
    goalId: string,
    loopNum: number,
    waveNum: number,
    status: WaveDependency['status']
  ): void {
    const deps = this.dependencies.get(this.key(goalId, loopNum));
    if (!deps) return;
    const wave = deps.find(d => d.waveNum === waveNum);
    if (wave) {
      wave.status = status;
    }
  }

  getReadyWaves(goalId: string, loopNum: number): number[] {
    const deps = this.dependencies.get(this.key(goalId, loopNum));
    if (!deps) return [];
    return deps
      .filter(w => w.status === 'pending' && this.canStartWave(goalId, loopNum, w.waveNum))
      .map(w => w.waveNum);
  }

  getBlockedWaves(goalId: string, loopNum: number): number[] {
    const deps = this.dependencies.get(this.key(goalId, loopNum));
    if (!deps) return [];
    return deps
      .filter(w => w.status === 'pending' && !this.canStartWave(goalId, loopNum, w.waveNum))
      .map(w => w.waveNum);
  }

  getAllStatus(goalId: string, loopNum: number): WaveDependency[] {
    const deps = this.dependencies.get(this.key(goalId, loopNum));
    return deps ? [...deps] : [];
  }

  getCompletedWaves(goalId: string, loopNum: number): number[] {
    const deps = this.dependencies.get(this.key(goalId, loopNum));
    if (!deps) return [];
    return deps
      .filter(w => w.status === 'completed')
      .map(w => w.waveNum);
  }

  clear(goalId: string, loopNum: number): void {
    this.dependencies.delete(this.key(goalId, loopNum));
  }
}
