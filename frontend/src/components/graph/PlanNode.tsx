import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { NodeStatus } from '../../types';

const STATUS_STYLES: Record<NodeStatus, string> = {
  idle: 'bg-white/5 border-white/10',
  running: 'bg-blue-500/15 border-blue-500/40 node-running',
  done: 'bg-green-500/10 border-green-500/30',
  error: 'bg-red-500/10 border-red-500/40',
};

const STATUS_DOTS: Record<NodeStatus, string> = {
  idle: 'bg-gray-600',
  running: 'bg-blue-400 shadow-lg shadow-blue-500/30',
  done: 'bg-green-400',
  error: 'bg-red-400',
};

const STATUS_GRADIENTS: Record<NodeStatus, string> = {
  idle: '',
  running: 'bg-gradient-to-br from-blue-500/10 to-purple-500/5',
  done: '',
  error: '',
};

interface BaseNodeProps extends NodeProps {
  data: { status?: NodeStatus; label?: string };
}

function BaseNode({ data }: BaseNodeProps) {
  const status = data.status || 'idle';
  return (
    <div className={`px-5 py-3 rounded-xl border backdrop-blur-sm ${STATUS_STYLES[status]} ${STATUS_GRADIENTS[status]} transition-all duration-500`}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-600 !border-2 !border-[#080b14]" />
      <div className="flex items-center gap-2.5">
        <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOTS[status]} transition-all duration-500`} />
        <span className={`text-sm font-medium tracking-wide ${status === 'idle' ? 'text-gray-400' : 'text-gray-200'}`}>{data.label || 'Node'}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-gray-600 !border-2 !border-[#080b14]" />
    </div>
  );
}

export const PlanNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: 'Plan' }} />);
export const ExecuteNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: 'Execute' }} />);
export const ReviewNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: 'Review' }} />);
export const ArchiveNode = memo((props: NodeProps) => <BaseNode {...props} data={{ ...props.data, label: props.data.label || 'Archive' }} />);
