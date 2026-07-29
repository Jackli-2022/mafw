export interface StorageBackend {
  get(scope: string, key: string): Promise<any>;
  set(scope: string, key: string, value: any): Promise<void>;
  delete(scope: string, key: string): Promise<void>;
  query(scope: string, filter?: { query?: string; energyMin?: number; limit?: number }): Promise<any[]>;
  batch(operations: Array<{ type: 'set' | 'delete'; scope: string; key: string; value?: any }>): Promise<void>;
}
