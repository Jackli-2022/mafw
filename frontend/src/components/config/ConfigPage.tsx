import { useState, useEffect, useCallback } from 'react';
import {
  fetchModelConfig,
  updateModelConfig,
  type CurrentModelConfig,
  type AvailableProvider,
  type ModelRef,
} from '../../api/modelConfig';

interface ModelOption {
  providerID: string;
  providerName: string;
  modelID: string;
  modelName: string;
}

/** Local media ref uses provider/model (not providerID/modelID like recall). */
interface MediaRef { provider: string; model: string }

function flattenModels(providers: AvailableProvider[]): ModelOption[] {
  const out: ModelOption[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      out.push({ providerID: p.providerID, providerName: p.providerName, modelID: m.id, modelName: m.name });
    }
  }
  return out;
}

function ModelSelect({
  label,
  value,
  models,
  onChange,
  disabled,
}: {
  label: string;
  value: ModelRef;
  models: ModelOption[];
  onChange: (v: ModelRef) => void;
  disabled?: boolean;
}) {
  const grouped = new Map<string, ModelOption[]>();
  for (const m of models) {
    const list = grouped.get(m.providerID) || [];
    list.push(m);
    grouped.set(m.providerID, list);
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>
      <div className="flex gap-2">
        <select
          value={value.providerID}
          onChange={(e) => {
            const providerID = e.target.value;
            const first = grouped.get(providerID)?.[0];
            onChange({ providerID, modelID: first?.modelID || '' });
          }}
          disabled={disabled}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
        >
          {Array.from(grouped.entries()).map(([pid, opts]) => (
            <option key={pid} value={pid}>{opts[0].providerName}</option>
          ))}
        </select>
        <select
          value={value.modelID}
          onChange={(e) => onChange({ ...value, modelID: e.target.value })}
          disabled={disabled}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
        >
          {(grouped.get(value.providerID) || []).map((m) => (
            <option key={m.modelID} value={m.modelID}>{m.modelName}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<CurrentModelConfig | null>(null);
  const [available, setAvailable] = useState<AvailableProvider[] | null>(null);

  const [recallEdit, setRecallEdit] = useState<ModelRef>({ providerID: '', modelID: '' });
  const [mediaProviderEdit, setMediaProviderEdit] = useState('');
  const [mediaModelEdit, setMediaModelEdit] = useState('');
  const [mediaImageEdit, setMediaImageEdit] = useState<MediaRef>({ provider: '', model: '' });
  const [mediaVideoEdit, setMediaVideoEdit] = useState<MediaRef>({ provider: '', model: '' });
  const [mediaAudioEdit, setMediaAudioEdit] = useState<MediaRef>({ provider: '', model: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchModelConfig();
    if (!data) { setError('Failed to load model config'); setLoading(false); return; }
    setConfig(data);
    setAvailable(data.available);
    setRecallEdit(data.recall.workerModel);
    setMediaProviderEdit(data.media.provider || '');
    setMediaModelEdit(data.media.model || '');
    setMediaImageEdit({ provider: data.media.image?.provider || '', model: data.media.image?.model || '' });
    setMediaVideoEdit({ provider: data.media.video?.provider || '', model: data.media.video?.model || '' });
    setMediaAudioEdit({ provider: data.media.audio?.provider || '', model: data.media.audio?.model || '' });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const models = available ? flattenModels(available) : [];

  const hasChanges = config && (
    recallEdit.providerID !== config.recall.workerModel.providerID ||
    recallEdit.modelID !== config.recall.workerModel.modelID ||
    mediaProviderEdit !== (config.media.provider || '') ||
    mediaModelEdit !== (config.media.model || '') ||
    mediaImageEdit.provider !== (config.media.image?.provider || '') ||
    mediaImageEdit.model !== (config.media.image?.model || '') ||
    mediaVideoEdit.provider !== (config.media.video?.provider || '') ||
    mediaVideoEdit.model !== (config.media.video?.model || '') ||
    mediaAudioEdit.provider !== (config.media.audio?.provider || '') ||
    mediaAudioEdit.model !== (config.media.audio?.model || '')
  );

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    setError(null);

    const result = await updateModelConfig({
      recall: { providerID: recallEdit.providerID, modelID: recallEdit.modelID },
      media: {
        provider: mediaProviderEdit,
        model: mediaModelEdit,
        image: { provider: mediaImageEdit.provider || undefined, model: mediaImageEdit.model || undefined },
        video: { provider: mediaVideoEdit.provider || undefined, model: mediaVideoEdit.model || undefined },
        audio: { provider: mediaAudioEdit.provider || undefined, model: mediaAudioEdit.model || undefined },
      },
    });

    if (result.success) {
      setSaveMsg('模型配置已保存');
      await load();
    } else {
      setError(result.error || 'Save failed');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">加载模型配置...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-200">模型配置</h2>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${hasChanges && !saving
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-white/5 text-gray-600 cursor-not-allowed'}`}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}
      {saveMsg && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-green-400 text-sm">
          {saveMsg}
        </div>
      )}

      {!available && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 text-yellow-400 text-sm">
          无法获取可用模型列表（opencode 未连接）。下拉框将显示当前配置值，但无法验证选择。
        </div>
      )}

      {/* Recall Worker Model */}
      <section className="bg-white/5 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">记忆 Worker 模型</h3>
          <p className="text-xs text-gray-500 mt-1">
            用于反思、索引扫描、轮次压缩等后台记忆管线任务。
          </p>
        </div>
        <ModelSelect
          label="Worker Model"
          value={recallEdit}
          models={models}
          onChange={setRecallEdit}
        />
      </section>

      {/* Media Models */}
      <section className="bg-white/5 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">媒体分析模型</h3>
          <p className="text-xs text-gray-500 mt-1">
            用于图片、视频、音频的多模态分析。顶部为全局默认值，下方可按模态覆盖。
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider">全局默认 Provider &amp; Model</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={mediaProviderEdit}
              onChange={(e) => setMediaProviderEdit(e.target.value)}
              placeholder="Provider (e.g. xiaomi)"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="text"
              value={mediaModelEdit}
              onChange={(e) => setMediaModelEdit(e.target.value)}
              placeholder="Model (e.g. mimo-v2.5)"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <hr className="border-white/5" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {([
            { label: '图片 (Image)', value: mediaImageEdit, set: setMediaImageEdit },
            { label: '视频 (Video)', value: mediaVideoEdit, set: setMediaVideoEdit },
            { label: '音频 (Audio)', value: mediaAudioEdit, set: setMediaAudioEdit },
          ] as const).map(({ label, value, set }) => (
            <div key={label} className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>
              <input
                type="text"
                value={value.provider}
                onChange={(e) => set({ ...value, provider: e.target.value })}
                placeholder="Provider (留空=全局)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="text"
                value={value.model}
                onChange={(e) => set({ ...value, model: e.target.value })}
                placeholder="Model (留空=全局)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      </section>

      <div className="text-xs text-gray-600 space-y-1">
        <p>• Worker 模型修改后立即生效，无需重启。</p>
        <p>• 媒体模型修改后影响新任务，不影响进行中的任务。</p>
        <p>• 配置持久化到 <code className="text-gray-500">~/.mafw/config.yaml</code>。</p>
      </div>
    </div>
  );
}
