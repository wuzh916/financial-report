import JSZip from 'jszip';
import { readFile } from 'fs/promises';
import { CandidateKind, TemplateCandidate, TemplateParagraph, TemplateVariable } from '../types.js';

type ParsedParagraph = Pick<
  TemplateParagraph,
  | 'id'
  | 'order'
  | 'originalText'
  | 'templateText'
  | 'inTable'
  | 'tableId'
  | 'tableRow'
  | 'tableCol'
  | 'tableCols'
  | 'isCustomized'
>;

type TableParagraphMeta = {
  start: number;
  end: number;
  tableId: string;
  tableRow: number;
  tableCol: number;
  tableCols: number;
};

const CANDIDATE_PATTERNS: Array<{ kind: CandidateKind; regex: RegExp }> = [
  { kind: 'placeholder', regex: /\{\{\s*[^{}\r\n]{1,64}\s*\}\}/g },
  { kind: 'placeholder', regex: /\$\{\s*[^{}\r\n]{1,64}\s*\}/g },
  { kind: 'placeholder', regex: /【[^【】\r\n]{1,64}】/g },
  { kind: 'date', regex: /20\d{2}年\d{1,2}月\d{1,2}日/g },
  { kind: 'date', regex: /20\d{2}[/-]\d{1,2}[/-]\d{1,2}/g },
  { kind: 'quarter', regex: /20\d{2}(?:年)?(?:第?[一二三四1-4]季度|Q[1-4])/g },
  { kind: 'month', regex: /20\d{2}年\d{1,2}月/g },
  { kind: 'year', regex: /20\d{2}(?:年度|年)/g },
  { kind: 'percent', regex: /[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:%+|个百分点)/g },
  { kind: 'number', regex: /\([-+]?\d+(?:,\d{3})*(?:\.\d+)?\)/g },
  { kind: 'number', regex: /[-+]?\d+(?:,\d{3})*(?:\.\d+)?/g },
];

export async function analyzeSampleDocument(
  templateId: string,
  filePath: string
): Promise<{
  paragraphs: ParsedParagraph[];
  candidates: TemplateCandidate[];
}> {
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) {
    throw new Error('Invalid docx: missing word/document.xml');
  }

  const tableParagraphMetas = getTableParagraphMetas(xml);
  const paragraphs: ParsedParagraph[] = [];

  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let paragraphMatch: RegExpExecArray | null;
  let paragraphOrder = 0;
  let tableMetaIndex = 0;

  while ((paragraphMatch = paragraphRegex.exec(xml)) !== null) {
    paragraphOrder += 1;
    const paragraphXml = paragraphMatch[0];
    const paragraphId = `${templateId}:p-${paragraphOrder}`;
    const paragraphStart = paragraphMatch.index;

    while (
      tableMetaIndex < tableParagraphMetas.length &&
      paragraphStart >= tableParagraphMetas[tableMetaIndex].end
    ) {
      tableMetaIndex += 1;
    }

    const tableMeta =
      tableMetaIndex < tableParagraphMetas.length &&
      paragraphStart >= tableParagraphMetas[tableMetaIndex].start &&
      paragraphStart < tableParagraphMetas[tableMetaIndex].end
        ? tableParagraphMetas[tableMetaIndex]
        : null;

    const originalText = getParagraphText(paragraphXml);
    paragraphs.push({
      id: paragraphId,
      order: paragraphOrder,
      originalText,
      templateText: originalText,
      inTable: Boolean(tableMeta),
      tableId: tableMeta?.tableId ?? null,
      tableRow: tableMeta?.tableRow ?? null,
      tableCol: tableMeta?.tableCol ?? null,
      tableCols: tableMeta?.tableCols ?? null,
      isCustomized: false,
    });
  }

  const candidates = paragraphs.flatMap((paragraph) =>
    detectCandidates(templateId, paragraph)
  );

  return { paragraphs, candidates };
}

export async function getDocxHtml(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await readFile(filePath);
  return getDocxHtmlFromBuffer(buffer);
}

export async function getDocxHtmlFromBuffer(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({ buffer });
  return result.value;
}

