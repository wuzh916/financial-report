import {
  ConnectorConfig,
  PeriodSnapshot,
  RenderResponse,
  TemplateDetail,
  TemplateSummary,
  VariableDraft,
} from '../types';

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.headers.get('content-type')?.includes('application/json')) {
    return res.json();
  }
  return res as unknown as T;
}

export const templates = {
  list: () => request<TemplateSummary[]>('/templates'),
  get: (id: string) => request<TemplateDetail>(`/templates/${id}`),

  create: (data: {
    name: string;
    category?: string;
    description?: string;
    periodType?: 'annual' | 'quarterly' | 'monthly';
  }) =>
    request<TemplateSummary>('/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: Partial<Pick<TemplateSummary, 'name' | 'category' | 'description' | 'periodType'>>
  ) =>
    request<TemplateDetail>(`/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/templates/${id}`, { method: 'DELETE' }),

  uploadSample: (id: string, file: File) => {
    const form = new FormData();
    form.append('document', file);
    return request<{
      template: TemplateDetail;
      candidatesCount: number;
      paragraphsCount: number;
    }>(`/templates/${id}/sample`, {
      method: 'POST',
      body: form,
    });
  },

  preview: (id: string) =>
    request<{ html: string }>(`/templates/${id}/preview`),

  saveVariables: (id: string, variables: VariableDraft[]) =>
    request<TemplateDetail>(`/templates/${id}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables }),
    }),

  addManualVariable: (
    id: string,
    data: { sourceText: string; key: string; label: string; jsonPath?: string }
  ) =>
    request<TemplateDetail>(`/templates/${id}/variables/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateParagraph: (id: string, paragraphId: string, templateText: string) =>
    request<TemplateDetail>(`/templates/${id}/paragraphs/${paragraphId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateText }),
    }),

  saveConnector: (id: string, data: Partial<ConnectorConfig>) =>
    request<ConnectorConfig>(`/templates/${id}/connector`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  listSnapshots: (id: string) =>
    request<PeriodSnapshot[]>(`/templates/${id}/snapshots`),

  upsertSnapshot: (
    id: string,
    data: {
      id?: string;
      periodKey: string;
      periodLabel: string;
      payload: Record<string, unknown>;
      sourceKind?: 'mock' | 'fetched';
    }
  ) =>
    request<PeriodSnapshot>(
      data.id ? `/templates/${id}/snapshots/${data.id}` : `/templates/${id}/snapshots`,
      {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    ),

  deleteSnapshot: (id: string, snapshotId: string) =>
    request<{ success: boolean }>(`/templates/${id}/snapshots/${snapshotId}`, {
      method: 'DELETE',
    }),
};

export const reports = {
  render: (templateId: string, periodKey: string, forceRefresh = false) =>
    request<RenderResponse>('/reports/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, periodKey, forceRefresh }),
    }),

  exportUrl: (templateId: string, periodKey: string, forceRefresh = false) =>
    `${BASE}/reports/${templateId}/export?periodKey=${encodeURIComponent(periodKey)}${
      forceRefresh ? '&forceRefresh=1' : ''
    }`,
};
