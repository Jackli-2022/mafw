import { useEffect, useCallback } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphState } from '../../hooks/useGraphState';
import { PlanNode, ExecuteNode, ReviewNode, ArchiveNode } from './PlanNode';

const nodeTypes = {
  plan: PlanNode,
  execute: ExecuteNode,
  review: ReviewNode,
  archive: ArchiveNode,
};

const initialNodes: Node[] = [
  { id: 'PLAN', type: 'plan', position: { x: 250, y: 0 }, data: { status: 'idle' } },
  { id: 'EXECUTE', type: 'execute', position: { x: 250, y: 100 }, data: { status: 'idle' } },
  { id: 'REVIEW', type: 'review', position: { x: 250, y: 200 }, data: { status: 'idle' } },
  { id: 'ARCHIVE_SUCCESS', type: 'archive', position: { x: 100, y: 320 }, data: { status: 'idle', label: 'Success' } },
  { id: 'ARCHIVE_FAIL', type: 'archive', position: { x: 250, y: 320 }, data: { status: 'idle', label: 'Fail' } },
  { id: 'ARCHIVE_MAX_RETRIES', type: 'archive', position: { x: 400, y: 320 }, data: { status: 'idle', label: 'Max Retries' } },
];

const initialEdges: Edge[] = [
  { id: 'e-plan-execute', source: 'PLAN', target: 'EXECUTE', animated: true, style: { stroke: '#5b8def' } },
  { id: 'e-execute-review', source: 'EXECUTE', target: 'REVIEW', animated: true, style: { stroke: '#5b8def' } },
  {
    id: 'e-review-success', source: 'REVIEW', target: 'ARCHIVE_SUCCESS', label: 'PASS',
    animated: true, style: { stroke: '#3bc98a' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3bc98a' },
  },
  {
    id: 'e-review-fail', source: 'REVIEW', target: 'ARCHIVE_FAIL', label: 'ERROR',
    style: { stroke: '#e8636b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e8636b' },
  },
  {
    id: 'e-review-retry', source: 'REVIEW', target: 'PLAN', label: 'FAIL (retry)',
    style: { stroke: '#e8b84b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e8b84b' },
  },
  {
    id: 'e-review-max', source: 'REVIEW', target: 'ARCHIVE_MAX_RETRIES', label: 'max retries',
    style: { stroke: '#e8636b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e8636b' },
  },
];

export function LangGraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const { nodeStatuses } = useGraphState();

  const syncNodes = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: { ...node.data, status: nodeStatuses[node.id] || 'idle' },
      }))
    );
  }, [nodeStatuses, setNodes]);

  useEffect(() => { syncNodes(); }, [syncNodes]);

  return (
    <div className="h-[600px] rounded-xl border border-white/5 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(8,11,20,0.95) 0%, rgba(16,22,40,0.8) 100%)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={2}
      >
        <Background color="rgba(255,255,255,0.03)" gap={24} />
        <Controls className="!bg-white/5 !border !border-white/10 !rounded-lg !backdrop-blur-sm [&_button]:!border-white/10 [&_button]:!text-gray-400 [&_button:hover]:!bg-white/10" />
      </ReactFlow>
    </div>
  );
}
