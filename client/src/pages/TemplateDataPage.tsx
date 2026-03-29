import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { templates } from '../api';
import { LayoutContext } from '../components/Layout';
import { ConnectorConfig, PeriodSnapshot, TemplateDetail, VariableDraft } from '../types';
import { extractJsonPaths, getJsonValue } from '../utils/json-path';
import { getDefaultPeriodKey } from '../utils/periods';

const EMPTY_CONNECTOR: ConnectorConfig = {
  templateId: '',
  mode: 'mock',
  enabled: false,
  method: 'GET',
  url: '',
  headersText: '',
  queryText: '',
  bodyText: '',
  responsePath: '',
  timeoutMs: 15000,
  cacheTtlSeconds: 21600,
  updatedAt: '',
};

type FilterMode = 'all' | 'unmapped' | 'mapped';

export function TemplateDataPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshReports, refreshTemplates } = useOutletContext<LayoutContext>();

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [variables, setVariables] = useState<VariableDraft[]>([]);
  const [connector, setConnector] = useState<ConnectorConfig>(EMPTY_CONNECTOR);
  const [jsonInput, setJsonInput] = useState('');
  const [jsonPaths, setJsonPaths] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState('');
  const [snapshotForm, setSnapshotForm] = useState({
    periodKey: '',
    periodLabel: '',
    payloadText: '',
  });
  const [snapshotError, setSnapshotError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('unmapped');
  const [selectedVariableIndex, setSelectedVariableIndex] = useState<number | null>(null);
  const [savingVariables, setSavingVariables] = useState(false);
  const [savingConnector, setSavingConnector] = useState(false);
  const [loading, setLoading] = useState(true);

  const hydrateTemplate = (result: TemplateDetail) => {
    const nextVariables = toVariableDrafts(result);
    setTemplate(result);
    setVariables(nextVariables);
    setConnector(result.connector);

    const latestSnapshot = result.snapshots[0];
    if (latestSnapshot) {
      const payloadText = JSON.stringify(latestSnapshot.payload, null, 2);
      setJsonInput(payloadText);
      setJsonPaths(extractJsonPaths(latestSnapshot.payload));
      setSnapshotForm({
        periodKey: latestSnapshot.periodKey,
        periodLabel: latestSnapshot.periodLabel,
        payloadText,
      });
    } else {
      setJsonInput('');
      setJsonPaths([]);
      setSnapshotForm({
        periodKey: getDefaultPeriodKey(result.periodType),
        periodLabel: '',
        payloadText: '',
      });
    }

    setSelectedVariableIndex((current) => {
      if (nextVariables.length === 0) {
        return null;
      }
      if (current === null || !nextVariables[current]) {
        return 0;
      }
      return current;
    });
  };

  const loadTemplate = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const result = await templates.get(id);
      hydrateTemplate(result);
      setMessage('');
      setJsonError('');
      setSnapshotError('');
    } catch (error) {
      setTemplate(null);
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplate();
  }, [id]);

  const mappedCount = useMemo(() => variables.filter((variable) => variable.jsonPath.trim()).length, [variables]);
  const unmappedCount = variables.length - mappedCount;

  const filteredVariables = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...variables].sort((left, right) => {
      if (filterMode === 'unmapped') {
        const leftMapped = left.jsonPath.trim().length > 0 ? 1 : 0;
        const rightMapped = right.jsonPath.trim().length > 0 ? 1 : 0;
        if (leftMapped !== rightMapped) {
          return leftMapped - rightMapped;
        }
      }
      return left.label.localeCompare(right.label, 'zh-CN');
    });

    return sorted.filter((variable) => {
      const mapped = variable.jsonPath.trim().length > 0;
      if (filterMode === 'mapped' && !mapped) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [variable.label, variable.key, variable.jsonPath, variable.sourceText]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [filterMode, search, variables]);

  useEffect(() => {
    if (filteredVariables.length === 0) {
      setSelectedVariableIndex(null);
      return;
    }

    if (
      selectedVariableIndex === null ||
      !variables[selectedVariableIndex] ||
      !filteredVariables.some((variable) => variable.key === variables[selectedVariableIndex]?.key)
    ) {
      const nextKey = filteredVariables[0].key;
      const nextIndex = variables.findIndex((variable) => variable.key === nextKey);
      setSelectedVariableIndex(nextIndex >= 0 ? nextIndex : 0);
    }
  }, [filteredVariables, selectedVariableIndex, variables]);

  const activeVariable =
    selectedVariableIndex !== null && variables[selectedVariableIndex] ? variables[selectedVariableIndex] : null;

  const suggestedJsonPaths = useMemo(() => {
    if (!activeVariable || jsonPaths.length === 0) {
      return [];
    }

    const keywords = [activeVariable.label, activeVariable.key, activeVariable.sourceText]
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .filter((item) => item.length >= 2);

    const ranked = jsonPaths.filter((path) => keywords.some((keyword) => path.toLowerCase().includes(keyword)));
    return [...ranked, ...jsonPaths].filter((path, index, array) => array.indexOf(path) === index).slice(0, 24);
  }, [activeVariable, jsonPaths]);

  const handleJsonChange = (value: string) => {
    setJsonInput(value);
    setJsonError('');
    if (!value.trim()) {
      setJsonPaths([]);
      return;
    }

    try {
      const payload = JSON.parse(value);
      setJsonPaths(extractJsonPaths(payload));
    } catch {
      setJsonError('JSON 格式无效');
      setJsonPaths([]);
    }
  };

  const updateVariable = (index: number, patch: Partial<VariableDraft>) => {
    setVariables((current) =>
      current.map((variable, variableIndex) => (variableIndex === index ? { ...variable, ...patch } : variable))
    );
  };

  const saveVariables = async () => {
    if (!id) {
      return;
    }

    setSavingVariables(true);
    try {
      const updated = await templates.saveVariables(id, variables);
      hydrateTemplate(updated);
      await refreshTemplates();
      await refreshReports();
      setMessage('字段映射已保存');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSavingVariables(false);
    }
  };

  const saveConnector = async () => {
    if (!id) {
      return;
    }

    setSavingConnector(true);
    try {
      const updated = await templates.saveConnector(id, connector);
      setConnector(updated);
      setMessage('数据源配置已保存');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSavingConnector(false);
    }
  };

  const saveSnapshot = async () => {
    if (!id) {
      return;
    }

    setSnapshotError('');
    try {
      const payload = JSON.parse(snapshotForm.payloadText);
      await templates.upsertSnapshot(id, {
        periodKey: snapshotForm.periodKey,
        periodLabel: snapshotForm.periodLabel || snapshotForm.periodKey,
        payload,
        sourceKind: 'mock',
      });
      handleJsonChange(snapshotForm.payloadText);
      await loadTemplate();
      setMessage('样例数据已保存');
    } catch (error) {
      setSnapshotError((error as Error).message);
    }
  };

  const deleteSnapshot = async (snapshot: PeriodSnapshot) => {
    if (!id || !confirm(`确定删除 ${snapshot.periodLabel} 的样例数据吗？`)) {
      return;
    }

    await templates.deleteSnapshot(id, snapshot.id);
    await loadTemplate();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <span className="material-symbols-outlined mr-2 animate-spin">progress_activity</span>
        正在加载数据绑定...
      </div>
    );
  }

  if (!template) {
    return <div className="flex h-full items-center justify-center text-gray-400">{message || '未找到模板'}</div>;
  }

  return (
    <div className="flex h-full flex-col bg-[#f4f7fb]">
      <header className="shrink-0 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate(`/templates/${template.id}`)}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                返回标注页
              </button>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                数据绑定
              </span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{template.name}</h1>
              <p className="mt-1 text-xs text-slate-500">
                这里统一处理接口配置、样例数据和字段映射，配置动作集中在一页完成，不再和文档标注混在一起。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/templates/${template.id}/variables`)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
            >
              变量总表
            </button>
            <button
              onClick={saveVariables}
              disabled={savingVariables}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-light disabled:opacity-50"
            >
              {savingVariables ? '保存中...' : '保存字段映射'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-[1440px] gap-6 xl:grid-cols-[minmax(360px,0.92fr)_minmax(420px,1.08fr)]">
          <div className="space-y-4">
            {message && (
              <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                {message}
              </div>
            )}

            <DataSourceCard
              connector={connector}
              savingConnector={savingConnector}
              onSave={saveConnector}
              onChange={setConnector}
            />

            <SampleDataCard
              jsonPaths={jsonPaths}
              jsonError={jsonError}
              snapshotError={snapshotError}
              snapshotForm={snapshotForm}
              onSnapshotFormChange={setSnapshotForm}
              onJsonChange={handleJsonChange}
              onSaveSnapshot={saveSnapshot}
            />

            <SavedSnapshotsCard
              snapshots={template.snapshots}
              onUse={(snapshot) => {
                const payloadText = JSON.stringify(snapshot.payload, null, 2);
                setSnapshotForm({
                  periodKey: snapshot.periodKey,
                  periodLabel: snapshot.periodLabel,
                  payloadText,
                });
                handleJsonChange(payloadText);
              }}
              onDelete={deleteSnapshot}
            />
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">字段映射工作台</div>
                  <p className="mt-1 text-xs leading-6 text-slate-500">
                    先选变量，再点路径。手输路径保留作兜底，但不再作为主操作。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SummaryChip label="总变量" value={String(variables.length)} tone="default" />
                  <SummaryChip label="已映射" value={String(mappedCount)} tone="success" />
                  <SummaryChip label="待映射" value={String(unmappedCount)} tone={unmappedCount > 0 ? 'warn' : 'default'} />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {(['unmapped', 'mapped', 'all'] as FilterMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFilterMode(mode)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      filterMode === mode
                        ? 'bg-primary text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary'
                    }`}
                  >
                    {mode === 'unmapped' ? '待映射优先' : mode === 'mapped' ? '只看已映射' : '查看全部'}
                  </button>
                ))}
              </div>

              <div className="relative mt-4">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  search
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-white"
                  placeholder="搜索变量名、编码、原文片段"
                />
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.94fr)_minmax(320px,0.86fr)]">
              <VariableMappingList
                variables={variables}
                filteredVariables={filteredVariables}
                selectedVariableIndex={selectedVariableIndex}
                onSelect={setSelectedVariableIndex}
              />

              <div className="space-y-4">
                <CurrentMappingCard
                  activeVariable={activeVariable}
                  selectedVariableIndex={selectedVariableIndex}
                  onUpdate={updateVariable}
                />

                <PathSuggestionCard
                  activeVariable={activeVariable}
                  jsonInput={jsonInput}
                  jsonError={jsonError}
                  selectedVariableIndex={selectedVariableIndex}
                  suggestedJsonPaths={suggestedJsonPaths}
                  onPickPath={(path) => {
                    if (selectedVariableIndex !== null) {
                      updateVariable(selectedVariableIndex, { jsonPath: path });
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function toVariableDrafts(template: TemplateDetail): VariableDraft[] {
  return template.variables.map((variable) => ({
    id: variable.id,
    candidateId: variable.candidateId,
    paragraphId: variable.paragraphId,
    key: variable.key,
    label: variable.label,
    jsonPath: variable.jsonPath,
    sourceText: variable.sourceText,
  }));
}

function DataSourceCard(props: {
  connector: ConnectorConfig;
  savingConnector: boolean;
  onSave: () => void;
  onChange: (connector: ConnectorConfig) => void;
}) {
  const { connector, savingConnector, onSave, onChange } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">数据源接入</div>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            先确定这份模板是走接口还是走样例数据，再决定字段映射从哪里来。
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={savingConnector}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-light disabled:opacity-50"
        >
          {savingConnector ? '保存中...' : '保存数据源'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>取数模式</span>
          <select
            value={connector.mode}
            onChange={(event) => onChange({ ...connector, mode: event.target.value as ConnectorConfig['mode'] })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="mock">样例数据</option>
            <option value="http">HTTP 接口</option>
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>接口启用</span>
          <select
            value={connector.enabled ? '1' : '0'}
            onChange={(event) => onChange({ ...connector, enabled: event.target.value === '1' })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="0">未启用</option>
            <option value="1">启用</option>
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>Method</span>
          <select
            value={connector.method}
            onChange={(event) => onChange({ ...connector, method: event.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>响应路径</span>
          <input
            value={connector.responsePath}
            onChange={(event) => onChange({ ...connector, responsePath: event.target.value })}
            placeholder="例如 data.result"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      <label className="mt-3 block space-y-1 text-[11px] text-slate-500">
        <span>接口地址</span>
        <input
          value={connector.url}
          onChange={(event) => onChange({ ...connector, url: event.target.value })}
          placeholder="https://example.com/api/report?year={{year}}"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <div className="mt-3 grid gap-3">
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>Headers(JSON)</span>
          <textarea
            value={connector.headersText}
            onChange={(event) => onChange({ ...connector, headersText: event.target.value })}
            className="h-20 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] outline-none focus:border-primary"
            spellCheck={false}
            placeholder={'{\n  "Authorization": "Bearer xxx"\n}'}
          />
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>Query(JSON)</span>
          <textarea
            value={connector.queryText}
            onChange={(event) => onChange({ ...connector, queryText: event.target.value })}
            className="h-20 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] outline-none focus:border-primary"
            spellCheck={false}
            placeholder={'{\n  "year": "{{year}}"\n}'}
          />
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>Body(JSON)</span>
          <textarea
            value={connector.bodyText}
            onChange={(event) => onChange({ ...connector, bodyText: event.target.value })}
            className="h-24 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] outline-none focus:border-primary"
            spellCheck={false}
            placeholder={'{\n  "period": "{{period}}"\n}'}
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>超时(ms)</span>
          <input
            type="number"
            value={connector.timeoutMs}
            onChange={(event) => onChange({ ...connector, timeoutMs: Number(event.target.value) || 15000 })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          <span>缓存 TTL(秒)</span>
          <input
            type="number"
            value={connector.cacheTtlSeconds}
            onChange={(event) => onChange({ ...connector, cacheTtlSeconds: Number(event.target.value) || 21600 })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>
    </div>
  );
}

function SampleDataCard(props: {
  jsonPaths: string[];
  jsonError: string;
  snapshotError: string;
  snapshotForm: { periodKey: string; periodLabel: string; payloadText: string };
  onSnapshotFormChange: (value: { periodKey: string; periodLabel: string; payloadText: string }) => void;
  onJsonChange: (value: string) => void;
  onSaveSnapshot: () => void;
}) {
  const { jsonPaths, jsonError, snapshotError, snapshotForm, onSnapshotFormChange, onJsonChange, onSaveSnapshot } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">样例数据 / 映射辅助</div>
          <p className="mt-1 text-xs leading-6 text-slate-500">把接口返回样例或模拟数据贴到这里，右侧会直接给出可选字段路径。</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
          {jsonPaths.length} 个路径
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <input
          value={snapshotForm.periodKey}
          onChange={(event) => onSnapshotFormChange({ ...snapshotForm, periodKey: event.target.value })}
          placeholder="2025 / 2025-Q4 / 2026-02"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          value={snapshotForm.periodLabel}
          onChange={(event) => onSnapshotFormChange({ ...snapshotForm, periodLabel: event.target.value })}
          placeholder="例如 2024年度"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <textarea
        value={snapshotForm.payloadText}
        onChange={(event) => {
          onSnapshotFormChange({ ...snapshotForm, payloadText: event.target.value });
          onJsonChange(event.target.value);
        }}
        className="mt-3 h-52 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-[12px] text-slate-700 outline-none transition focus:border-primary"
        spellCheck={false}
        placeholder={'{\n  "summary": {\n    "totalAssets": "806.55"\n  }\n}'}
      />

      {jsonError && <p className="mt-2 text-xs text-red-500">{jsonError}</p>}
      {snapshotError && <p className="mt-2 text-xs text-red-500">{snapshotError}</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">推荐把最新接口返回粘贴到这里，再去右侧点选字段完成映射。</p>
        <button
          onClick={onSaveSnapshot}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-light"
        >
          保存样例数据
        </button>
      </div>
    </div>
  );
}

function SavedSnapshotsCard(props: {
  snapshots: PeriodSnapshot[];
  onUse: (snapshot: PeriodSnapshot) => void;
  onDelete: (snapshot: PeriodSnapshot) => void;
}) {
  const { snapshots, onUse, onDelete } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-slate-900">已保存的样例数据</div>
      <div className="space-y-2">
        {snapshots.length > 0 ? (
          snapshots.map((snapshot) => (
            <div key={snapshot.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-700">{snapshot.periodLabel}</div>
                <div className="mt-1 text-[10px] text-slate-400">
                  {snapshot.periodKey} · {new Date(snapshot.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUse(snapshot)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-primary hover:text-primary"
                >
                  用作映射样例
                </button>
                <button onClick={() => onDelete(snapshot)} className="text-gray-300 transition hover:text-red-500">
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400">
            还没有保存样例数据
          </div>
        )}
      </div>
    </div>
  );
}

function VariableMappingList(props: {
  variables: VariableDraft[];
  filteredVariables: VariableDraft[];
  selectedVariableIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const { variables, filteredVariables, selectedVariableIndex, onSelect } = props;

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <div className="max-h-[720px] divide-y divide-slate-200 overflow-y-auto">
        {filteredVariables.length > 0 ? (
          filteredVariables.map((variable) => {
            const variableIndex = variables.findIndex(
              (item) => item.key === variable.key && item.label === variable.label && item.sourceText === variable.sourceText
            );
            const isActive = variableIndex === selectedVariableIndex;
            const mapped = Boolean(variable.jsonPath.trim());

            return (
              <button
                key={`${variable.key}-${variable.label}-${variableIndex}`}
                onClick={() => onSelect(variableIndex)}
                className={`w-full px-4 py-4 text-left transition ${isActive ? 'bg-primary/[0.05]' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{variable.label || '未命名变量'}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">{variable.key || '未生成编码'}</div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      mapped ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {mapped ? '已映射' : '待映射'}
                  </span>
                </div>
                <div className="mt-2 truncate text-xs text-slate-500">{variable.sourceText || '未绑定原文片段'}</div>
                <div className="mt-2 truncate text-[11px] text-slate-400">{mapped ? variable.jsonPath : '尚未选择字段路径'}</div>
              </button>
            );
          })
        ) : (
          <div className="px-6 py-16 text-center text-sm text-slate-500">没有符合条件的变量</div>
        )}
      </div>
    </div>
  );
}

function CurrentMappingCard(props: {
  activeVariable: VariableDraft | null;
  selectedVariableIndex: number | null;
  onUpdate: (index: number, patch: Partial<VariableDraft>) => void;
}) {
  const { activeVariable, selectedVariableIndex, onUpdate } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      {activeVariable && selectedVariableIndex !== null ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">当前映射</div>
              <p className="mt-1 text-xs leading-6 text-slate-500">先确认变量命名，再从下方路径列表里直接点选对应字段。</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                activeVariable.jsonPath.trim() ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {activeVariable.jsonPath.trim() ? '已映射' : '待映射'}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                变量名
              </span>
              <input
                value={activeVariable.label}
                onChange={(event) => onUpdate(selectedVariableIndex, { label: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                编码
              </span>
              <input
                value={activeVariable.key}
                onChange={(event) => onUpdate(selectedVariableIndex, { key: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm outline-none transition focus:border-primary"
              />
            </label>

            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">原文片段</div>
              <p className="mt-2 text-sm leading-7 text-slate-700">{activeVariable.sourceText || '未绑定原文片段'}</p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                当前路径
              </span>
              <input
                value={activeVariable.jsonPath}
                onChange={(event) => onUpdate(selectedVariableIndex, { jsonPath: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary"
                placeholder="优先从下方点选，必要时再手输"
              />
            </label>
          </div>
        </>
      ) : (
        <div className="px-2 py-12 text-center text-sm leading-7 text-slate-500">
          从左侧变量列表里选中一个变量，这里就会切到它的字段映射视图。
        </div>
      )}
    </div>
  );
}

function PathSuggestionCard(props: {
  activeVariable: VariableDraft | null;
  jsonInput: string;
  jsonError: string;
  selectedVariableIndex: number | null;
  suggestedJsonPaths: string[];
  onPickPath: (path: string) => void;
}) {
  const { activeVariable, jsonInput, jsonError, selectedVariableIndex, suggestedJsonPaths, onPickPath } = props;
  const parsedJson = useMemo(() => {
    if (!jsonInput.trim() || jsonError) {
      return null;
    }
    try {
      return JSON.parse(jsonInput);
    } catch {
      return null;
    }
  }, [jsonError, jsonInput]);

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">可选字段路径</div>
          <p className="mt-1 text-xs leading-6 text-slate-500">样例 JSON 会自动展开成字段路径，点一下就可以写入当前变量。</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
          {suggestedJsonPaths.length} 条推荐
        </span>
      </div>

      <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto">
        {activeVariable && selectedVariableIndex !== null && suggestedJsonPaths.length > 0 ? (
          suggestedJsonPaths.map((path) => {
            const value = parsedJson ? getJsonValue(parsedJson, path) : undefined;
            const selected = activeVariable.jsonPath === path;

            return (
              <button
                key={path}
                onClick={() => onPickPath(path)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                  selected
                    ? 'border-primary bg-primary/[0.06]'
                    : 'border-slate-200 bg-white hover:border-primary/40 hover:bg-slate-50'
                }`}
              >
                <div className="font-mono text-[12px] text-slate-700">{path}</div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {value === undefined ? '无预览值' : `示例值：${String(value)}`}
                </div>
              </button>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            {jsonInput.trim() ? '当前样例里还没有可推荐的字段路径' : '先在左侧填入样例 JSON，右侧才会出现路径列表'}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryChip(props: { label: string; value: string; tone: 'default' | 'success' | 'warn' }) {
  const { label, value, tone } = props;

  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs font-medium ${toneClass}`}>
      {label} {value}
    </div>
  );
}
