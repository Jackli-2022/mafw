import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { NodeStatus } from '../../types';

const STATUS_STYLES: Record<NodeStatus, string> = {
  idle: 'bg-gray-800/30 border-gray-700/30',
  running: 'bg-blue-500/10 border-blue-500/50 shadow-lg shadow-blue-500/10 animate-pulse',
  done: 'bg-green-500/10 border-green-500/30',
  error: 'bg-red-500/10 border-red-500/50',
};

const STATUS_DOTS: Record<NodeStatus, string> = {
  idle: 'bg-gray-600',
  running: 'bg-blue-400',
  done: 'bg-green-400',
  error: 'bg-red-400',
};

interface BaseNodeProps extends NodeProps {
  data: { status?: NodeStatus; label?: string };
}

function BaseNode({ data }: BaseNodeProps) {
  const status = data.status || 'idle';
  return (
    <div className={`px-6 py-3 rounded-xl border ${STATUS_STYLES[status]} transition-all duration-300`}>
      <Handle type="target" position={Position.Top} className="!bg-gray-600" />
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${STATUS_DOTS[status]}`} />
        <span className="text-sm font-medium text-gray-200">{data.label || 'Node'}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-600" />
    </div>
  );
}

export const PlanNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: 'Plan' }} />);
export const ExecuteNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: 'Execute' }} />);
export const ReviewNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: 'Review' }} />);
export const ArchiveNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: props.data.label || 'Archive' }} />);
