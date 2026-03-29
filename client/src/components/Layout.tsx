import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { reports, templates } from '../api';
import { ReportRecord, TemplateSummary } from '../types';

export interface LayoutContext {
  refreshTemplates: () => void;
  refreshReports: () => void;
  tplList: TemplateSummary[];
  reportList: ReportRecord[];
  selectedTplId: string;
  selectedReportId: string;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tplList, setTplList] = useState<TemplateSummary[]>([]);
  const [reportList, setReportList] = useState<ReportRecord[]>([]);
  const [selectedTplId, setSelectedTplId] = useState('');
  const [selectedReportId, setSelectedReportId] = useState('');

  const isReportCenter = location.pathname === '/';
  const isTemplateMgmt = location.pathname.startsWith('/templates');

  const refreshTemplates = useCallback(async () => {
    try {
      const list = await templates.list();
      setTplList(list);
      if (list.length > 0 && !selectedTplId) {
        setSelectedTplId(list[0].id);
      }
    } catch {
      // ignore
    }
  }, [selectedTplId]);

  const refreshReports = useCallback(async () => {
    try {
      const list = await reports.history();
      setReportList(list);
      if (list.length > 0 && !selectedReportId) {
        setSelectedReportId(list[0].id);
      }
    } catch {
      // ignore
    }
  }, [selectedReportId]);

  useEffect(() => {
    refreshTemplates();
    refreshReports();
  }, [refreshReports, refreshTemplates]);

  useEffect(() => {
    const match = location.pathname.match(/^\/templates\/([^/]+)(?:\/.*)?$/);
    if (match && match[1] !== selectedTplId) {
      setSelectedTplId(match[1]);
    }
  }, [location.pathname, selectedTplId]);

  useEffect(() => {
    if (reportList.length === 0) {
      if (selectedReportId) {
        setSelectedReportId('');
      }
      return;
    }

    if (!reportList.some((item) => item.id === selectedReportId)) {
      setSelectedReportId(reportList[0].id);
    }
  }, [reportList, selectedReportId]);

  const handleCreate = async () => {
    const created = await templates.create({ name: '新建模板' });
    await refreshTemplates();
    setSelectedTplId(created.id);
    navigate(`/templates/${created.id}`);
  };

  const handleTemplateClick = (id: string) => {
    setSelectedTplId(id);
    navigate(`/templates/${id}`);
  };

  const handleReportClick = (id: string) => {
    setSelectedReportId(id);
    if (!isReportCenter) {
      navigate('/');
    }
  };

  const isActiveTemplate = (id: string) =>
    location.pathname === `/templates/${id}` || location.pathname.startsWith(`/templates/${id}/`);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-gray-200/60 bg-white">
        <div className="px-5 pb-5 pt-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <span className="material-symbols-outlined text-lg text-white" style={{ fontVariationSettings: "'FILL' 1" }}>
                analytics
              </span>
            </div>
            <div>
              <div className="text-sm font-bold leading-tight text-gray-800">财务报告管理系统</div>
              <div className="text-[10px] text-gray-400">Financial Report System</div>
            </div>
          </div>
        </div>

        <nav className="space-y-1 px-3">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
              }`
            }
          >
            <span className="material-symbols-outlined text-lg">article</span>
            报告中心
          </NavLink>
          <NavLink
            to="/templates"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
              }`
            }
          >
            <span className="material-symbols-outlined text-lg">dashboard_customize</span>
            模板管理
          </NavLink>
        </nav>

        <div className="mt-4 flex flex-1 flex-col overflow-hidden border-t border-gray-100 pt-4">
          <div className="mb-2 px-5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {isReportCenter ? '最近报告' : '模板列表'}
            </span>
          </div>

          <div className="hide-scrollbar flex-1 overflow-y-auto space-y-1 px-3">
            {isReportCenter ? (
              reportList.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs leading-6 text-gray-400">暂无报告记录</div>
              ) : (
                reportList.map((report) => {
                  const isActive = selectedReportId === report.id;

                  return (
                    <div
                      key={report.id}
                      onClick={() => handleReportClick(report.id)}
                      className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-all ${
                        isActive
                          ? 'border-blue-200/60 bg-blue-50 shadow-sm'
                          : 'border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <div className={`truncate text-xs font-semibold ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                        {report.templateName}
                      </div>
                      <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${isActive ? 'text-blue-500' : 'text-gray-400'}`}>
                        <span>{report.periodLabel}</span>
                        <span>·</span>
                        <span>{report.lastAction === 'export' ? '已导出' : '已预览'}</span>
                      </div>
                    </div>
                  );
                })
              )
            ) : tplList.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-gray-400">暂无模板</div>
            ) : (
              tplList.map((template) => (
                <div
                  key={template.id}
                  onClick={() => handleTemplateClick(template.id)}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-all ${
                    isActiveTemplate(template.id)
                      ? 'border-blue-200/60 bg-blue-50 shadow-sm'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <div className={`truncate text-xs font-semibold ${isActiveTemplate(template.id) ? 'text-blue-700' : 'text-gray-700'}`}>
                    {template.name}
                  </div>
                  <div className={`mt-0.5 text-[10px] ${isActiveTemplate(template.id) ? 'text-blue-500' : 'text-gray-400'}`}>
                    {template.variableCount > 0 ? `${template.variableCount} 个变量` : '未配置变量'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {isTemplateMgmt && (
          <div className="p-3">
            <button
              onClick={handleCreate}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-light"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              新建模板
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 overflow-hidden">
        <Outlet
          context={
            {
              refreshTemplates,
              refreshReports,
              tplList,
              reportList,
              selectedTplId,
              selectedReportId,
            } satisfies LayoutContext
          }
        />
      </div>
    </div>
  );
}
