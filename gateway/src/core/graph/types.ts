export type GraphNodeType = 'concept' | 'entity' | 'fact' | 'pattern';
export type GraphRelation = 'depends_on' | 'uses' | 'causes' | 'part_of' | 'implements' | 'tests' | 'co_occurs';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  energy: number;
  sourceLoops: number[];
  properties: Record<string, any>;
  createdAt: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  weight: number;
  sourceLoops: number[];
  createdAt: string;
}

export interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}
