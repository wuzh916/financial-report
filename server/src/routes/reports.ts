import { Router, Request, Response } from 'express';
import * as store from '../services/store.js';
import { deleteCache, getCache, setCache } from '../services/cache.js';
import { getPeriodParts, formatPeriodLabel } from '../services/periods.js';
import { getDocxHtmlFromBuffer, renderTemplateBuffer } from '../services/docx-parser.js';
import { ConnectorConfig, RenderResponse, RenderSource, TemplateDetail } from '../types.js';

const router = Router();

class ReportRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

router.get('/history', (_req: Request, res: Response) => {
  try {
    res.json(store.listReportRecords());
  } catch (error) {
    console.error('List report history failed:', error);
    res.status(500).json({ error: '获取报告记录失败' });
  }
});

router.post('/render', async (req: Request, res: Response) => {
  try {
    const { templateId, periodKey, forceRefresh } = req.body;
    if (!templateId) {
      return res.status(400).json({ error: 'templateId 不能为空' });
    }
    if (!periodKey) {
      return res.status(400).json({ error: 'periodKey 不能为空' });
    }

    const template = store.getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    if (!template.sourceDocPath) {
      return res.status(400).json({ error: '请先上传样本报告' });
    }

    const payloadResult = await resolvePayload(template, periodKey, Boolean(forceRefresh));
    const mapping = buildVariableMapping(template, payloadResult.payload);
    const buffer = await renderTemplateBuffer(template.sourceDocPath, template.paragraphs, mapping);
    const html = await getDocxHtmlFromBuffer(buffer);

    const response: RenderResponse = {
      html,
      mapping,
      payload: payloadResult.payload,
      source: payloadResult.source,
      cachedAt: payloadResult.cachedAt,
      periodKey,
      periodLabel: payloadResult.periodLabel,
    };

    store.upsertReportRecord({
      templateId: template.id,
      periodKey,
      periodLabel: payloadResult.periodLabel,
      source: payloadResult.source,
      action: 'preview',
    });

    res.json(response);
  } catch (error) {
    console.error('Render report failed:', error);
    const status = error instanceof ReportRouteError ? error.status : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : '生成报告预览失败' });
  }
});

router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const templateId = req.params.id;
    const periodKey = String(req.query.periodKey || req.query.period || '');
    const forceRefresh = String(req.query.forceRefresh || '') === '1';

    if (!periodKey) {
      return res.status(400).json({ error: 'periodKey 不能为空' });
    }

    const template = store.getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    if (!template.sourceDocPath) {
      return res.status(400).json({ error: '请先上传样本报告' });
    }

    const payloadResult = await resolvePayload(template, periodKey, forceRefresh);
    const mapping = buildVariableMapping(template, payloadResult.payload);
    const buffer = await renderTemplateBuffer(template.sourceDocPath, template.paragraphs, mapping);
    const filename = `${template.name}-${payloadResult.periodLabel}.docx`;

    store.upsertReportRecord({
      templateId,
      periodKey,
      periodLabel: payloadResult.periodLabel,
      source: payloadResult.source,
      action: 'export',
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export report failed:', error);
    const status = error instanceof ReportRouteError ? error.status : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : '导出报告失败' });
  }
});

