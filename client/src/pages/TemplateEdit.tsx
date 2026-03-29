import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { templates } from '../api';
import { LayoutContext } from '../components/Layout';
import {
  CandidateKind,
  ConnectorConfig,
  PeriodSnapshot,
  TemplateCandidate,
  TemplateDetail,
  TemplateParagraph,
  VariableDraft,
} from '../types';
import { extractJsonPaths } from '../utils/json-path';
import { getDefaultPeriodKey } from '../utils/periods';

type TabId = 'variables' | 'data';

type ReportBlock =
  | {
      type: 'paragraph';
      paragraph: TemplateParagraph;
    }
  | {
      type: 'table';
      tableId: string | null;
      paragraphs: TemplateParagraph[];
    };

type ParagraphSelection = {
  paragraphId: string;
  paragraphOrder: number;
  sourceText: string;
  matchStart: number;
  matchEnd: number;
};

type ResolvedVariableDraft = VariableDraft & {
  index: number;
  paragraphId: string | null;
  sourceText: string;
  matchStart: number | null;
  matchEnd: number | null;
  candidate?: TemplateCandidate;
  kind: CandidateKind;
};

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

const CANDIDATE_KIND_LABELS: Record<CandidateKind, string> = {
  number: '数值',
  percent: '比例',
  date: '日期',
  year: '年度',
  quarter: '季度',
  month: '月份',
  placeholder: '占位符',
  manual: '手动拾取',
};