export async function renderTemplateBuffer(
  filePath: string,
  paragraphs: Array<Pick<TemplateParagraph, 'id' | 'templateText'>>,
  values: Record<string, string>
): Promise<Buffer> {
  const buffer = await readFile(filePath);
  return renderTemplateBufferFromBuffer(buffer, paragraphs, values);
}

export async function renderTemplateBufferFromBuffer(
  buffer: Buffer,
  paragraphs: Array<Pick<TemplateParagraph, 'id' | 'templateText'>>,
  values: Record<string, string>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) {
    throw new Error('Invalid docx: missing word/document.xml');
  }

  const paragraphMap = new Map(
    paragraphs.map((paragraph) => [toDocumentParagraphKey(paragraph.id), paragraph.templateText])
  );
  let paragraphOrder = 0;
  const xml = (await xmlFile.async('string')).replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    paragraphOrder += 1;
    const paragraphId = `p-${paragraphOrder}`;
    const templateText = paragraphMap.get(paragraphId);
    if (templateText === undefined) {
      return paragraphXml;
    }

    const finalText = applyValues(templateText, values);
    return rebuildParagraph(paragraphXml, finalText);
  });

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function buildParagraphTemplates(
  paragraphs: TemplateParagraph[],
  candidates: TemplateCandidate[],
  variables: TemplateVariable[]
): TemplateParagraph[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const byParagraph = new Map<string, TemplateVariable[]>();

  for (const variable of variables) {
    const paragraphId = variable.paragraphId ?? candidateById.get(variable.candidateId ?? '')?.paragraphId;
    if (!paragraphId) {
      continue;
    }
    const list = byParagraph.get(paragraphId) ?? [];
    list.push(variable);
    byParagraph.set(paragraphId, list);
  }

  return paragraphs.map((paragraph) => {
    if (paragraph.isCustomized) {
      return paragraph;
    }

    const paragraphVariables = byParagraph.get(paragraph.id) ?? [];
    if (paragraphVariables.length === 0) {
      return { ...paragraph, templateText: paragraph.originalText };
    }

    const operations = paragraphVariables
      .map((variable) => {
        const candidate = variable.candidateId ? candidateById.get(variable.candidateId) : undefined;
        if (!candidate) {
          return null;
        }
        return {
          variable,
          candidate,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.candidate.matchStart - a.candidate.matchStart);

    let templateText = paragraph.originalText;
    for (const { variable, candidate } of operations) {
      templateText =
        templateText.slice(0, candidate.matchStart) +
        `{{${variable.key}}}` +
        templateText.slice(candidate.matchEnd);
    }

    return { ...paragraph, templateText };
  });
}

function detectCandidates(templateId: string, paragraph: ParsedParagraph): TemplateCandidate[] {
  if (!paragraph.originalText.trim()) {
    return [];
  }

  const matches: Array<{
    kind: CandidateKind;
    valueText: string;
    matchStart: number;
    matchEnd: number;
  }> = [];

  for (const { kind, regex } of CANDIDATE_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(paragraph.originalText)) !== null) {
      const valueText = match[0];
      if (kind === 'number' && shouldSkipPlainNumber(valueText)) {
        continue;
      }
      const next = {
        kind,
        valueText,
        matchStart: match.index,
        matchEnd: match.index + valueText.length,
      };
      if (matches.some((item) => rangesOverlap(item.matchStart, item.matchEnd, next.matchStart, next.matchEnd))) {
        continue;
      }
      matches.push(next);
    }
  }

  const occurrenceMap = new Map<string, number>();

  return matches
    .sort((a, b) => a.matchStart - b.matchStart)
    .map((match, index) => {
      const occurrenceKey = `${paragraph.id}:${match.valueText}`;
      const occurrenceIndex = occurrenceMap.get(occurrenceKey) ?? 0;
      occurrenceMap.set(occurrenceKey, occurrenceIndex + 1);

      return {
        id: `${paragraph.id}:cand:${index + 1}`,
        templateId,
        paragraphId: paragraph.id,
        paragraphText: paragraph.originalText,
        valueText: match.valueText,
        matchStart: match.matchStart,
        matchEnd: match.matchEnd,
        occurrenceIndex,
        kind: match.kind,
        labelHint: buildLabelHint(paragraph.originalText, match.matchStart, match.matchEnd, match.kind, match.valueText),
      };
    });
}

