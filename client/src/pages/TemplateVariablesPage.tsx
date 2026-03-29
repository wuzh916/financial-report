import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { templates } from '../api';
import { LayoutContext } from '../components/Layout';
import { TemplateDetail } from '../types';

const PAGE_SIZE = 20;

export function TemplateVariablesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshList } = useOutletContext<LayoutContext>();

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!id) {
      return;
    }

    setLoading(true);
    setError('');

    templates
      .get(id)
      .then((result) => {
        setTemplate(result);
        refreshList();
      })
      .catch((err) => {
        setTemplate(null);
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
  }, [id, refreshList]);

  const filteredVariables = useMemo(() => {
    if (!template) {
      return [];
    }

    const query = search.trim().toLowerCase();
    if (!query) {
      return template.variables;
    }

    return template.variables.filter((variable) =>
      [variable.label, variable.key, variable.jsonPath, variable.sourceText].join(' ').toLowerCase().includes(query)
    );
  }, [search, template]);

  const totalPages = Math.max(1, Math.ceil(filteredVariables.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pagedVariables = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredVariables.slice(start, start + PAGE_SIZE);
  }, [filteredVariables, page]);

  const mappedCount = template?.variables.filter((variable) => variable.jsonPath.trim()).length ?? 0;
  const unmappedCount = (template?.variables.length ?? 0) - mappedCount;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <span className="material-symbols-outlined mr-2 animate-spin">progress_activity</span>
        正在加载变量总表...
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        {error || '未找到模板'}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,_rgba(231,241,221,0.8),_rgba(248,250,252,0.94)_38%,_rgba(255,255,255,1)_100%)]">
      <header className="shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="flex min-h-20 items-center justify-between gap-4 px-6 py-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate(`/templates/${template.id}`)}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                返回编辑页
              </button>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                变量总表
              </span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{template.name}</h1>
              <p className="mt-1 text-xs text-slate-500">
                这里集中查看所有变量的变量名、编码和映射情况，编辑动作仍然回到报告页完成。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SummaryChip label="总变量" value={String(template.variables.length)} tone="default" />
            <SummaryChip label="已映射" value={String(mappedCount)} tone="success" />
            <SummaryChip label="待补充" value={String(unmappedCount)} tone={unmappedCount > 0 ? 'warn' : 'default'} />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1180px] space-y-4">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">变量列表</div>
              <div className="relative w-full max-w-sm">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  search
                </span>
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-white"
                  placeholder="搜索变量名、编码、映射路径"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(180px,1.1fr)_minmax(220px,1.2fr)] border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <div>变量名</div>
              <div>编码</div>
              <div>映射情况</div>
            </div>

            {pagedVariables.length > 0 ? (
              <div className="divide-y divide-slate-200">
                {pagedVariables.map((variable) => {
                  const mapped = variable.jsonPath.trim().length > 0;

                  return (
                    <div
                      key={variable.id}
                      className="grid grid-cols-[minmax(0,2.4fr)_minmax(180px,1.1fr)_minmax(220px,1.2fr)] gap-4 px-5 py-4 text-sm text-slate-700"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{variable.label || '未命名变量'}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{variable.sourceText || '未绑定原文片段'}</div>
                      </div>
                      <div className="min-w-0 font-mono text-slate-700">{variable.key || '未配置编码'}</div>
                      <div className="min-w-0">
                        <div
                          className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${
                            mapped ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {mapped ? '已映射' : '待映射'}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {mapped ? variable.jsonPath : '未配置 jsonPath'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-sm text-slate-500">没有匹配到变量。</div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm text-slate-500">
              第 {page} / {totalPages} 页，共 {filteredVariables.length} 条变量
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
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