export function TemplateEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const { refreshTemplates: refreshList, tplList } = useOutletContext<LayoutContext>();

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('variables');
  const [uploading, setUploading] = useState(false);
  const [savingBasic, setSavingBasic] = useState(false);
  const [savingVariables, setSavingVariables] = useState(false);
  const [savingConnector, setSavingConnector] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [jsonPaths, setJsonPaths] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState('');
  const [variables, setVariables] = useState<VariableDraft[]>([]);
  const [connector, setConnector] = useState<ConnectorConfig>(EMPTY_CONNECTOR);
  const [manualForm, setManualForm] = useState({ sourceText: '', key: '', label: '', jsonPath: '' });
  const [snapshotForm, setSnapshotForm] = useState({
    periodKey: '',
    periodLabel: '',
    payloadText: '',
  });
  const [snapshotError, setSnapshotError] = useState('');
  const [message, setMessage] = useState('');
  const [paragraphSearch, setParagraphSearch] = useState('');
  const [variableSearch, setVariableSearch] = useState('');
  const [showPendingOnly, setShowPendingOnly] = useState(true);
  const [activeVariableIndex, setActiveVariableIndex] = useState<number | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<ParagraphSelection | null>(null);

  const hydrateTemplate = (result: TemplateDetail) => {
    const nextVariables = toVariableDrafts(result);
    setTemplate(result);
    setVariables(nextVariables);
    setConnector(result.connector);
    setActiveVariableIndex((current) => {
      if (nextVariables.length === 0) {
        return null;
      }
      if (current === null) {
        return 0;
      }
      return Math.min(current, nextVariables.length - 1);
    });
  };

  useEffect(() => {
    if (!id) {
      return;
    }

    templates
      .get(id)
      .then((result) => {
        hydrateTemplate(result);
        setSnapshotForm((current) => ({
          ...current,
          periodKey: current.periodKey || getDefaultPeriodKey(result.periodType),
          periodLabel: current.periodLabel || '',
        }));
      })
      .catch((err) => {
        setMessage((err as Error).message);
      });
  }, [id]);

  const candidateMap = useMemo(
    () => new Map(template?.candidates.map((candidate) => [candidate.id, candidate]) ?? []),
    [template]
  );

  const resolvedVariables = useMemo<ResolvedVariableDraft[]>(
    () =>
      variables.map((variable, index) => {
        const candidate = variable.candidateId ? candidateMap.get(variable.candidateId) : undefined;
        return {
          ...variable,
          index,
          candidate,
          paragraphId: variable.paragraphId ?? candidate?.paragraphId ?? null,
          sourceText: variable.sourceText ?? candidate?.valueText ?? '',
          matchStart: variable.matchStart ?? candidate?.matchStart ?? null,
          matchEnd: variable.matchEnd ?? candidate?.matchEnd ?? null,
          kind: variable.candidateKind ?? candidate?.kind ?? 'manual',
        };
      }),
    [variables, candidateMap]
  );

  const selectedCandidateIds = useMemo(
    () =>
      new Set(
        resolvedVariables
          .map((variable) => variable.candidateId)
          .filter((candidateId): candidateId is string => Boolean(candidateId))
      ),
    [resolvedVariables]
  );

  const paragraphCandidates = useMemo(() => {
    const map = new Map<string, TemplateCandidate[]>();
    for (const candidate of template?.candidates ?? []) {
      const list = map.get(candidate.paragraphId) ?? [];
      list.push(candidate);
      map.set(candidate.paragraphId, list);
    }
    return map;
  }, [template]);

  const paragraphVariables = useMemo(() => {
    const map = new Map<string, ResolvedVariableDraft[]>();
    for (const variable of resolvedVariables) {
      if (!variable.paragraphId) {
        continue;
      }
      const list = map.get(variable.paragraphId) ?? [];
      list.push(variable);
      map.set(variable.paragraphId, list);
    }
    return map;
  }, [resolvedVariables]);

  const paragraphStats = useMemo(() => {
    const map = new Map<string, { candidateCount: number; mappedCount: number; manualCount: number }>();

    for (const paragraph of template?.paragraphs ?? []) {
      map.set(paragraph.id, { candidateCount: 0, mappedCount: 0, manualCount: 0 });
    }

    for (const candidate of template?.candidates ?? []) {
      const stat = map.get(candidate.paragraphId) ?? { candidateCount: 0, mappedCount: 0, manualCount: 0 };
      stat.candidateCount += 1;
      map.set(candidate.paragraphId, stat);
    }

    for (const variable of resolvedVariables) {
      if (!variable.paragraphId) {
        continue;
      }
      const stat = map.get(variable.paragraphId) ?? { candidateCount: 0, mappedCount: 0, manualCount: 0 };
      stat.mappedCount += 1;
      if (!variable.candidateId) {
        stat.manualCount += 1;
      }
      map.set(variable.paragraphId, stat);
    }

    return map;
  }, [resolvedVariables, template]);

  const availableParagraphs = useMemo(
    () => template?.paragraphs.filter((paragraph) => !paragraph.inTable && paragraph.originalText.trim()) ?? [],
    [template]
  );

  const reportBlocks = useMemo<ReportBlock[]>(() => {
    if (!template) {
      return [];
    }

    const blocks: ReportBlock[] = [];
    let tableParagraphs: TemplateParagraph[] = [];
    let currentTableId: string | null = null;

    const flushTable = () => {
      if (tableParagraphs.length > 0) {
        blocks.push({ type: 'table', tableId: currentTableId, paragraphs: tableParagraphs });
        tableParagraphs = [];
        currentTableId = null;
      }
    };

    for (const paragraph of template.paragraphs) {
      if (!paragraph.originalText.trim()) {
        continue;
      }

      if (paragraph.inTable) {
        if (currentTableId && paragraph.tableId && paragraph.tableId !== currentTableId) {
          flushTable();
        }
        if (!currentTableId) {
          currentTableId = paragraph.tableId ?? `table-fallback-${paragraph.order}`;
        }
        tableParagraphs.push(paragraph);
        continue;
      }

      flushTable();
      blocks.push({ type: 'paragraph', paragraph });
    }

    flushTable();
    return blocks;
  }, [template]);

  const activeParagraphId =
    selectionDraft?.paragraphId ??
    (activeVariableIndex !== null && resolvedVariables[activeVariableIndex]
      ? resolvedVariables[activeVariableIndex].paragraphId
      : null);

  const visibleParagraphs = useMemo(() => {
    if (!template) {
      return [];
    }

    const query = paragraphSearch.trim().toLowerCase();

    return template.paragraphs.filter((paragraph) => {
      if (!paragraph.originalText.trim()) {
        return false;
      }

      const relatedVariables = paragraphVariables.get(paragraph.id) ?? [];
      const stat = paragraphStats.get(paragraph.id);
      const searchable = [
        paragraph.originalText,
        ...relatedVariables.map((variable) =>
          [variable.label, variable.key, variable.jsonPath, variable.sourceText].join(' ')
        ),
      ]
        .join(' ')
        .toLowerCase();

      if (query && !searchable.includes(query)) {
        return false;
      }

      if (showPendingOnly) {
        const hasPending = (stat?.candidateCount ?? 0) > (stat?.mappedCount ?? 0);
        const hasManual = relatedVariables.some((variable) => !variable.candidateId);
        const keepVisibleWhileEditing = paragraph.id === activeParagraphId;
        if (!hasPending && !hasManual && !keepVisibleWhileEditing) {
          return false;
        }
      }

      return true;
    });
  }, [activeParagraphId, paragraphSearch, paragraphStats, paragraphVariables, showPendingOnly, template]);

  const filteredVariables = useMemo(() => {
    const query = variableSearch.trim().toLowerCase();
    if (!query) {
      return resolvedVariables;
    }

    return resolvedVariables.filter((variable) =>
      [
        variable.key,
        variable.label,
        variable.jsonPath,
        variable.sourceText,
        variable.candidate?.paragraphText ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [resolvedVariables, variableSearch]);

  const activeVariable =
    activeVariableIndex !== null && resolvedVariables[activeVariableIndex]
      ? resolvedVariables[activeVariableIndex]
      : null;

  const suggestedJsonPaths = useMemo(() => {
    if (!activeVariable || jsonPaths.length === 0) {
      return [];
    }

    const keywords = [activeVariable.label, activeVariable.key, activeVariable.jsonPath, activeVariable.sourceText]
      .join(' ')
      .toLowerCase()
      .split(/[\s._-]+/)
      .filter((item) => item.length >= 2);

    const ranked = jsonPaths.filter((path) =>
      keywords.some((keyword) => path.toLowerCase().includes(keyword))
    );

    return [...ranked, ...jsonPaths].filter((path, index, array) => array.indexOf(path) === index).slice(0, 18);
  }, [activeVariable, jsonPaths]);

  const detectedCount = template?.candidateCount ?? 0;
  const mappedCount = resolvedVariables.length;
  const pendingCount = Math.max(detectedCount - selectedCandidateIds.size, 0);
  const manualCount = resolvedVariables.filter((variable) => !variable.candidateId).length;
  const missingPathCount = resolvedVariables.filter((variable) => !variable.jsonPath.trim()).length;

  const handleJsonChange = (value: string) => {
    setJsonInput(value);
    setJsonError('');
    if (!value.trim()) {
      setJsonPaths([]);
      return;
    }
    try {
      setJsonPaths(extractJsonPaths(JSON.parse(value)));
    } catch {
      setJsonError('JSON 格式无效');
      setJsonPaths([]);
    }
  };

  const loadTemplate = async () => {
    if (!id) {
      return;
    }
    const result = await templates.get(id);
    hydrateTemplate(result);
    refreshList();
  };

  const handleUpload = async (file: File) => {
    if (!id) {
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const result = await templates.uploadSample(id, file);
      hydrateTemplate(result.template);
      setSelectionDraft(null);
      setActiveVariableIndex(null);
      setActiveTab('variables');
      setMessage(`已解析 ${result.candidatesCount} 个候选变量，现在可以直接在左侧稿面点选或框选`);
      refreshList();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      handleUpload(file);
    }
  };

  const addCandidateAsVariable = (candidate: TemplateCandidate) => {
    const existingIndex = resolvedVariables.findIndex((variable) => variable.candidateId === candidate.id);
    if (existingIndex >= 0) {
      setActiveVariableIndex(existingIndex);
      return;
    }

    const nextIndex = variables.length + 1;
    setVariables((current) => [
      ...current,
      {
        candidateId: candidate.id,
        paragraphId: candidate.paragraphId,
        key: buildSuggestedKey(candidate.valueText, nextIndex, candidate.kind),
        label: buildSuggestedLabel(candidate.valueText, candidate.labelHint, nextIndex, candidate.kind),
        jsonPath: '',
        sourceText: candidate.valueText,
        matchStart: candidate.matchStart,
        matchEnd: candidate.matchEnd,
        candidateKind: candidate.kind,
      },
    ]);
    setActiveVariableIndex(variables.length);
    setSelectionDraft(null);
  };

  const addAllDetectedCandidates = () => {
    if (!template) {
      return;
    }

    const remaining = template.candidates.filter((candidate) => !selectedCandidateIds.has(candidate.id));
    if (remaining.length === 0) {
      setMessage('当前所有已识别候选项都已经加入变量列表了');
      return;
    }

    const startIndex = variables.length;
    setVariables((current) => [
      ...current,
      ...remaining.map((candidate, offset) => ({
        candidateId: candidate.id,
        paragraphId: candidate.paragraphId,
        key: buildSuggestedKey(candidate.valueText, current.length + offset + 1, candidate.kind),
        label: buildSuggestedLabel(
          candidate.valueText,
          candidate.labelHint,
          current.length + offset + 1,
          candidate.kind
        ),
        jsonPath: '',
        sourceText: candidate.valueText,
        matchStart: candidate.matchStart,
        matchEnd: candidate.matchEnd,
        candidateKind: candidate.kind,
      })),
    ]);
    setActiveVariableIndex(startIndex);
    setMessage(`已批量加入 ${remaining.length} 个识别项，右侧只需要继续补标签和 jsonPath`);
  };

  const addSelectionAsVariable = () => {
    if (!selectionDraft) {
      return;
    }

    const existingIndex = resolvedVariables.findIndex(
      (variable) =>
        variable.paragraphId === selectionDraft.paragraphId &&
        variable.matchStart === selectionDraft.matchStart &&
        variable.matchEnd === selectionDraft.matchEnd
    );
    if (existingIndex >= 0) {
      setActiveVariableIndex(existingIndex);
      setSelectionDraft(null);
      return;
    }

    const nextIndex = variables.length + 1;
    setVariables((current) => [
      ...current,
      {
        paragraphId: selectionDraft.paragraphId,
        key: buildSuggestedKey(selectionDraft.sourceText, nextIndex, 'manual'),
        label: buildSuggestedLabel(selectionDraft.sourceText, '', nextIndex, 'manual'),
        jsonPath: '',
        sourceText: selectionDraft.sourceText,
        matchStart: selectionDraft.matchStart,
        matchEnd: selectionDraft.matchEnd,
        candidateKind: 'manual',
      },
    ]);
    setActiveVariableIndex(variables.length);
    setSelectionDraft(null);
  };

  const updateVariable = (index: number, patch: Partial<VariableDraft>) => {
    setVariables((current) =>
      current.map((variable, variableIndex) =>
        variableIndex === index ? { ...variable, ...patch } : variable
      )
    );
  };

  const removeVariable = (index: number) => {
    setVariables((current) => current.filter((_, variableIndex) => variableIndex !== index));
    setActiveVariableIndex((current) => {
      if (current === null) {
        return null;
      }
      if (current === index) {
        return null;
      }
      return current > index ? current - 1 : current;
    });
  };

  const saveBasics = async () => {
    if (!id || !template) {
      return;
    }
    setSavingBasic(true);
    setMessage('');
    try {
      const updated = await templates.update(id, {
        name: template.name,
        category: template.category,
        description: template.description,
        periodType: template.periodType,
      });
      hydrateTemplate(updated);
      refreshList();
      setMessage('模板基础信息已保存');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSavingBasic(false);
    }
  };

  const saveVariables = async () => {
    if (!id) {
      return;
    }
    setSavingVariables(true);
    setMessage('');
    try {
      const nextVariables = variables.map((variable) => ({
        ...variable,
        key: variable.key.trim(),
        label: variable.label.trim(),
        jsonPath: variable.jsonPath.trim(),
      }));
      setVariables(nextVariables);
      const updated = await templates.saveVariables(id, nextVariables);
      hydrateTemplate(updated);
      refreshList();
      setMessage('变量映射已保存，左侧预览会同步刷新成更接近最终模板的效果');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSavingVariables(false);
    }
  };

  const saveConnector = async () => {
    if (!id) {
      return;
    }
    setSavingConnector(true);
    setMessage('');
    try {
      const updated = await templates.saveConnector(id, connector);
      setConnector(updated);
      setMessage('接口配置已保存');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSavingConnector(false);
    }
  };

  const saveParagraph = async (paragraph: TemplateParagraph) => {
    if (!id) {
      return;
    }
    setMessage('');
    try {
      const updated = await templates.updateParagraph(id, paragraph.id, paragraph.templateText);
      hydrateTemplate(updated);
      setMessage('文案已保存');
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const handleManualVariable = async () => {
    if (!id) {
      return;
    }
    setMessage('');
    try {
      const updated = await templates.addManualVariable(id, manualForm);
      hydrateTemplate(updated);
      setManualForm({ sourceText: '', key: '', label: '', jsonPath: '' });
      setMessage('手动变量已添加');
    } catch (err) {
      setMessage((err as Error).message);
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
      await loadTemplate();
      setSnapshotForm({
        periodKey: template ? getDefaultPeriodKey(template.periodType) : '',
        periodLabel: '',
        payloadText: '',
      });
      setMessage('模拟数据已保存');
    } catch (err) {
      setSnapshotError((err as Error).message);
    }
  };

  const deleteSnapshot = async (snapshot: PeriodSnapshot) => {
    if (!id || !confirm(`确定删除 ${snapshot.periodLabel} 的模拟数据？`)) {
      return;
    }
    await templates.deleteSnapshot(id, snapshot.id);
    await loadTemplate();
  };

  const handleDeleteTemplate = async () => {
    if (!id || !template || !confirm(`确定删除模板“${template.name}”？`)) {
      return;
    }
    await templates.delete(id);
    refreshList();
    const remaining = tplList.filter((item) => item.id !== id);
    navigate(remaining.length > 0 ? `/templates/${remaining[0].id}` : '/templates');
  };

  const handleParagraphSelection = (paragraph: TemplateParagraph, container: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      return;
    }

    const rawText = range.toString();
    if (!rawText.trim()) {
      return;
    }

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);

    const selectionStart = preRange.toString().length;
    const leadingWhitespace = rawText.length - rawText.trimStart().length;
    const trailingWhitespace = rawText.length - rawText.trimEnd().length;
    const matchStart = selectionStart + leadingWhitespace;
    const matchEnd = selectionStart + rawText.length - trailingWhitespace;
    const sourceText = paragraph.originalText.slice(matchStart, matchEnd);

    const existingIndex = resolvedVariables.findIndex(
      (variable) =>
        variable.paragraphId === paragraph.id &&
        variable.matchStart === matchStart &&
        variable.matchEnd === matchEnd
    );

    selection.removeAllRanges();

    if (existingIndex >= 0) {
      setActiveVariableIndex(existingIndex);
      setSelectionDraft(null);
      return;
    }

    if (!sourceText.trim()) {
      return;
    }

    setSelectionDraft({
      paragraphId: paragraph.id,
      paragraphOrder: paragraph.order,
      sourceText,
      matchStart,
      matchEnd,
    });
  };

  if (!template) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
        加载模板中...
      </div>
    );
  }

  const tabs: Array<{ id: TabId; label: string; icon: string }> = [
    { id: 'variables', label: '当前变量', icon: 'variable_add' },
    { id: 'data', label: '数据源配置', icon: 'database' },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-bold text-slate-900">{template.name}</h1>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
                {getPeriodTypeLabel(template.periodType)}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              左侧直接是整份报告视图，变量在报告里点选和补录；右侧只展示当前变量配置，数据源能力统一放到一个页签里。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/templates/${template.id}/data`)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
            >
              数据绑定
            </button>
            <button
              onClick={() => navigate(`/templates/${template.id}/variables`)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
            >
              变量总表
            </button>
            <button
              onClick={handleDeleteTemplate}
              className="rounded-xl px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50"
            >
              删除模板
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex-[3.35] overflow-y-auto bg-[#eef2f6] p-4">
          {!template.sourceDocPath ? (
            <div
              className="mx-auto mt-8 max-w-5xl rounded-[32px] border border-dashed border-slate-300 bg-white/85 px-8 py-12 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleUpload(file);
                  }
                }}
              />
              <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <div className="space-y-5">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                    Template Studio
                  </div>
                  <div className="space-y-3">
                    <h2 className="max-w-2xl text-3xl font-bold leading-tight text-slate-900">
                      把 Word 模板编辑，变成一块可以直接操作的稿面
                    </h2>
                    <p className="max-w-2xl text-sm leading-7 text-slate-600">
                      上传一份真实样本后，系统先自动识别数字、日期、百分比和常见占位符。识别不到的部分，不再要求你盯着右侧列表逐个补，而是可以直接在页面里拖选文字继续添加。
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FeatureCard
                      icon="gesture_select"
                      title="直接在稿面操作"
                      description="点击高亮项加入变量，拖选任意文字补漏识别。"
                    />
                    <FeatureCard
                      icon="rule_settings"
                      title="边选边配"
                      description="右侧保留变量配置台，不再把添加动作塞进长列表里。"
                    />
                    <FeatureCard
                      icon="docs"
                      title="按段落集中处理"
                      description="变量来源、补录动作和配置状态会围绕段落组织，不用来回切换。"
                    />
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold tracking-wide text-slate-700">上传样本</div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500">
                      .docx
                    </span>
                  </div>
                  <div className="mt-6 flex h-36 items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50">
                    <div className="space-y-3 text-center">
                      <span className="material-symbols-outlined text-5xl text-primary">upload_file</span>
                      <div className="text-lg font-semibold text-slate-900">
                        {uploading ? '正在分析样本报告...' : '点击或拖拽上传 Word 样本'}
                      </div>
                      <p className="mx-auto max-w-xs text-sm leading-6 text-slate-500">
                        优先上传一份已经填过真实数值的报告，识别效果会明显更好。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[1240px] space-y-5">
              <input
                ref={fileRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleUpload(file);
                  }
                }}
              />

              <ReportWorkspace
                template={template}
                detectedCount={detectedCount}
                mappedCount={mappedCount}
                pendingCount={pendingCount}
                manualCount={manualCount}
                missingPathCount={missingPathCount}
                selectionDraft={selectionDraft}
                reportBlocks={reportBlocks}
                paragraphCandidates={paragraphCandidates}
                paragraphVariables={paragraphVariables}
                activeParagraphId={activeParagraphId}
                activeVariableIndex={activeVariableIndex}
                onReupload={() => fileRef.current?.click()}
                onParagraphSelection={handleParagraphSelection}
                onAddSelection={addSelectionAsVariable}
                onClearSelection={() => setSelectionDraft(null)}
                onCandidateClick={addCandidateAsVariable}
                onVariableClick={(variableIndex) => {
                  setActiveVariableIndex(variableIndex);
                  setSelectionDraft(null);
                }}
              />
            </div>
          )}
        </section>

        <section className="flex-[1.45] min-w-[360px] max-w-[460px] border-l border-gray-100 bg-white flex flex-col">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">当前变量</div>
                <p className="mt-1 text-xs leading-6 text-slate-500">
                  这页只负责文档里的变量标注与命名，接口、样例数据和字段映射已移到独立的数据绑定页。
                </p>
              </div>
              <button
                onClick={() => navigate(`/templates/${template.id}/data`)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-primary hover:text-primary"
              >
                去数据绑定
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {message && (
              <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                {message}
              </div>
            )}

            {activeTab === 'variables' && (
              <VariableConfigPanel
                template={template}
                activeVariable={activeVariable}
                mappedCount={mappedCount}
                pendingCount={pendingCount}
                missingPathCount={missingPathCount}
                savingVariables={savingVariables}
                suggestedJsonPaths={suggestedJsonPaths}
                onSave={saveVariables}
                onRemove={removeVariable}
                onUpdate={updateVariable}
              />
            )}

            {activeTab === 'data' && (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">数据源配置台</div>
                  <p className="mt-1 text-xs leading-6 text-slate-500">
                    这里合并了字段映射辅助、接口配置和模拟数据。编辑页只保留这一套数据源能力，不再拆成多个页面。
                  </p>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">字段映射辅助</div>
                    <p className="mt-1 text-xs leading-6 text-slate-500">
                      粘贴接口响应样例，只用于帮你快速挑选 `jsonPath`，不会自动改接口配置。
                    </p>
                  </div>
                  <textarea
                    value={jsonInput}
                    onChange={(event) => handleJsonChange(event.target.value)}
                    className="mt-4 h-36 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-[12px] text-slate-700 outline-none transition focus:border-primary"
                    spellCheck={false}
                    placeholder={'{\n  "summary": {\n    "totalAssets": "806.55"\n  }\n}'}
                  />
                  {jsonError && <p className="mt-2 text-xs text-red-500">{jsonError}</p>}
                  {!jsonError && jsonPaths.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500">已识别 {jsonPaths.length} 个可选路径</p>
                  )}
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">数据源接口配置</div>
                      <p className="mt-1 text-xs leading-6 text-slate-500">
                        支持 <code>{'{{period}}'}</code>、<code>{'{{year}}'}</code>、<code>{'{{quarter}}'}</code>、<code>{'{{month}}'}</code> 占位符。
                      </p>
                    </div>
                    <button
                      onClick={saveConnector}
                      disabled={savingConnector}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-light disabled:opacity-50"
                    >
                      {savingConnector ? '保存中...' : '保存接口配置'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-[11px] text-gray-500">
                      <span>模式</span>
                      <select
                        value={connector.mode}
                        onChange={(event) => setConnector({ ...connector, mode: event.target.value as ConnectorConfig['mode'] })}
                        className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                      >
                        <option value="mock">模拟数据</option>
                        <option value="http">HTTP 接口</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-[11px] text-gray-500">
                      <span>是否启用接口</span>
                      <select
                        value={connector.enabled ? '1' : '0'}
                        onChange={(event) => setConnector({ ...connector, enabled: event.target.value === '1' })}
                        className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                      >
                        <option value="0">未启用</option>
                        <option value="1">启用</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-[11px] text-gray-500">
                      <span>Method</span>
                      <select
                        value={connector.method}
                        onChange={(event) => setConnector({ ...connector, method: event.target.value })}
                        className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-[11px] text-gray-500">
                      <span>响应根路径</span>
                      <input
                        value={connector.responsePath}
                        onChange={(event) => setConnector({ ...connector, responsePath: event.target.value })}
                        placeholder="例如 data.result"
                        className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                      />
                    </label>
                  </div>

                  <label className="space-y-1 text-[11px] text-gray-500 block">
                    <span>接口地址</span>
                    <input
                      value={connector.url}
                      onChange={(event) => setConnector({ ...connector, url: event.target.value })}
                      placeholder="https://example.com/api/report?year={{year}}"
                      className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                  </label>

                  <label className="space-y-1 text-[11px] text-gray-500 block">
                    <span>Headers(JSON)</span>
                    <textarea
                      value={connector.headersText}
                      onChange={(event) => setConnector({ ...connector, headersText: event.target.value })}
                      className="h-24 w-full rounded border border-gray-200 px-3 py-2 text-[11px] font-mono outline-none focus:border-primary"
                      spellCheck={false}
                      placeholder={'{\n  "Authorization": "Bearer xxx"\n}'}
                    />
                  </label>

                  <label className="space-y-1 text-[11px] text-gray-500 block">
                    <span>Query(JSON)</span>
                    <textarea
                      value={connector.queryText}
                      onChange={(event) => setConnector({ ...connector, queryText: event.target.value })}
                      className="h-24 w-full rounded border border-gray-200 px-3 py-2 text-[11px] font-mono outline-none focus:border-primary"
                      spellCheck={false}
                      placeholder={'{\n  "year": "{{year}}"\n}'}
                    />
                  </label>

                  <label className="space-y-1 text-[11px] text-gray-500 block">
                    <span>Body(JSON)</span>
                    <textarea
                      value={connector.bodyText}
                      onChange={(event) => setConnector({ ...connector, bodyText: event.target.value })}
                      className="h-28 w-full rounded border border-gray-200 px-3 py-2 text-[11px] font-mono outline-none focus:border-primary"
                      spellCheck={false}
                      placeholder={'{\n  "period": "{{period}}"\n}'}
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-[11px] text-gray-500">
                      <span>超时(ms)</span>
                      <input
                        type="number"
                        value={connector.timeoutMs}
                        onChange={(event) => setConnector({ ...connector, timeoutMs: Number(event.target.value) || 15000 })}
                        className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                      />
                    </label>
                    <label className="space-y-1 text-[11px] text-gray-500">
                      <span>缓存 TTL(秒)</span>
                      <input
                        type="number"
                        value={connector.cacheTtlSeconds}
                        onChange={(event) =>
                          setConnector({ ...connector, cacheTtlSeconds: Number(event.target.value) || 21600 })
                        }
                        className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">按周期维护模拟数据</div>
                    <p className="mt-1 text-xs leading-6 text-slate-500">
                      在真实接口没就绪前，报告中心会直接读取这里的某个周期数据。
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={snapshotForm.periodKey}
                      onChange={(event) => setSnapshotForm({ ...snapshotForm, periodKey: event.target.value })}
                      placeholder="2025 / 2025-Q4 / 2026-02"
                      className="rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                    <input
                      value={snapshotForm.periodLabel}
                      onChange={(event) => setSnapshotForm({ ...snapshotForm, periodLabel: event.target.value })}
                      placeholder="可留空自动显示 key"
                      className="rounded border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                  </div>
                  <textarea
                    value={snapshotForm.payloadText}
                    onChange={(event) => setSnapshotForm({ ...snapshotForm, payloadText: event.target.value })}
                    className="h-40 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-[11px] text-slate-700 outline-none transition focus:border-primary"
                    spellCheck={false}
                    placeholder={'{\n  "summary": {\n    "totalAssets": "806.55"\n  }\n}'}
                  />
                  {snapshotError && <p className="text-[11px] text-red-500">{snapshotError}</p>}
                  <button
                    onClick={saveSnapshot}
                    className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-light"
                  >
                    保存模拟数据
                  </button>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 text-sm font-semibold text-slate-900">
                    已保存的模拟数据 ({template.snapshots.length})
                  </div>
                  <div className="space-y-2">
                    {template.snapshots.map((snapshot) => (
                      <div key={snapshot.id} className="rounded-lg bg-gray-50 p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-700">{snapshot.periodLabel}</div>
                          <div className="text-[10px] text-gray-400 mt-1">
                            {snapshot.periodKey} · {new Date(snapshot.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={() => deleteSnapshot(snapshot)}
                          className="text-gray-300 hover:text-red-500"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    ))}
                    {template.snapshots.length === 0 && (
                      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-xs text-gray-400">
                        还没有模拟数据
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>
      </div>
    </div>
  );
}

function FeatureCard(props: { icon: string; title: string; description: string }) {
  const { icon, title, description } = props;

  return (
    <div className="rounded-[24px] border border-slate-200/70 bg-slate-50 p-4">
      <span className="material-symbols-outlined text-2xl text-primary">{icon}</span>
      <div className="mt-3 text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-xs leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function StatCard(props: { label: string; value: string; tone: 'dark' | 'light' }) {
  const { label, value, tone } = props;

  return (
    <div
      className={`rounded-[18px] px-4 py-3 ${
        tone === 'dark' ? 'bg-slate-900/95 ring-1 ring-slate-800' : 'bg-slate-50 ring-1 ring-slate-200'
      }`}
    >
      <div
        className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
          tone === 'dark' ? 'text-slate-400' : 'text-slate-500'
        }`}
      >
        {label}
      </div>
      <div className={`mt-1.5 text-[1.85rem] font-bold leading-none ${tone === 'dark' ? 'text-white' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

function CompactMetricPill(props: { label: string; value: string; tone?: 'default' | 'success' | 'warn' }) {
  const { label, value, tone = 'default' } = props;

  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${toneClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function ReportWorkspace(props: {
  template: TemplateDetail;
  detectedCount: number;
  mappedCount: number;
  pendingCount: number;
  manualCount: number;
  missingPathCount: number;
  selectionDraft: ParagraphSelection | null;
  reportBlocks: ReportBlock[];
  paragraphCandidates: Map<string, TemplateCandidate[]>;
  paragraphVariables: Map<string, ResolvedVariableDraft[]>;
  activeParagraphId: string | null;
  activeVariableIndex: number | null;
  onReupload: () => void;
  onParagraphSelection: (paragraph: TemplateParagraph, container: HTMLDivElement) => void;
  onAddSelection: () => void;
  onClearSelection: () => void;
  onCandidateClick: (candidate: TemplateCandidate) => void;
  onVariableClick: (index: number) => void;
}) {
  const {
    template,
    detectedCount,
    mappedCount,
    pendingCount,
    manualCount,
    missingPathCount,
    selectionDraft,
    reportBlocks,
    paragraphCandidates,
    paragraphVariables,
    activeParagraphId,
    activeVariableIndex,
    onReupload,
    onParagraphSelection,
    onAddSelection,
    onClearSelection,
    onCandidateClick,
    onVariableClick,
  } = props;

  return (
    <>
      <div className="rounded-[22px] border border-slate-200/85 bg-white/96 px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.05)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-slate-500">
                REPORT
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                {getPeriodTypeLabel(template.periodType)}
              </span>
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-[0.01em] text-slate-900">{template.name}</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                这里直接就是报告本身。点击高亮变量查看右侧配置，拖选正文文字即可补录新变量，变量总表单独放到新页面查看。
              </p>
            </div>
          </div>

          <button
            onClick={onReupload}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
          >
            重传样本
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <CompactMetricPill label="识别" value={String(detectedCount)} />
          <CompactMetricPill label="变量" value={String(mappedCount)} tone="success" />
          <CompactMetricPill label="待映射" value={String(pendingCount)} tone={pendingCount > 0 ? 'warn' : 'default'} />
          <CompactMetricPill label="缺路径" value={String(missingPathCount)} tone={missingPathCount > 0 ? 'warn' : 'default'} />
          {manualCount > 0 && <CompactMetricPill label="手动补录" value={String(manualCount)} />}
        </div>

        {selectionDraft && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-amber-200/90 bg-amber-50/90 px-4 py-2.5">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">当前选中</div>
              <p className="mt-1 text-sm font-medium text-amber-950">
                第 {selectionDraft.paragraphOrder} 段 · “{selectionDraft.sourceText}”
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClearSelection}
                className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
              >
                取消
              </button>
              <button
                onClick={onAddSelection}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                加入变量
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[24px] border border-slate-200/80 bg-white/92 p-3 shadow-[0_18px_44px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="report-stage">
          <div className="report-page-surface">
            {reportBlocks.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-slate-200 px-6 py-16 text-center text-sm text-slate-500">
                暂时没有可展示的报告正文，请先上传带真实数据的 Word 样本。
              </div>
            ) : (
              <div className="report-page-content">
                {reportBlocks.map((block, index) =>
                  block.type === 'paragraph' ? (
                    <ReportCanvasParagraph
                      key={block.paragraph.id}
                      paragraph={block.paragraph}
                      candidates={paragraphCandidates.get(block.paragraph.id) ?? []}
                      variables={paragraphVariables.get(block.paragraph.id) ?? []}
                      selectionDraft={selectionDraft?.paragraphId === block.paragraph.id ? selectionDraft : null}
                      isActive={activeParagraphId === block.paragraph.id}
                      activeVariableIndex={activeVariableIndex}
                      onParagraphSelection={onParagraphSelection}
                      onAddSelection={onAddSelection}
                      onClearSelection={onClearSelection}
                      onCandidateClick={onCandidateClick}
                      onVariableClick={onVariableClick}
                    />
                  ) : (
                    <ReportCanvasTable
                      key={`table-${index}-${block.paragraphs[0]?.id ?? index}`}
                      paragraphs={block.paragraphs}
                      paragraphCandidates={paragraphCandidates}
                      paragraphVariables={paragraphVariables}
                      selectionDraft={selectionDraft}
                      activeParagraphId={activeParagraphId}
                      activeVariableIndex={activeVariableIndex}
                      onParagraphSelection={onParagraphSelection}
                      onAddSelection={onAddSelection}
                      onClearSelection={onClearSelection}
                      onCandidateClick={onCandidateClick}
                      onVariableClick={onVariableClick}
                    />
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function VariableConfigPanel(props: {
  template: TemplateDetail;
  activeVariable: ResolvedVariableDraft | null;
  mappedCount: number;
  pendingCount: number;
  missingPathCount: number;
  savingVariables: boolean;
  suggestedJsonPaths: string[];
  onSave: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<VariableDraft>) => void;
}) {
  const {
    template,
    activeVariable,
    mappedCount,
    pendingCount,
    missingPathCount,
    savingVariables,
    suggestedJsonPaths,
    onSave,
    onRemove,
    onUpdate,
  } = props;

  const paragraphOrder = activeVariable?.paragraphId
    ? template.paragraphs.find((item) => item.id === activeVariable.paragraphId)?.order
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">当前变量配置</div>
            <p className="mt-1 text-xs leading-6 text-slate-500">
              右侧只处理当前变量的编码、变量名和映射路径。新增动作全部回到左侧报告里完成。
            </p>
          </div>
          <button
            onClick={onSave}
            disabled={savingVariables}
            className="min-w-[96px] whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-light disabled:opacity-50"
          >
            {savingVariables ? '保存中...' : '保存变量'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <CompactMetricPill label="变量" value={String(mappedCount)} tone="success" />
          <CompactMetricPill label="待映射" value={String(pendingCount)} tone={pendingCount > 0 ? 'warn' : 'default'} />
          <CompactMetricPill label="缺路径" value={String(missingPathCount)} tone={missingPathCount > 0 ? 'warn' : 'default'} />
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        {activeVariable ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">变量详情</div>
                <p className="mt-1 text-xs leading-6 text-slate-500">
                  当前选中的变量会始终和左侧高亮联动，你可以在这里直接完成编码和映射配置。
                </p>
              </div>
              <button
                onClick={() => onRemove(activeVariable.index)}
                className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100"
              >
                移除
              </button>
            </div>

            <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                  {CANDIDATE_KIND_LABELS[activeVariable.kind]}
                </span>
                {typeof paragraphOrder === 'number' && (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500">
                    段落 {paragraphOrder}
                  </span>
                )}
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    activeVariable.jsonPath ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {activeVariable.jsonPath ? '已映射' : '待映射'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                来源片段: <span className="font-medium text-slate-900">{activeVariable.sourceText || '未绑定原文'}</span>
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  编码
                </span>
                <input
                  value={activeVariable.key}
                  onChange={(event) => onUpdate(activeVariable.index, { key: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm outline-none transition focus:border-primary"
                  placeholder="例如 field_001"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  变量名
                </span>
                <input
                  value={activeVariable.label}
                  onChange={(event) => onUpdate(activeVariable.index, { label: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary"
                  placeholder="例如 总资产"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  jsonPath
                </span>
                <input
                  value={activeVariable.jsonPath}
                  onChange={(event) => onUpdate(activeVariable.index, { jsonPath: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary"
                  placeholder="例如 summary.totalAssets"
                />
              </label>
            </div>

            {suggestedJsonPaths.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  推荐路径
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedJsonPaths.map((jsonPath) => (
                    <button
                      key={jsonPath}
                      onClick={() => onUpdate(activeVariable.index, { jsonPath })}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                        activeVariable.jsonPath === jsonPath
                          ? 'bg-primary text-white'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary'
                      }`}
                    >
                      {jsonPath}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-10 text-center text-sm leading-7 text-slate-500">
            左侧报告里点击一个高亮变量，或者直接拖选正文中的一段文本，这里就会切换成对应的配置视图。
          </div>
        )}
      </div>
    </div>
  );
}