function getTableParagraphMetas(xml: string): TableParagraphMeta[] {
  const metas: TableParagraphMeta[] = [];
  const tableRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
  let tableMatch: RegExpExecArray | null;
  let tableIndex = 0;

  while ((tableMatch = tableRegex.exec(xml)) !== null) {
    tableIndex += 1;
    const tableXml = tableMatch[0];
    const tableStart = tableMatch.index;
    const tableId = `table-${tableIndex}`;
    const rowRegex = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    let rowMatch: RegExpExecArray | null;
    let rowIndex = 0;

    while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
      rowIndex += 1;
      const rowXml = rowMatch[0];
      const rowStart = tableStart + rowMatch.index;
      const cellRegex = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
      const cellMatches = Array.from(rowXml.matchAll(cellRegex));
      const rowColumns = cellMatches.length;

      cellMatches.forEach((cellMatch, cellIndex) => {
        if (cellMatch.index === undefined) {
          return;
        }

        const cellXml = cellMatch[0];
        const cellStart = rowStart + cellMatch.index;
        const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
        let paragraphMatch: RegExpExecArray | null;

        while ((paragraphMatch = paragraphRegex.exec(cellXml)) !== null) {
          metas.push({
            start: cellStart + paragraphMatch.index,
            end: cellStart + paragraphMatch.index + paragraphMatch[0].length,
            tableId,
            tableRow: rowIndex,
            tableCol: cellIndex + 1,
            tableCols: rowColumns,
          });
        }
      });
    }
  }

  return metas.sort((left, right) => left.start - right.start);
}

function getParagraphText(paragraphXml: string): string {
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const textChunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(paragraphXml)) !== null) {
    textChunks.push(decodeXml(match[1]));
  }
  return textChunks.join('');
}

function rebuildParagraph(paragraphXml: string, text: string): string {
  const paragraphProperties = paragraphXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const runProperties = paragraphXml.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
  return `<w:p>${paragraphProperties}${buildRuns(text, runProperties)}</w:p>`;
}

function buildRuns(text: string, runProperties: string): string {
  const lines = text.split(/\r?\n/);
  const runs: string[] = [];

  lines.forEach((line, index) => {
    const escapedLine = escapeXml(line);
    runs.push(`<w:r>${runProperties}<w:t xml:space="preserve">${escapedLine}</w:t></w:r>`);
    if (index < lines.length - 1) {
      runs.push(`<w:r>${runProperties}<w:br/></w:r>`);
    }
  });

  if (runs.length === 0) {
    runs.push(`<w:r>${runProperties}<w:t xml:space="preserve"></w:t></w:r>`);
  }

  return runs.join('');
}

function toDocumentParagraphKey(paragraphId: string): string {
  const match = paragraphId.match(/p-\d+$/);
  return match?.[0] ?? paragraphId;
}

function applyValues(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_fullMatch, key: string) => values[key] ?? `{{${key}}}`);
}

function buildLabelHint(
  text: string,
  start: number,
  end: number,
  kind?: CandidateKind,
  valueText?: string
): string {
  if (kind === 'placeholder' && valueText) {
    return extractPlaceholderLabel(valueText);
  }

  const before = text.slice(0, start).split(/[，。；：\s]/).filter(Boolean).at(-1) ?? '';
  const after = text.slice(end).split(/[，。；：\s]/).find(Boolean) ?? '';
  return `${before}${after}`.trim().slice(-16) || text.slice(Math.max(0, start - 8), Math.min(text.length, end + 8));
}

function extractPlaceholderLabel(valueText: string): string {
  return valueText
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .replace(/^\$\{\s*|\s*\}$/g, '')
    .replace(/^【|】$/g, '')
    .trim();
}

function shouldSkipPlainNumber(valueText: string): boolean {
  const normalized = valueText.replace(/,/g, '');
  if (normalized.includes('.')) {
    return false;
  }
  return normalized.length < 3;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
