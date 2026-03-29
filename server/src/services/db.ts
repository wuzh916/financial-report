import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'financial-report.db');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    period_type TEXT NOT NULL,
    source_doc_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS template_paragraphs (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    paragraph_order INTEGER NOT NULL,
    original_text TEXT NOT NULL,
    template_text TEXT NOT NULL,
    in_table INTEGER NOT NULL DEFAULT 0,
    table_id TEXT,
    table_row INTEGER,
    table_col INTEGER,
    table_cols INTEGER,
    is_customized INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS template_candidates (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    paragraph_id TEXT NOT NULL,
    value_text TEXT NOT NULL,
    match_start INTEGER NOT NULL,
    match_end INTEGER NOT NULL,
    occurrence_index INTEGER NOT NULL,
    candidate_kind TEXT NOT NULL,
    label_hint TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (paragraph_id) REFERENCES template_paragraphs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS template_variables (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    candidate_id TEXT,
    paragraph_id TEXT,
    variable_key TEXT NOT NULL,
    label TEXT NOT NULL,
    json_path TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES template_candidates(id) ON DELETE SET NULL,
    FOREIGN KEY (paragraph_id) REFERENCES template_paragraphs(id) ON DELETE SET NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_template_variable_key
    ON template_variables(template_id, variable_key);

  CREATE TABLE IF NOT EXISTS template_connectors (
    template_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'mock',
    enabled INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'GET',
    url TEXT NOT NULL DEFAULT '',
    headers_text TEXT NOT NULL DEFAULT '',
    query_text TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    response_path TEXT NOT NULL DEFAULT '',
    timeout_ms INTEGER NOT NULL DEFAULT 15000,
    cache_ttl_seconds INTEGER NOT NULL DEFAULT 21600,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS period_snapshots (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    period_label TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
      UNIQUE (template_id, period_key, source_kind),
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
    );

  CREATE TABLE IF NOT EXISTS report_records (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    period_label TEXT NOT NULL,
    source TEXT NOT NULL,
    last_action TEXT NOT NULL,
    preview_count INTEGER NOT NULL DEFAULT 0,
    export_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (template_id, period_key),
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );
`);

type TableInfoRow = {
  name: string;
};

function hasColumn(table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]).some((row) => row.name === column);
}

if (!hasColumn('template_paragraphs', 'table_id')) {
  db.exec(`ALTER TABLE template_paragraphs ADD COLUMN table_id TEXT;`);
}

if (!hasColumn('template_paragraphs', 'table_row')) {
  db.exec(`ALTER TABLE template_paragraphs ADD COLUMN table_row INTEGER;`);
}

if (!hasColumn('template_paragraphs', 'table_col')) {
  db.exec(`ALTER TABLE template_paragraphs ADD COLUMN table_col INTEGER;`);
}

if (!hasColumn('template_paragraphs', 'table_cols')) {
  db.exec(`ALTER TABLE template_paragraphs ADD COLUMN table_cols INTEGER;`);
}

const snapshotTableSql = (
  db
    .prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'period_snapshots'
    `)
    .get() as { sql?: string } | undefined
)?.sql;

if (snapshotTableSql && !snapshotTableSql.includes('UNIQUE (template_id, period_key, source_kind)')) {
  db.exec(`
    ALTER TABLE period_snapshots RENAME TO period_snapshots_legacy;

    CREATE TABLE period_snapshots (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      period_label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (template_id, period_key, source_kind),
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
    );

    INSERT INTO period_snapshots (
      id, template_id, period_key, period_label, payload_json, source_kind, created_at, updated_at
    )
    SELECT
      id, template_id, period_key, period_label, payload_json, source_kind, created_at, updated_at
    FROM period_snapshots_legacy;

    DROP TABLE period_snapshots_legacy;
  `);
}
