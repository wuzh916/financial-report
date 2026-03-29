import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TemplateEdit } from './pages/TemplateEdit';
import { TemplateVariablesPage } from './pages/TemplateVariablesPage';
import { ReportCenter } from './pages/ReportCenter';
import { useOutletContext } from 'react-router-dom';
import { LayoutContext } from './components/Layout';

function TemplateIndex() {
  const { tplList, selectedTplId } = useOutletContext<LayoutContext>();
  if (tplList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <span className="material-symbols-outlined text-6xl mb-4">description</span>
        <p className="text-lg font-medium text-gray-600">还没有模板</p>
        <p className="text-sm mt-1">点击左下角"新建模板"开始创建</p>
      </div>
    );
  }
  const targetId = selectedTplId || tplList[0].id;
  return <Navigate to={`/templates/${targetId}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ReportCenter />} />
        <Route path="/templates" element={<TemplateIndex />} />
        <Route path="/templates/:id/variables" element={<TemplateVariablesPage />} />
        <Route path="/templates/:id" element={<TemplateEdit />} />
      </Route>
    </Routes>
  );
}
