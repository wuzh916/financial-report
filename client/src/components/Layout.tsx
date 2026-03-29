import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { templates } from '../api';
import { TemplateSummary } from '../types';

export interface LayoutContext {
  refreshList: () => void;
  tplList: TemplateSummary[];
  selectedTplId: string;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tplList, setTplList] = useState<TemplateSummary[]>([]);
  const [selectedTplId, setSelectedTplId] = useState('');

  const isReportCenter = location.pathname === '/';
  const isTemplateMgmt = location.pathname.startsWith('/templates');

  const refreshList = useCallback(async () => {
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

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Sync selectedTplId with URL when on template edit page
  useEffect(() => {
    const match = location.pathname.match(/^\/templates\/([^/]+)(?:\/.*)?$/);
    if (match && match[1] !== selectedTplId) {
      setSelectedTplId(match[1]);
    }
  }, [location.pathname]);

  const handleCreate = async () => {
    const t = await templates.create({ name: '新建模板' });
    await refreshList();
    setSelectedTplId(t.id);
    navigate(`/templates/${t.id}`);
  };

  const handleTemplateClick = (id: string) => {
    setSelectedTplId(id);
    if (!isReportCenter) {
      navigate(`/templates/${id}`);
    }
  };

  const isActiveTemplate = (id: string) => {
    if (isReportCenter) return selectedTplId === id;
    return location.pathname === `/templates/${id}` || location.pathname.startsWith(`/templates/${id}/`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-white border-r border-gray-200/60">
        {/* App title */}
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                analytics
              </span>
            </div>
            <div>
              <div className="text-sm font-bold text-gray-800 leading-tight">财务报告管理系统</div>
              <div className="text-[10px] text-gray-400">Financial Report System</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
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
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
              }`
            }
          >
            <span className="material-symbols-outlined text-lg">dashboard_customize</span>
            模板管理
          </NavLink>
        </nav>

        {/* Template list in sidebar */}
        <div className="flex-1 flex flex-col overflow-hidden mt-4 pt-4 border-t border-gray-100">
          <div className="px-5 mb-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              {isReportCenter ? '报告列表' : '模板列表'}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 px-3 hide-scrollbar">
            {tplList.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-gray-400">
                {isReportCenter ? '暂无报告' : '暂无模板'}
              </div>
            ) : (
              tplList.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleTemplateClick(t.id)}
                  className={`px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                    isActiveTemplate(t.id)
                      ? 'bg-blue-50 border border-blue-200/60 shadow-sm'
                      : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className={`text-xs font-semibold truncate ${isActiveTemplate(t.id) ? 'text-blue-700' : 'text-gray-700'}`}>
                    {t.name}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isActiveTemplate(t.id) ? 'text-blue-500' : 'text-gray-400'}`}>
                    {t.variableCount > 0 ? `${t.variableCount} 个变量` : '未配置变量'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Create button - only show in Template Management */}
        {isTemplateMgmt && (
          <div className="p-3">
            <button
              onClick={handleCreate}
              className="w-full py-2 bg-primary text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-primary-light transition-colors text-xs"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              新建模板
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <Outlet context={{ refreshList, tplList, selectedTplId } satisfies LayoutContext} />
      </div>
    </div>
  );
}
