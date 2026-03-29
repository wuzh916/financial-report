import { v4 as uuid } from 'uuid';
import { db } from './db.js';
import {
  ConnectorConfig,
  PeriodSnapshot,
  SnapshotSourceKind,
  TemplateCandidate,
  TemplateDetail,
  TemplateParagraph,
  TemplateSummary,
  TemplateVariable,
  VariableDraft,
} from '../types.js';
import { buildParagraphTemplates } from './docx-parser.js';

type TemplateRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  period_type: string;
  source_doc_path: string;
  created_at: string;
  updated_at: string;
  variable_count?: number;
  candidate_count?: number;
};

type ParagraphRow = {
  id: string;
  template_id: string;
  paragraph_order: number;
  original_text: string;
  template_text: string;
  in_table: number;
  table_id: string | null;
  table_row: number | null;
  table_col: number | null;
  table_cols: number | null;
  is_customized: number;
};

type CandidateRow = {
  id: string;
  template_id: string;
  paragraph_id: string;
  value_text: string;
  match_start: number;
  match_end: number;
  occurrence_index: number;
  candidate_kind: string;
  label_hint: string;
};

type VariableRow = {
  id: string;
  template_id: string;
  candidate_id: string | null;
  paragraph_id: string | null;
  variable_key: string;
  label: string;
  json_path: string;
  source_text: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ConnectorRow = {
  template_id: string;
  mode: string;
  enabled: number;
  method: string;
  url: string;
  headers_text: string;
  query_text: string;
  body_text: string;
  response_path: string;
  timeout_ms: number;
  cache_ttl_seconds: number;
  updated_at: string;
};

type SnapshotRow = {
  id: string;
  template_id: string;
  period_key: string;
  period_label: string;
  payload_json: string;
  source_kind: string;
  created_at: string;
  updated_at: string;
};

export function listTemplates(): TemplateSummary[] {
  const rows = db
    .prepare(`
      SELECT
        t.*,
        (SELECT COUNT(*) FROM template_variables v WHERE v.template_id = t.id) AS variable_count,
        (SELECT COUNT(*) FROM template_candidates c WHERE c.template_id = t.id) AS candidate_count
      FROM templates t
      ORDER BY datetime(t.updated_at) DESC
    `)
    .all() as TemplateRow[];

  return rows.map(toTemplateSummary);
}

export function getTemplate(id: string): TemplateDetail | null {
  const row = db
    .prepare(`
      SELECT
        t.*,
        (SELECT COUNT(*) FROM template_variables v WHERE v.template_id = t.id) AS variable_count,
        (SELECT COUNT(*) FROM template_candidates c WHERE c.template_id = t.id) AS candidate_count
      FROM templates t
      WHERE t.id = ?
    `)
    .get(id) as TemplateRow | undefined;

  if (!row) {
    return null;
  }

  ensureConnectorRow(id);

  const paragraphs = db
    .prepare(`
      SELECT *
      FROM template_paragraphs
      WHERE template_id = ?
      ORDER BY paragraph_order ASC
    `)
    .all(id) as ParagraphRow[];

  const paragraphMap = new Map<string, TemplateParagraph>();
  const mappedParagraphs = paragraphs.map((paragraph) => {
    const mapped = toParagraph(paragraph);
    paragraphMap.set(mapped.id, mapped);
    return mapped;
  });

  const candidates = (db
    .prepare(`
      SELECT *
      FROM template_candidates
      WHERE template_id = ?
      ORDER BY paragraph_id ASC, match_start ASC
    `)
    .all(id) as CandidateRow[]).map((candidate) => toCandidate(candidate, paragraphMap));

  const variables = (db
    .prepare(`
      SELECT *
      FROM template_variables
      WHERE template_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `)
    .all(id) as VariableRow[]).map(toVariable);

  const connector = toConnector(
    db.prepare(`SELECT * FROM template_connectors WHERE template_id = ?`).get(id) as ConnectorRow
  );

  const snapshots = (db
    .prepare(`
      SELECT *
      FROM period_snapshots
      WHERE template_id = ?
        AND source_kind = 'mock'
      ORDER BY period_key DESC
    `)
    .all(id) as SnapshotRow[]).map(toSnapshot);

  return {
    ...toTemplateSummary(row),
    paragraphs: mappedParagraphs,
    candidates,
    variables,
    connector,
    snapshots,
  };
}

export function createTemplate(data: {
  name: string;
  category?: string;
  description?: string;
  periodType?: string;
}): TemplateSummary {
  const now = new Date().toISOString();
  const id = uuid();

  db.prepare(`
    INSERT INTO templates (
      id, name, category, description, period_type, source_doc_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?)
  `).run(id, data.name, data.category ?? '', data.description ?? '', data.periodType ?? 'annual', now, now);

  ensureConnectorRow(id);

  return getTemplate(id)!;
}

export function updateTemplateBasics(
  id: string,
  data: Partial<Pick<TemplateSummary, 'name' | 'category' | 'description' | 'periodType'>>
): TemplateDetail | null {
  const current = getTemplate(id);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE templates
    SET name = ?, category = ?, description = ?, period_type = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.name ?? current.name,
    data.category ?? current.category,
    data.description ?? current.description,
    data.periodType ?? current.periodType,
    now,
    id
  );

  return getTemplate(id);
}

