import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { reports, templates } from '../api';
import { LayoutContext } from '../components/Layout';
import { ReportRecord, RenderResponse, TemplateDetail, TemplateSummary } from '../types';
import { getDefaultPeriodKey, getPeriodOptions } from '../utils/periods';

export function ReportCenter() {
  const navigate = useNavigate();
  const { reportList, selectedReportId, tplList, refreshReports } = useOutletContext<LayoutContext>();
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [preview, setPreview] = useState<RenderResponse | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const selectedReport = useMemo(
    () => reportList.find((report) => report.id === selectedReportId) ?? null,
    [reportList, selectedReportId]
  );

  useEffect(() => {
    if (selectedReport) {
      setSelectedTemplateId(selectedReport.templateId);
      setSelectedPeriod(selectedReport.periodKey);
      return;
    }

    if (!selectedTemplateId && tplList.length > 0) {
      setSelectedTemplateId(tplList[0].id);
    }
  }, [selectedReport, selectedTemplateId, tplList]);

  useEffect(() => {
    if (tplList.length === 0) {
      setSelectedTemplateId('');
      setTemplate(null);
      return;
    }

    if (!tplList.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(tplList[0].id);
    }
  }, [selectedTemplateId, tplList]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplate(null);
      return;
    }

    setLoadingTemplate(true);
    templates
      .get(selectedTemplateId)
      .then((result) => {
        setTemplate(result);
        setSelectedPeriod((current) => current || getDefaultPeriodKey(result.periodType));
        setError('');
      })
      .catch((err) => {
        setTemplate(null);
        setError((err as Error).message);
      })
      .finally(() => setLoadingTemplate(false));
  }, [selectedTemplateId]);

  useEffect(() => {
    if (!template) {
      return;
    }

    const options = getPeriodOptions(template.periodType);
    if (!options.some((option) => option.key === selectedPeriod)) {
      setSelectedPeriod(getDefaultPeriodKey(template.periodType));
    }
  }, [selectedPeriod, template]);

  const periodOptions = useMemo(() => (template ? getPeriodOptions(template.periodType) : []), [template]);

  const renderReport = async (forceRefresh = false) => {
    if (!template || !selectedPeriod) {
      return;
    }

    setRendering(true);
    setError('');
    try {
      const result = await reports.render(template.id, selectedPeriod, forceRefresh);
      setPreview(result);
      await refreshReports();
    } catch (err) {
      setPreview(null);
      setError((err as Error).message);
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    if (template && selectedPeriod) {
      renderReport(false);
    }
  }, [template?.id, selectedPeriod]);

  const handleExport = async () => {
    if (!template || !selectedPeriod) {
      return;
    }

    setExporting(true);
    setError('');
    try {
      const result = await reports.export(template.id, selectedPeriod);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      await refreshReports();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (tplList.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        请先在模板管理中创建模板并上传报告样本
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#f4f7fb]">
      <header className="shrink-0 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-slate-900">报告中心</h2>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                最近报告 {reportList.length}
              </span>
            </div>
            <p className="text-xs text-slate-500">这里面向最终报告的预览与导出，模板选择、周期切换和最近生成记录都围绕“产出结果”组织。</p>
          </div>

          {template && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/templates/${template.id}`)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
              >
                去标注模板
              </button>
              <button
                onClick={() => navigate(`/templates/${template.id}/data`)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary"
              >
                去数据绑定
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1380px] space-y-4">
          <TemplatePicker
            tplList={tplList}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_360px]">
            <div className="space-y-4">
              <ReportToolbar
                template={template}
                periodOptions={periodOptions}
                selectedPeriod={selectedPeriod}
                rendering={rendering || loadingTemplate}
                exporting={exporting}
                selectedReport={selectedReport}
                onPeriodChange={setSelectedPeriod}
                onRefresh={() => renderReport(true)}
                onExport={handleExport}
              />

              {error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <ReportPreview
                template={template}
                preview={preview}
                rendering={rendering || loadingTemplate}
              />
            </div>

            <RecentReportPanel reportList={reportList} selectedReportId={selectedReportId} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplatePicker(props: {
  tplList: TemplateSummary[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
}) {
  const { tplList, selectedTemplateId, onSelect } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">选择要生成的模板</div>
          <p className="mt-1 text-xs leading-6 text-slate-500">报告中心不再直接复用模板列表，而是单独围绕“可生成的报告”来选择模板和周期。</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tplList.map((template) => {
          const ready = template.sourceDocAvailable && template.variableCount > 0;
          const active = template.id === selectedTemplateId;

          return (
            <button
              key={template.id}
              onClick={() => onSelect(template.id)}
              className={`rounded-[20px] border px-4 py-4 text-left transition ${
                active ? 'border-primary bg-primary/[0.05]' : 'border-slate-200 bg-white hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-sm font-semibold text-slate-900">{template.name}</div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                    ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {ready ? '可生成' : template.sourceDocPath && !template.sourceDocAvailable ? '样本丢失' : '待完善'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span>{getPeriodTypeLabel(template.periodType)}</span>
                <span>·</span>
                <span>{template.variableCount} 个变量</span>
                <span>·</span>
                <span>{template.candidateCount} 个识别项</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReportToolbar(props: {
  template: TemplateDetail | null;
  periodOptions: Array<{ key: string; label: string }>;
  selectedPeriod: string;
  rendering: boolean;
  exporting: boolean;
  selectedReport: ReportRecord | null;
  onPeriodChange: (periodKey: string) => void;
  onRefresh: () => void;
  onExport: () => void;
}) {
  const { template, periodOptions, selectedPeriod, rendering, exporting, selectedReport, onPeriodChange, onRefresh, onExport } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">{template?.name || '请选择模板'}</div>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            {selectedReport
              ? `当前来自最近记录：${selectedReport.periodLabel}，${selectedReport.lastAction === 'export' ? '最近一次是导出' : '最近一次是预览'}。`
              : '切换周期后会自动重新生成预览，你也可以手动强制刷新接口数据。'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedPeriod}
            onChange={(event) => onPeriodChange(event.target.value)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm outline-none focus:border-primary"
          >
            {periodOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={onRefresh}
            disabled={!template || rendering}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {rendering ? '生成中...' : '强制刷新'}
          </button>
          <button
            onClick={onExport}
            disabled={!template || exporting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-light disabled:opacity-50"
          >
            {exporting ? '导出中...' : '导出 .docx'}
          </button>
        </div>
      </div>

      {template && (
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip label="变量" value={String(template.variables.length)} tone="success" />
          <StatusChip label="已映射" value={String(template.variables.filter((item) => item.jsonPath.trim()).length)} tone="success" />
          <StatusChip
            label="待映射"
            value={String(template.variables.filter((item) => !item.jsonPath.trim()).length)}
            tone="warn"
          />
          <StatusChip
            label="数据源"
            value={template.connector.mode === 'http' && template.connector.enabled ? '接口' : '样例'}
            tone="default"
          />
        </div>
      )}
    </div>
  );
}

function ReportPreview(props: {
  template: TemplateDetail | null;
  preview: RenderResponse | null;
  rendering: boolean;
}) {
  const { template, preview, rendering } = props;

  if (!template) {
    return (
      <div className="flex min-h-[760px] items-center justify-center rounded-[28px] border border-slate-200 bg-white text-gray-400 shadow-sm">
        请选择要生成的模板
      </div>
    );
  }

  if (!template.sourceDocPath) {
    return (
      <div className="flex min-h-[760px] flex-col items-center justify-center rounded-[28px] border border-slate-200 bg-white text-center shadow-sm">
        <div className="text-base font-semibold text-slate-800">这个模板还没有上传样本报告</div>
        <p className="mt-2 max-w-md text-sm leading-7 text-slate-500">先去模板管理上传真实样本，系统才能还原文档结构并生成报告预览。</p>
      </div>
    );
  }

  if (!template.sourceDocAvailable) {
    return (
      <div className="flex min-h-[760px] flex-col items-center justify-center rounded-[28px] border border-slate-200 bg-white text-center shadow-sm">
        <div className="text-base font-semibold text-slate-800">样本文件已丢失</div>
        <p className="mt-2 max-w-md text-sm leading-7 text-slate-500">
          这个模板曾经上传过报告样本，但当前文件已经不在本机了。请回到模板管理重新上传样本后再生成报告。
        </p>
      </div>
    );
  }

  if (rendering) {
    return (
      <div className="flex min-h-[760px] items-center justify-center rounded-[28px] border border-slate-200 bg-white text-gray-400 shadow-sm">
        <span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex min-h-[760px] items-center justify-center rounded-[28px] border border-slate-200 bg-white text-gray-400 shadow-sm">
        暂无可展示的报告预览
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">报告预览</div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">{preview.periodLabel}</span>
          <span
            className={`rounded-full px-3 py-1 font-semibold ${
              preview.source === 'live'
                ? 'bg-emerald-50 text-emerald-700'
                : preview.source === 'cache'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-sky-50 text-sky-700'
            }`}
          >
            {preview.source === 'live' ? '实时接口' : preview.source === 'cache' ? '缓存' : '样例数据'}
          </span>
        </div>
      </div>

      <div className="min-h-[760px] rounded-[20px] bg-slate-50/70 p-10 md:p-12">
        <div className="doc-preview rounded-[12px] border border-slate-200 bg-white p-10 text-gray-800 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      </div>
    </div>
  );
}

function RecentReportPanel(props: { reportList: ReportRecord[]; selectedReportId: string }) {
  const { reportList, selectedReportId } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-900">最近报告记录</div>
      <p className="mt-1 text-xs leading-6 text-slate-500">左侧边栏用于快速切换，这里保留最近记录的上下文信息，方便你判断当前预览来自哪里。</p>

      <div className="mt-4 space-y-3">
        {reportList.length > 0 ? (
          reportList.slice(0, 8).map((report) => (
            <div
              key={report.id}
              className={`rounded-[18px] border px-4 py-4 ${
                selectedReportId === report.id ? 'border-primary bg-primary/[0.05]' : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <div className="text-sm font-semibold text-slate-900">{report.templateName}</div>
              <div className="mt-1 text-xs text-slate-500">{report.periodLabel}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-500">预览 {report.previewCount}</span>
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-500">导出 {report.exportCount}</span>
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-500">
                  {report.lastAction === 'export' ? '最后动作: 导出' : '最后动作: 预览'}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            还没有生成过报告，先从左侧模板卡开始生成第一份。
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip(props: { label: string; value: string; tone: 'default' | 'success' | 'warn' }) {
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

function getPeriodTypeLabel(periodType: TemplateSummary['periodType']): string {
  if (periodType === 'quarterly') {
    return '季度模板';
  }
  if (periodType === 'monthly') {
    return '月度模板';
  }
  return '年度模板';
}