async function resolvePayload(
  template: TemplateDetail,
  periodKey: string,
  forceRefresh: boolean
): Promise<{
  payload: Record<string, unknown>;
  source: RenderSource;
  cachedAt: string | null;
  periodLabel: string;
}> {
  const cacheKey = `report:payload:${template.id}:${periodKey}`;
  const periodLabel = formatPeriodLabel(template.periodType, periodKey);

  if (!forceRefresh) {
    const cached = await getCache(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { payload: Record<string, unknown>; cachedAt: string; periodLabel: string };
      return {
        payload: parsed.payload,
        source: 'cache',
        cachedAt: parsed.cachedAt,
        periodLabel: parsed.periodLabel || periodLabel,
      };
    }
  }

  if (template.connector.mode === 'mock' || !template.connector.enabled) {
    const snapshot = store.getSnapshotByPeriod(template.id, periodKey, 'mock');
    if (!snapshot) {
      throw new ReportRouteError(404, '当前周期没有可用的模拟数据');
    }
    await setCache(
      cacheKey,
      JSON.stringify({
        payload: snapshot.payload,
        cachedAt: snapshot.updatedAt,
        periodLabel: snapshot.periodLabel,
      }),
      Math.max(60, template.connector.cacheTtlSeconds)
    );
    return {
      payload: snapshot.payload,
      source: 'mock',
      cachedAt: snapshot.updatedAt,
      periodLabel: snapshot.periodLabel,
    };
  }

  if (!forceRefresh) {
    const snapshot = store.getSnapshotByPeriod(template.id, periodKey, 'fetched');
    if (snapshot && snapshot.sourceKind === 'fetched') {
      await setCache(
        cacheKey,
        JSON.stringify({
          payload: snapshot.payload,
          cachedAt: snapshot.updatedAt,
          periodLabel: snapshot.periodLabel,
        }),
        Math.max(60, template.connector.cacheTtlSeconds)
      );
      return {
        payload: snapshot.payload,
        source: 'cache',
        cachedAt: snapshot.updatedAt,
        periodLabel: snapshot.periodLabel,
      };
    }
  }

  const payload = await fetchPayload(template.connector, template.periodType, periodKey);
  const fetchedAt = new Date().toISOString();
  const snapshot = store.upsertSnapshot({
    templateId: template.id,
    periodKey,
    periodLabel,
    payload,
    sourceKind: 'fetched',
  });

  await deleteCache(cacheKey);
  await setCache(
    cacheKey,
    JSON.stringify({
      payload: snapshot.payload,
      cachedAt: fetchedAt,
      periodLabel,
    }),
    Math.max(60, template.connector.cacheTtlSeconds)
  );

  return {
    payload,
    source: 'live',
    cachedAt: fetchedAt,
    periodLabel,
  };
}

async function fetchPayload(
  connector: ConnectorConfig,
  periodType: TemplateDetail['periodType'],
  periodKey: string
): Promise<Record<string, unknown>> {
  if (!connector.url.trim()) {
    throw new ReportRouteError(400, '当前模板还没有配置接口地址');
  }

  const periodParts = {
    ...getPeriodParts(periodKey),
    periodLabel: formatPeriodLabel(periodType, periodKey),
  };

  const method = connector.method.toUpperCase() || 'GET';
  const url = new URL(applyTemplateString(connector.url, periodParts));
  const headers = parseJsonObject(connector.headersText, periodParts);
  const query = parseJsonObject(connector.queryText, periodParts);
  const body = parseJsonValue(connector.bodyText, periodParts);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: headers as HeadersInit,
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(connector.timeoutMs),
  });

  if (!response.ok) {
    throw new ReportRouteError(502, `接口请求失败: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const payload = connector.responsePath ? getJsonValue(json, connector.responsePath) : json;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ReportRouteError(400, '接口响应不是对象，或 responsePath 指向的内容无效');
  }

  return payload as Record<string, unknown>;
}

function buildVariableMapping(
  template: TemplateDetail,
  payload: Record<string, unknown>
): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const variable of template.variables) {
    if (!variable.jsonPath) {
      mapping[variable.key] = '';
      continue;
    }
    const value = getJsonValue(payload, variable.jsonPath);
    mapping[variable.key] = value === null || value === undefined ? '' : String(value);
  }

  return mapping;
}

function parseJsonObject(text: string, vars: Record<string, string>): Record<string, unknown> {
  const value = parseJsonValue(text, vars);
  if (!value) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('接口配置中的 JSON 必须是对象');
  }
  return value as Record<string, unknown>;
}

function parseJsonValue(text: string, vars: Record<string, string>): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  return applyTemplateValue(parsed, vars);
}

function applyTemplateValue(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return applyTemplateString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyTemplateValue(item, vars));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        applyTemplateValue(entryValue, vars),
      ])
    );
  }
  return value;
}

function applyTemplateString(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_fullMatch, key: string) => vars[key] ?? '');
}

function getJsonValue(obj: unknown, path: string): unknown {
  if (!obj || !path) {
    return undefined;
  }

  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, obj);
}

export default router;