export function deleteTemplate(id: string): void {
  db.prepare(`DELETE FROM templates WHERE id = ?`).run(id);
}

export function replaceTemplateDocument(
  templateId: string,
  sourceDocPath: string,
  paragraphs: Array<Omit<TemplateParagraph, 'templateId'>>,
  candidates: TemplateCandidate[]
): TemplateDetail | null {
  const current = getTemplate(templateId);
  if (!current) {
    return null;
  }

  const nextTitle = extractDocumentTitle(paragraphs);
  const nextName = shouldAutoRenameTemplate(current.name) && nextTitle ? nextTitle : current.name;
  const now = new Date().toISOString();
  transaction(() => {
    db.prepare(`UPDATE templates SET name = ?, source_doc_path = ?, updated_at = ? WHERE id = ?`).run(
      nextName,
      sourceDocPath,
      now,
      templateId
    );
    db.prepare(`DELETE FROM template_paragraphs WHERE template_id = ?`).run(templateId);
    db.prepare(`DELETE FROM template_candidates WHERE template_id = ?`).run(templateId);
    db.prepare(`DELETE FROM template_variables WHERE template_id = ?`).run(templateId);

    const insertParagraph = db.prepare(`
      INSERT INTO template_paragraphs (
        id, template_id, paragraph_order, original_text, template_text, in_table, table_id, table_row, table_col, table_cols, is_customized
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const paragraph of paragraphs) {
      insertParagraph.run(
        paragraph.id,
        templateId,
        paragraph.order,
        paragraph.originalText,
        paragraph.templateText,
        paragraph.inTable ? 1 : 0,
        paragraph.tableId,
        paragraph.tableRow,
        paragraph.tableCol,
        paragraph.tableCols,
        paragraph.isCustomized ? 1 : 0
      );
    }

    const insertCandidate = db.prepare(`
      INSERT INTO template_candidates (
        id, template_id, paragraph_id, value_text, match_start, match_end, occurrence_index, candidate_kind, label_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const candidate of candidates) {
      insertCandidate.run(
        candidate.id,
        templateId,
        candidate.paragraphId,
        candidate.valueText,
        candidate.matchStart,
        candidate.matchEnd,
        candidate.occurrenceIndex,
        candidate.kind,
        candidate.labelHint
      );
    }
  });

  return getTemplate(templateId);
}

export function replaceTemplateVariables(templateId: string, drafts: VariableDraft[]): TemplateDetail | null {
  const template = getTemplate(templateId);
  if (!template) {
    return null;
  }

  const now = new Date().toISOString();
  const paragraphMap = new Map(template.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const candidateMap = new Map(template.candidates.map((candidate) => [candidate.id, candidate]));
  const manualCandidates: TemplateCandidate[] = [];

  const variables = drafts.map((draft, index) => {
    const existingCandidate = draft.candidateId ? candidateMap.get(draft.candidateId) : undefined;
    let resolvedCandidate = existingCandidate;

    if (!resolvedCandidate && draft.paragraphId) {
      resolvedCandidate = buildManualCandidate(templateId, draft, paragraphMap);
    } else if (resolvedCandidate?.kind === 'manual') {
      const manualCandidate = buildManualCandidate(templateId, draft, paragraphMap, resolvedCandidate);
      resolvedCandidate = manualCandidate;
    }

    if (resolvedCandidate?.kind === 'manual') {
      manualCandidates.push(resolvedCandidate);
    }

    return {
      id: draft.id ?? uuid(),
      templateId,
      candidateId: resolvedCandidate?.id ?? draft.candidateId ?? null,
      paragraphId: draft.paragraphId ?? resolvedCandidate?.paragraphId ?? null,
      key: draft.key,
      label: draft.label,
      jsonPath: draft.jsonPath ?? '',
      sourceText: draft.sourceText ?? resolvedCandidate?.valueText ?? '',
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    } satisfies TemplateVariable;
  });

  const persistedCandidates = template.candidates.filter((candidate) => candidate.kind !== 'manual');
  const rebuiltParagraphs = buildParagraphTemplates(template.paragraphs, [...persistedCandidates, ...manualCandidates], variables);

  transaction(() => {
    db.prepare(`DELETE FROM template_variables WHERE template_id = ?`).run(templateId);
    db.prepare(`DELETE FROM template_candidates WHERE template_id = ? AND candidate_kind = 'manual'`).run(templateId);

    const insertCandidate = db.prepare(`
      INSERT INTO template_candidates (
        id, template_id, paragraph_id, value_text, match_start, match_end, occurrence_index, candidate_kind, label_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const candidate of manualCandidates) {
      insertCandidate.run(
        candidate.id,
        templateId,
        candidate.paragraphId,
        candidate.valueText,
        candidate.matchStart,
        candidate.matchEnd,
        candidate.occurrenceIndex,
        candidate.kind,
        candidate.labelHint
      );
    }

    const insertVariable = db.prepare(`
      INSERT INTO template_variables (
        id, template_id, candidate_id, paragraph_id, variable_key, label, json_path, source_text, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const variable of variables) {
      insertVariable.run(
        variable.id,
        variable.templateId,
        variable.candidateId,
        variable.paragraphId,
        variable.key,
        variable.label,
        variable.jsonPath,
        variable.sourceText,
        variable.sortOrder,
        variable.createdAt,
        variable.updatedAt
      );
    }

    const updateParagraph = db.prepare(`
      UPDATE template_paragraphs
      SET template_text = ?, is_customized = ?
      WHERE id = ? AND template_id = ?
    `);

    for (const paragraph of rebuiltParagraphs) {
      updateParagraph.run(
        paragraph.templateText,
        paragraph.isCustomized ? 1 : 0,
        paragraph.id,
        templateId
      );
    }

    db.prepare(`UPDATE templates SET updated_at = ? WHERE id = ?`).run(now, templateId);
  });

  return getTemplate(templateId);
}

export function addManualVariable(
  templateId: string,
  data: { sourceText: string; key: string; label: string; jsonPath?: string }
): TemplateDetail | null {
  const template = getTemplate(templateId);
  if (!template) {
    return null;
  }

  const sourceText = data.sourceText.trim();
  if (!sourceText) {
    throw new Error('原文片段不能为空');
  }

  const matches: Array<{ paragraph: TemplateParagraph; index: number }> = [];
  for (const paragraph of template.paragraphs) {
    const index = paragraph.originalText.indexOf(sourceText);
    if (index >= 0) {
      matches.push({ paragraph, index });
    }
  }

  if (matches.length === 0) {
    throw new Error('没有找到该原文片段，请确认填写内容与报告完全一致');
  }

  if (matches.length > 1) {
    throw new Error('该原文片段出现了多次，请填写更精确的片段');
  }

  const [{ paragraph, index }] = matches;
  const now = new Date().toISOString();
  const candidateId = uuid();

  transaction(() => {
    db.prepare(`
      INSERT INTO template_candidates (
        id, template_id, paragraph_id, value_text, match_start, match_end, occurrence_index, candidate_kind, label_hint
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'manual', ?)
    `).run(candidateId, templateId, paragraph.id, sourceText, index, index + sourceText.length, sourceText);

    const variableId = uuid();
    db.prepare(`
      INSERT INTO template_variables (
        id, template_id, candidate_id, paragraph_id, variable_key, label, json_path, source_text, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      variableId,
      templateId,
      candidateId,
      paragraph.id,
      data.key,
      data.label,
      data.jsonPath ?? '',
      sourceText,
      template.variables.length,
      now,
      now
    );
  });

  return replaceTemplateVariables(
    templateId,
    getTemplate(templateId)!.variables.map((variable) => ({
      id: variable.id,
      candidateId: variable.candidateId,
      paragraphId: variable.paragraphId,
      key: variable.key,
      label: variable.label,
      jsonPath: variable.jsonPath,
      sourceText: variable.sourceText,
    }))
  );
}

export function updateParagraphTemplateText(
  templateId: string,
  paragraphId: string,
  templateText: string
): TemplateDetail | null {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE template_paragraphs
    SET template_text = ?, is_customized = 1
    WHERE template_id = ? AND id = ?
  `).run(templateText, templateId, paragraphId);
  db.prepare(`UPDATE templates SET updated_at = ? WHERE id = ?`).run(now, templateId);
  return getTemplate(templateId);
}

export function upsertConnector(templateId: string, connector: Partial<ConnectorConfig>): ConnectorConfig {
  ensureConnectorRow(templateId);
  const current = toConnector(
    db.prepare(`SELECT * FROM template_connectors WHERE template_id = ?`).get(templateId) as ConnectorRow
  );
  const next: ConnectorConfig = {
    ...current,
    ...connector,
    templateId,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO template_connectors (
      template_id, mode, enabled, method, url, headers_text, query_text, body_text, response_path, timeout_ms, cache_ttl_seconds, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id) DO UPDATE SET
      mode = excluded.mode,
      enabled = excluded.enabled,
      method = excluded.method,
      url = excluded.url,
      headers_text = excluded.headers_text,
      query_text = excluded.query_text,
      body_text = excluded.body_text,
      response_path = excluded.response_path,
      timeout_ms = excluded.timeout_ms,
      cache_ttl_seconds = excluded.cache_ttl_seconds,
      updated_at = excluded.updated_at
  `).run(
    next.templateId,
    next.mode,
    next.enabled ? 1 : 0,
    next.method,
    next.url,
    next.headersText,
    next.queryText,
    next.bodyText,
    next.responsePath,
    next.timeoutMs,
    next.cacheTtlSeconds,
    next.updatedAt
  );

  return next;
}

export function listSnapshots(templateId: string): PeriodSnapshot[] {
  return (db
    .prepare(`
      SELECT *
      FROM period_snapshots
      WHERE template_id = ?
        AND source_kind = 'mock'
      ORDER BY period_key DESC
    `)
    .all(templateId) as SnapshotRow[]).map(toSnapshot);
}

export function upsertSnapshot(data: {
  id?: string;
  templateId: string;
  periodKey: string;
  periodLabel: string;
  payload: Record<string, unknown>;
  sourceKind: SnapshotSourceKind;
}): PeriodSnapshot {
  const existing = db
    .prepare(`SELECT * FROM period_snapshots WHERE template_id = ? AND period_key = ? AND source_kind = ?`)
    .get(data.templateId, data.periodKey, data.sourceKind) as SnapshotRow | undefined;

  const now = new Date().toISOString();
  const row: PeriodSnapshot = {
    id: existing?.id ?? data.id ?? uuid(),
    templateId: data.templateId,
    periodKey: data.periodKey,
    periodLabel: data.periodLabel,
    payload: data.payload,
    sourceKind: data.sourceKind,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO period_snapshots (
      id, template_id, period_key, period_label, payload_json, source_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id, period_key, source_kind) DO UPDATE SET
      period_label = excluded.period_label,
      payload_json = excluded.payload_json,
      source_kind = excluded.source_kind,
      updated_at = excluded.updated_at
  `).run(
    row.id,
    row.templateId,
    row.periodKey,
    row.periodLabel,
    JSON.stringify(row.payload),
    row.sourceKind,
    row.createdAt,
    row.updatedAt
  );

  return row;
}

export function getSnapshotByPeriod(
  templateId: string,
  periodKey: string,
  sourceKind?: SnapshotSourceKind
): PeriodSnapshot | null {
  const row = db
    .prepare(
      sourceKind
        ? `SELECT * FROM period_snapshots WHERE template_id = ? AND period_key = ? AND source_kind = ?`
        : `SELECT * FROM period_snapshots WHERE template_id = ? AND period_key = ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(...(sourceKind ? [templateId, periodKey, sourceKind] : [templateId, periodKey])) as SnapshotRow | undefined;
  return row ? toSnapshot(row) : null;
}

export function deleteSnapshot(templateId: string, snapshotId: string): void {
  db.prepare(`DELETE FROM period_snapshots WHERE template_id = ? AND id = ?`).run(templateId, snapshotId);
}

export function deleteFetchedSnapshots(templateId: string): void {
  db.prepare(`DELETE FROM period_snapshots WHERE template_id = ? AND source_kind = 'fetched'`).run(templateId);
}

function ensureConnectorRow(templateId: string): void {
  const existing = db
    .prepare(`SELECT template_id FROM template_connectors WHERE template_id = ?`)
    .get(templateId) as { template_id: string } | undefined;

  if (existing) {
    return;
  }

  db.prepare(`
    INSERT INTO template_connectors (
      template_id, mode, enabled, method, url, headers_text, query_text, body_text, response_path, timeout_ms, cache_ttl_seconds, updated_at
    ) VALUES (?, 'mock', 0, 'GET', '', '', '', '', '', 15000, 21600, ?)
  `).run(templateId, new Date().toISOString());
}

function buildManualCandidate(
  templateId: string,
  draft: VariableDraft,
  paragraphMap: Map<string, TemplateParagraph>,
  existingCandidate?: TemplateCandidate
): TemplateCandidate {
  const paragraphId = draft.paragraphId ?? existingCandidate?.paragraphId;
  if (!paragraphId) {
    throw new Error(`变量 ${draft.key} 缺少段落定位信息`);
  }

  const paragraph = paragraphMap.get(paragraphId);
  if (!paragraph) {
    throw new Error(`变量 ${draft.key} 关联的段落不存在`);
  }

  const range = resolveManualCandidateRange(paragraph, draft, existingCandidate);

  return {
    id: existingCandidate?.id ?? draft.candidateId ?? uuid(),
    templateId,
    paragraphId,
    paragraphText: paragraph.originalText,
    valueText: range.valueText,
    matchStart: range.matchStart,
    matchEnd: range.matchEnd,
    occurrenceIndex: range.occurrenceIndex,
    kind: draft.candidateKind ?? existingCandidate?.kind ?? 'manual',
    labelHint: draft.label?.trim() || existingCandidate?.labelHint || range.valueText,
  };
}

function resolveManualCandidateRange(
  paragraph: TemplateParagraph,
  draft: VariableDraft,
  existingCandidate?: TemplateCandidate
): { valueText: string; matchStart: number; matchEnd: number; occurrenceIndex: number } {
  if (
    typeof draft.matchStart === 'number' &&
    typeof draft.matchEnd === 'number' &&
    draft.matchEnd > draft.matchStart
  ) {
    const valueText =
      draft.sourceText?.trim() || paragraph.originalText.slice(draft.matchStart, draft.matchEnd);
    return {
      valueText,
      matchStart: draft.matchStart,
      matchEnd: draft.matchEnd,
      occurrenceIndex: countOccurrencesBefore(paragraph.originalText, valueText, draft.matchStart),
    };
  }

  if (existingCandidate) {
    return {
      valueText: existingCandidate.valueText,
      matchStart: existingCandidate.matchStart,
      matchEnd: existingCandidate.matchEnd,
      occurrenceIndex: existingCandidate.occurrenceIndex,
    };
  }

  const valueText = draft.sourceText?.trim() ?? '';
  if (!valueText) {
    throw new Error(`变量 ${draft.key} 缺少原文片段`);
  }

  const matches = findAllOccurrences(paragraph.originalText, valueText);
  if (matches.length === 0) {
    throw new Error(`没有在段落中找到变量 ${draft.key} 对应的原文片段`);
  }
  if (matches.length > 1) {
    throw new Error(`变量 ${draft.key} 的原文片段在段落中出现多次，请在页面上重新框选一次`);
  }

  return {
    valueText,
    matchStart: matches[0],
    matchEnd: matches[0] + valueText.length,
    occurrenceIndex: 0,
  };
}

function findAllOccurrences(text: string, valueText: string): number[] {
  const matches: number[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const foundIndex = text.indexOf(valueText, searchIndex);
    if (foundIndex < 0) {
      break;
    }
    matches.push(foundIndex);
    searchIndex = foundIndex + Math.max(1, valueText.length);
  }

  return matches;
}

function countOccurrencesBefore(text: string, valueText: string, startIndex: number): number {
  return findAllOccurrences(text, valueText).filter((index) => index < startIndex).length;
}

function toTemplateSummary(row: TemplateRow): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    periodType: row.period_type as TemplateSummary['periodType'],
    sourceDocPath: row.source_doc_path,
    variableCount: Number(row.variable_count ?? 0),
    candidateCount: Number(row.candidate_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toParagraph(row: ParagraphRow): TemplateParagraph {
  return {
    id: row.id,
    templateId: row.template_id,
    order: row.paragraph_order,
    originalText: row.original_text,
    templateText: row.template_text,
    inTable: Boolean(row.in_table),
    tableId: row.table_id,
    tableRow: row.table_row,
    tableCol: row.table_col,
    tableCols: row.table_cols,
    isCustomized: Boolean(row.is_customized),
  };
}

function shouldAutoRenameTemplate(name: string): boolean {
  return !name.trim() || /^新建模板(?:\s*\d+)?$/.test(name.trim());
}

function extractDocumentTitle(paragraphs: Array<Omit<TemplateParagraph, 'templateId'>>): string {
  const candidate = paragraphs.find((paragraph) => !paragraph.inTable && paragraph.originalText.trim());
  if (!candidate) {
    return '';
  }

  return candidate.originalText.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function toCandidate(row: CandidateRow, paragraphMap: Map<string, TemplateParagraph>): TemplateCandidate {
  return {
    id: row.id,
    templateId: row.template_id,
    paragraphId: row.paragraph_id,
    paragraphText: paragraphMap.get(row.paragraph_id)?.originalText ?? '',
    valueText: row.value_text,
    matchStart: row.match_start,
    matchEnd: row.match_end,
    occurrenceIndex: row.occurrence_index,
    kind: row.candidate_kind as TemplateCandidate['kind'],
    labelHint: row.label_hint,
  };
}

function toVariable(row: VariableRow): TemplateVariable {
  return {
    id: row.id,
    templateId: row.template_id,
    candidateId: row.candidate_id,
    paragraphId: row.paragraph_id,
    key: row.variable_key,
    label: row.label,
    jsonPath: row.json_path,
    sourceText: row.source_text,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConnector(row: ConnectorRow): ConnectorConfig {
  return {
    templateId: row.template_id,
    mode: row.mode as ConnectorConfig['mode'],
    enabled: Boolean(row.enabled),
    method: row.method,
    url: row.url,
    headersText: row.headers_text,
    queryText: row.query_text,
    bodyText: row.body_text,
    responsePath: row.response_path,
    timeoutMs: row.timeout_ms,
    cacheTtlSeconds: row.cache_ttl_seconds,
    updatedAt: row.updated_at,
  };
}

function toSnapshot(row: SnapshotRow): PeriodSnapshot {
  return {
    id: row.id,
    templateId: row.template_id,
    periodKey: row.period_key,
    periodLabel: row.period_label,
    payload: JSON.parse(row.payload_json),
    sourceKind: row.source_kind as SnapshotSourceKind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
