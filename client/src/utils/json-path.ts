/**
 * Recursively extract all possible JSON paths from an object.
 * e.g. { data: { report: { id: 1 } } } → ['data', 'data.report', 'data.report.id']
 */
export function extractJsonPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return [];
  }

  const paths: string[] = [];
  const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj as Record<string, unknown>);

  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (value && typeof value === 'object') {
      paths.push(...extractJsonPaths(value, path));
    }
  }

  return paths;
}

/**
 * Get a value from an object by dot-separated path.
 */
export function getJsonValue(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
