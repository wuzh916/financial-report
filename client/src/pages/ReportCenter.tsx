import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { reports, templates } from '../api';
import { LayoutContext } from '../components/Layout';
import { RenderResponse, TemplateDetail } from '../types';
import { getDefaultPeriodKey, getPeriodOptions } from '../utils/periods';

export function ReportCenter() {
  const { selectedTplId, tplList } = useOutletContext<LayoutContext>();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [preview, setPreview] = useState<RenderResponse | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedTplId) {
      setTemplate(null);
      return;
    }

    setLoadingTemplate(true);
    setError('');
    templates
      .get(selectedTplId)
      .then((result) => {
        setTemplate(result);
        setSelectedPeriod(getDefaultPeriodKey(result.periodType));
      })
      .catch((err) => {
        setTemplate(null);
        setError((err as Error).message);
      })
      .finally(() => setLoadingTemplate(false));
  }, [selectedTplId]);

  const periodOptions = useMemo(
    () => (template ? getPeriodOptions(template.periodType) : []),
    [template]
  );

  const renderReport = async (forceRefresh = false) => {
    if (!template || !selectedPeriod) {
      return;
    }

    setRendering(true);
    setError('');
    try {
      const result = await reports.render(template.id, selectedPeriod, forceRefresh);
      setPreview(result);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, selectedPeriod]);

  const handleExport = () => {
    if (!template || !selectedPeriod) {
      return;
    }
    window.open(reports.exportUrl(template.id, selectedPeriod), '_blank');
  };

  if (tplList.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        请先在模板管理中创建模板并上传样本报告
      </div>
    );
  }

  if (loadingTemplate) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
        加载模板中...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-16 shrink-0 border-b border-gray-100 bg-white px-6 flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-gray-800">{template?.name || '报告中心'}</h2>
            {template && (
              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">
                {template.periodType === 'annual'
                  ? '年度'
                  : template.periodType === 'quarterly'
                    ? '季度'
                    : '月度'}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            默认展示上一已完成周期，可切换周期重新渲染，也可强制刷新接口缓存
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedPeriod}
            onChange={(event) => setSelectedPeriod(event.target.value)}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-primary"
          >
            {periodOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => renderReport(true)}
            disabled={!template || rendering}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            强制刷新
          </button>

          <button
            onClick={handleExport}
            disabled={!preview}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-light disabled:opacity-50"
          >
            导出 .docx
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-gray-100">
        <div className="mx-auto max-w-[1160px] p-6 space-y-4">
          {template && (
            <div className="rounded-xl bg-white border border-gray-100 px-5 py-4 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span className="font-semibold text-gray-700">取数方式：</span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1">
                {template.connector.mode === 'http' && template.connector.enabled ? '接口实时取数' : '模拟数据'}
              </span>
              {preview && (
                <>
                  <span className="font-semibold text-gray-700">当前来源：</span>
                  <span
                    className={`rounded-full px-2.5 py-1 ${
                      preview.source === 'live'
                        ? 'bg-emerald-50 text-emerald-700'
                        : preview.source === 'cache'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-sky-50 text-sky-700'
                    }`}
                  >
                    {preview.source === 'live'
                      ? '实时接口'
                      : preview.source === 'cache'
                        ? '缓存'
                        : '模拟数据'}
                  </span>
                  {preview.cachedAt && <span>更新时间：{new Date(preview.cachedAt).toLocaleString()}</span>}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="rounded-2xl bg-white shadow-lg min-h-[760px]">
            {rendering ? (
              <div className="min-h-[760px] flex items-center justify-center text-gray-400">
                <span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span>
              </div>
            ) : preview ? (
              <div className="p-12 md:p-16">
                <div
                  className="doc-preview text-gray-800 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </div>
            ) : (
              <div className="min-h-[760px] flex items-center justify-center text-gray-400">
                暂无可展示的报告预览
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
