import { GraphEdge, GraphRelation } from './types';

export class RelationInferencer {
  inferRelations(entities: string[], context: string): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const sentences = context.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);

    const entitiesInSentence = (sentence: string): string[] => {
      return entities.filter(e => sentence.toLowerCase().includes(e.toLowerCase()));
    };

    for (const sentence of sentences) {
      const present = entitiesInSentence(sentence);

      if (present.length >= 2) {
        for (let i = 0; i < present.length; i++) {
          for (let j = i + 1; j < present.length; j++) {
            edges.push({
              id: this.generateId(),
              source: present[i],
              target: present[j],
              relation: 'co_occurs',
              weight: 0.5,
              sourceLoops: [],
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      if (present.length >= 2) {
        const lower = sentence.toLowerCase();
        let relation: GraphRelation | null = null;
        let weight = 0;

        if (/\b(depends on|requires|uses)\b/i.test(lower)) {
          relation = 'depends_on';
          weight = 0.7;
        } else if (/\b(error|fix|bug|issue)\b/i.test(lower)) {
          relation = 'causes';
          weight = 0.8;
        } else if (/\b(part of|belongs to)\b/i.test(lower)) {
          relation = 'part_of';
          weight = 0.6;
        }

        if (relation) {
          for (let i = 0; i < present.length; i++) {
            for (let j = i + 1; j < present.length; j++) {
              edges.push({
                id: this.generateId(),
                source: present[i],
                target: present[j],
                relation,
                weight,
                sourceLoops: [],
                createdAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    return edges;
  }

  private generateId(): string {
    return `edge-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
