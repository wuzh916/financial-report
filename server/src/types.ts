export type PeriodType = 'annual' | 'quarterly' | 'monthly';

export type CandidateKind =
  | 'number'
  | 'percent'
  | 'date'
  | 'year'
  | 'quarter'
  | 'month'
  | 'placeholder'
  | 'manual';

export type ConnectorMode = 'mock' | 'http';

export type SnapshotSourceKind = 'mock' | 'fetched';

export type RenderSource = 'cache' | 'mock' | 'live';
export type ReportAction = 'preview' | 'export';

export interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  periodType: PeriodType;
  sourceDocPath: string;
  sourceDocAvailable: boolean;
  variableCount: number;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateParagraph {
  id: string;
  templateId: string;
  order: number;
  originalText: string;
  templateText: string;
  inTable: boolean;
  tableId: string | null;
  tableRow: number | null;
  tableCol: number | null;
  tableCols: number | null;
  isCustomized: boolean;
}

export interface TemplateCandidate {
  id: string;
  templateId: string;
  paragraphId: string;
  paragraphText: string;
  valueText: string;
  matchStart: number;
  matchEnd: number;
  occurrenceIndex: number;
  kind: CandidateKind;
  labelHint: string;
}

export interface TemplateVariable {
  id: string;
  templateId: string;
  candidateId: string | null;
  paragraphId: string | null;
  key: string;
  label: string;
  jsonPath: string;
  sourceText: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorConfig {
  templateId: string;
  mode: ConnectorMode;
  enabled: boolean;
  method: string;
  url: string;
  headersText: string;
  queryText: string;
  bodyText: string;
  responsePath: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  updatedAt: string;
}

export interface PeriodSnapshot {
  id: string;
  templateId: string;
  periodKey: string;
  periodLabel: string;
  payload: Record<string, unknown>;
  sourceKind: SnapshotSourceKind;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  paragraphs: TemplateParagraph[];
  candidates: TemplateCandidate[];
  variables: TemplateVariable[];
  connector: ConnectorConfig;
  snapshots: PeriodSnapshot[];
}

export interface VariableDraft {
  id?: string;
  candidateId?: string | null;
  paragraphId?: string | null;
  key: string;
  label: string;
  jsonPath: string;
  sourceText?: string;
  matchStart?: number | null;
  matchEnd?: number | null;
  candidateKind?: CandidateKind | null;
}

export interface RenderResponse {
  html: string;
  mapping: Record<string, string>;
  payload: Record<string, unknown>;
  source: RenderSource;
  cachedAt: string | null;
  periodKey: string;
  periodLabel: string;
}

export interface ReportRecord {
  id: string;
  templateId: string;
  templateName: string;
  periodKey: string;
  periodLabel: string;
  source: RenderSource;
  lastAction: ReportAction;
  previewCount: number;
  exportCount: number;
  createdAt: string;
  updatedAt: string;
}