function ReportCanvasParagraph(props: {
  paragraph: TemplateParagraph;
  candidates: TemplateCandidate[];
  variables: ResolvedVariableDraft[];
  selectionDraft: ParagraphSelection | null;
  isActive: boolean;
  activeVariableIndex: number | null;
  onParagraphSelection: (paragraph: TemplateParagraph, container: HTMLDivElement) => void;
  onAddSelection: () => void;
  onClearSelection: () => void;
  onCandidateClick: (candidate: TemplateCandidate) => void;
  onVariableClick: (index: number) => void;
}) {
  const {
    paragraph,
    candidates,
    variables,
    selectionDraft,
    isActive,
    activeVariableIndex,
    onParagraphSelection,
    onAddSelection,
    onClearSelection,
    onCandidateClick,
    onVariableClick,
  } = props;

  const markers = buildParagraphMarkers(candidates, variables);

  return (
    <div className={`report-paragraph-wrapper transition ${isActive ? 'report-paragraph-wrapper--active' : ''}`}>
      <div
        className={getReportParagraphClass(paragraph)}
        onMouseUp={(event) => onParagraphSelection(paragraph, event.currentTarget)}
      >
        {renderParagraphText(markers, paragraph.originalText, onCandidateClick, onVariableClick, activeVariableIndex)}
      </div>

      {selectionDraft && (
        <div className="report-selection-draft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-amber-950">“{selectionDraft.sourceText}”</p>
            <div className="flex items-center gap-2">
              <button
                onClick={onClearSelection}
                className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
              >
                取消
              </button>
              <button
                onClick={onAddSelection}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                加入变量
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportCanvasTable(props: {
  paragraphs: TemplateParagraph[];
  paragraphCandidates: Map<string, TemplateCandidate[]>;
  paragraphVariables: Map<string, ResolvedVariableDraft[]>;
  selectionDraft: ParagraphSelection | null;
  activeParagraphId: string | null;
  activeVariableIndex: number | null;
  onParagraphSelection: (paragraph: TemplateParagraph, container: HTMLDivElement) => void;
  onAddSelection: () => void;
  onClearSelection: () => void;
  onCandidateClick: (candidate: TemplateCandidate) => void;
  onVariableClick: (index: number) => void;
}) {
  const {
    paragraphs,
    paragraphCandidates,
    paragraphVariables,
    selectionDraft,
    activeParagraphId,
    activeVariableIndex,
    onParagraphSelection,
    onAddSelection,
    onClearSelection,
    onCandidateClick,
    onVariableClick,
  } = props;

  const rows = useMemo(() => buildReportTableRows(paragraphs), [paragraphs]);

  return (
    <div className="report-table-block">
      <table className="w-full border-collapse table-fixed">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`table-row-${rowIndex}`} className="border-b border-slate-200 last:border-b-0">
              {row.map((cell) => (
                <td
                  key={cell.key}
                  className={`align-top border-r border-slate-200 px-2.5 py-2 last:border-r-0 ${
                    rowIndex === 0 ? 'bg-slate-50/90' : 'bg-white'
                  }`}
                  style={{ width: `${100 / Math.max(row.length, 1)}%` }}
                >
                  {cell.paragraphs.length > 0 ? (
                    <div className="space-y-1">
                      {cell.paragraphs.map((paragraph) => {
                        const markers = buildParagraphMarkers(
                          paragraphCandidates.get(paragraph.id) ?? [],
                          paragraphVariables.get(paragraph.id) ?? []
                        );
                        const isActive = activeParagraphId === paragraph.id;

                        return (
                          <div
                            key={paragraph.id}
                            className={`report-table-cell-wrapper transition ${
                              isActive ? 'report-table-cell-wrapper--active' : ''
                            }`}
                          >
                            <div
                              className={`report-table-cell ${
                                rowIndex === 0 ? 'report-table-cell--header' : ''
                              }`}
                              onMouseUp={(event) => onParagraphSelection(paragraph, event.currentTarget)}
                            >
                              {renderParagraphText(
                                markers,
                                paragraph.originalText,
                                onCandidateClick,
                                onVariableClick,
                                activeVariableIndex
                              )}
                            </div>

                            {selectionDraft?.paragraphId === paragraph.id && (
                              <div className="report-selection-draft mt-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-amber-950">“{selectionDraft.sourceText}”</p>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={onClearSelection}
                                      className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
                                    >
                                      取消
                                    </button>
                                    <button
                                      onClick={onAddSelection}
                                      className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                                    >
                                      加入变量
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="min-h-10" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ReportTableCell = {
  key: string;
  paragraphs: TemplateParagraph[];
};

function buildReportTableRows(paragraphs: TemplateParagraph[]): ReportTableCell[][] {
  const hasStructuredTable = paragraphs.some(
    (paragraph) =>
      paragraph.tableId &&
      typeof paragraph.tableRow === 'number' &&
      typeof paragraph.tableCol === 'number'
  );

  if (hasStructuredTable) {
    const maxCols = Math.max(...paragraphs.map((paragraph) => paragraph.tableCols ?? paragraph.tableCol ?? 1), 1);
    const rows = new Map<number, Map<number, TemplateParagraph[]>>();

    for (const paragraph of paragraphs) {
      const rowNumber = paragraph.tableRow ?? 1;
      const colNumber = paragraph.tableCol ?? 1;
      const row = rows.get(rowNumber) ?? new Map<number, TemplateParagraph[]>();
      const cell = row.get(colNumber) ?? [];
      cell.push(paragraph);
      row.set(colNumber, cell);
      rows.set(rowNumber, row);
    }

    return [...rows.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([rowNumber, cells]) =>
        Array.from({ length: maxCols }, (_, index) => ({
          key: `${paragraphs[0]?.tableId ?? 'table'}-${rowNumber}-${index + 1}`,
          paragraphs: cells.get(index + 1) ?? [],
        }))
      );
  }

  const inferredColumns = inferTableColumnCount(paragraphs);
  const rows: ReportTableCell[][] = [];

  for (let index = 0; index < paragraphs.length; index += inferredColumns) {
    const slice = paragraphs.slice(index, index + inferredColumns);
    const row = slice.map((paragraph, cellIndex) => ({
      key: `fallback-${index}-${cellIndex}`,
      paragraphs: [paragraph],
    }));

    while (row.length < inferredColumns) {
      row.push({
        key: `fallback-${index}-${row.length}`,
        paragraphs: [],
      });
    }

    rows.push(row);
  }

  return rows;
}

function inferTableColumnCount(paragraphs: TemplateParagraph[]): number {
  const texts = paragraphs.map((paragraph) => paragraph.originalText.trim()).filter(Boolean);
  if (texts.length <= 1) {
    return 1;
  }

  const maxCandidate = Math.min(8, texts.length);
  let bestColumns = Math.min(5, texts.length);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let columns = 2; columns <= maxCandidate; columns += 1) {
    const rows: string[][] = [];
    for (let index = 0; index < texts.length; index += columns) {
      rows.push(texts.slice(index, index + columns));
    }

    const header = rows[0] ?? [];
    if (header.length < columns) {
      continue;
    }

    let score = 0;
    if (header.every((cell) => cell.length <= 18)) {
      score += 3;
    }

    const sampleRows = rows.slice(1, Math.min(rows.length, 7));
    const dataCells = sampleRows.flatMap((row) => row.slice(1));
    if (dataCells.length > 0) {
      score += (dataCells.filter((cell) => looksNumericCell(cell)).length / dataCells.length) * 2.4;
    }

    if (sampleRows.length > 0) {
      score +=
        sampleRows.filter((row) => row[0] && row[0].length <= 18 && !looksNumericCell(row[0])).length /
        sampleRows.length;
    }

    const lastRow = rows[rows.length - 1];
    if (lastRow.length !== columns) {
      score -= (columns - lastRow.length) / columns;
    }

    if (columns === 5) {
      score += 0.15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }

  return bestColumns;
}

function looksNumericCell(text: string): boolean {
  return /^-?\d[\d,.]*%?$/.test(text) || /^-?\d[\d,.]*pt$/i.test(text);
}

function ParagraphWorkbenchCard(props: {
  paragraph: TemplateParagraph;
  candidates: TemplateCandidate[];
  variables: ResolvedVariableDraft[];
  stats: {
    candidateCount: number;
    mappedCount: number;
    manualCount: number;
  };
  selectionDraft: ParagraphSelection | null;
  isActive: boolean;
  onParagraphSelection: (paragraph: TemplateParagraph, container: HTMLDivElement) => void;
  onAddSelection: () => void;
  onClearSelection: () => void;
  onCandidateClick: (candidate: TemplateCandidate) => void;
  onVariableClick: (index: number) => void;
}) {
  const {
    paragraph,
    candidates,
    variables,
    stats,
    selectionDraft,
    isActive,
    onParagraphSelection,
    onAddSelection,
    onClearSelection,
    onCandidateClick,
    onVariableClick,
  } = props;

  const markers = buildParagraphMarkers(candidates, variables);
  const pendingCount = Math.max(stats.candidateCount - stats.mappedCount, 0);
  const isCompleted = stats.candidateCount > 0 && pendingCount === 0;

  return (
    <div
      className={`rounded-[28px] border bg-white p-5 shadow-sm transition ${
        isActive ? 'border-primary/35 shadow-[0_18px_40px_rgba(55,106,34,0.12)]' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white">
            段落 {paragraph.order}
          </span>
          {paragraph.inTable && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500">
              表格内
            </span>
          )}
          {paragraph.isCustomized && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-700">
              已改写文案
            </span>
          )}
          {isActive && (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
              当前编辑
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
            识别 {stats.candidateCount}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
            已映射 {stats.mappedCount}
          </span>
          {stats.manualCount > 0 && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
              手动 {stats.manualCount}
            </span>
          )}
          {isCompleted && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              已完成
            </span>
          )}
        </div>
      </div>

      <div
        className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-[15px] leading-8 text-slate-700"
        onMouseUp={(event) => onParagraphSelection(paragraph, event.currentTarget)}
      >
        {renderParagraphText(markers, paragraph.originalText, onCandidateClick, onVariableClick)}
      </div>

      {selectionDraft && (
        <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                新选中的原文片段
              </div>
              <p className="mt-1 text-sm font-medium text-amber-950">“{selectionDraft.sourceText}”</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClearSelection}
                className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
              >
                取消
              </button>
              <button
                onClick={onAddSelection}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                加入变量
              </button>
            </div>
          </div>
        </div>
      )}

      {variables.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {variables.map((variable) => (
            <button
              key={`${variable.candidateId ?? 'manual'}-${variable.index}`}
              onClick={() => onVariableClick(variable.index)}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-left transition hover:border-emerald-300 hover:bg-emerald-100"
            >
              <span className="mr-2 text-[11px] font-semibold text-emerald-700">
                {variable.label || '未命名'}
              </span>
              <span className="font-mono text-[11px] text-emerald-900">{`{{${variable.key}}}`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ParagraphEditorCard(props: {
  paragraph: TemplateParagraph;
  onChange: (nextText: string) => void;
  onSave: (paragraph: TemplateParagraph) => void;
}) {
  const { paragraph, onChange, onSave } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          段落 {paragraph.order}
        </span>
        {paragraph.isCustomized && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] text-amber-700">
            已自定义
          </span>
        )}
      </div>
      <div className="mt-3 rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-500">
        原文: {paragraph.originalText || '空段落'}
      </div>
      <textarea
        value={paragraph.templateText}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary"
      />
      <button
        onClick={() => onSave(paragraph)}
        className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary"
      >
        保存这段文案
      </button>
    </div>
  );
}

function buildParagraphMarkers(
  candidates: TemplateCandidate[],
  variables: ResolvedVariableDraft[]
): Array<{
  start: number;
  end: number;
  text: string;
  tone: 'candidate' | 'mapped' | 'manual';
  candidate?: TemplateCandidate;
  variableIndex?: number;
}> {
  const markers: Array<{
    start: number;
    end: number;
    text: string;
    tone: 'candidate' | 'mapped' | 'manual';
    candidate?: TemplateCandidate;
    variableIndex?: number;
  }> = [];

  for (const candidate of candidates) {
    const mappedVariable = variables.find((variable) => variable.candidateId === candidate.id);
    markers.push({
      start: candidate.matchStart,
      end: candidate.matchEnd,
      text: candidate.valueText,
      tone: mappedVariable ? 'mapped' : 'candidate',
      candidate,
      variableIndex: mappedVariable?.index,
    });
  }

  for (const variable of variables) {
    if (
      variable.candidateId ||
      variable.matchStart === null ||
      variable.matchEnd === null ||
      variable.matchEnd <= variable.matchStart
    ) {
      continue;
    }

    markers.push({
      start: variable.matchStart,
      end: variable.matchEnd,
      text: variable.sourceText,
      tone: 'manual',
      variableIndex: variable.index,
    });
  }

  return markers
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      const leftPriority = left.tone === 'candidate' ? 1 : 0;
      const rightPriority = right.tone === 'candidate' ? 1 : 0;
      return leftPriority - rightPriority;
    })
    .filter((marker, index, array) => {
      if (index === 0) {
        return true;
      }
      return array[index - 1].end <= marker.start;
    });
}

function getReportParagraphClass(paragraph: TemplateParagraph): string {
  const text = paragraph.originalText.trim();
  if (!text) {
    return 'report-paragraph report-paragraph--spacer';
  }

  if (paragraph.order === 1) {
    return 'report-paragraph report-paragraph--title';
  }

  if (text.includes('生成时间') && text.includes('报告周期')) {
    return 'report-paragraph report-paragraph--meta';
  }

  if (/^[一二三四五六七八九十]+、/.test(text)) {
    return 'report-paragraph report-paragraph--section';
  }

  if (/^（[一二三四五六七八九十\d]+）/.test(text)) {
    return 'report-paragraph report-paragraph--subsection';
  }

  if (text.startsWith('单位：')) {
    return 'report-paragraph report-paragraph--caption';
  }

  if (!paragraph.inTable && text.length <= 14 && !/[，。；：！？,.!?]/.test(text)) {
    return 'report-paragraph report-paragraph--short';
  }

  return 'report-paragraph report-paragraph--body';
}

function renderParagraphText(
  markers: ReturnType<typeof buildParagraphMarkers>,
  originalText: string,
  onCandidateClick: (candidate: TemplateCandidate) => void,
  onVariableClick: (index: number) => void,
  activeVariableIndex: number | null = null
) {
  const pieces: JSX.Element[] = [];
  let cursor = 0;

  markers.forEach((marker, index) => {
    if (marker.start > cursor) {
      pieces.push(<span key={`plain-${index}-${cursor}`}>{originalText.slice(cursor, marker.start)}</span>);
    }

    if (marker.tone === 'candidate' && marker.candidate) {
      pieces.push(
        <span
          key={`candidate-${marker.candidate.id}`}
          role="button"
          tabIndex={0}
          title={`点击加入变量 · ${CANDIDATE_KIND_LABELS[marker.candidate.kind]}`}
          onClick={() => onCandidateClick(marker.candidate!)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onCandidateClick(marker.candidate!);
            }
          }}
          className="report-inline-token report-inline-token--candidate"
        >
          {marker.text}
        </span>
      );
    } else if (typeof marker.variableIndex === 'number') {
      const isActiveVariable = marker.variableIndex === activeVariableIndex;
      pieces.push(
        <span
          key={`mapped-${marker.variableIndex}-${marker.start}`}
          role="button"
          tabIndex={0}
          data-variable-index={marker.variableIndex}
          title="点击继续配置这个变量"
          onClick={() => onVariableClick(marker.variableIndex!)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onVariableClick(marker.variableIndex!);
            }
          }}
          className={`report-inline-token ${
            marker.tone === 'manual' ? 'report-inline-token--manual' : 'report-inline-token--mapped'
          } ${isActiveVariable ? 'report-inline-token--active' : ''}`}
        >
          {marker.text}
        </span>
      );
    }

    cursor = marker.end;
  });

  if (cursor < originalText.length) {
    pieces.push(<span key={`plain-tail-${cursor}`}>{originalText.slice(cursor)}</span>);
  }

  return pieces;
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

function buildSuggestedKey(sourceText: string, index: number, kind: CandidateKind): string {
  if (kind === 'placeholder') {
    const extracted = extractPlaceholderKey(sourceText);
    if (extracted) {
      const normalized = extracted
        .replace(/[.\-\s/]+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^(\d)/, '_$1')
        .replace(/^_+$/, '');

      if (normalized && /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
        return normalized;
      }
    }
  }

  return `field_${String(index).padStart(3, '0')}`;
}

function buildSuggestedLabel(
  sourceText: string,
  labelHint: string,
  index: number,
  kind: CandidateKind
): string {
  if (kind === 'placeholder') {
    const extracted = extractPlaceholderKey(sourceText);
    if (extracted) {
      return extracted;
    }
  }

  return labelHint.trim() || sourceText.trim().slice(0, 20) || `变量 ${index}`;
}

function extractPlaceholderKey(sourceText: string): string {
  return sourceText
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .replace(/^\$\{\s*|\s*\}$/g, '')
    .replace(/^【|】$/g, '')
    .trim();
}

function getPeriodTypeLabel(periodType: TemplateDetail['periodType']): string {
  if (periodType === 'annual') {
    return '年度模板';
  }
  if (periodType === 'quarterly') {
    return '季度模板';
  }
  return '月度模板';
}
