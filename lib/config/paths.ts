/**
 * Resolves dotted path and array indexed notation (e.g. 'web.results', 'items[0].title')
 * within a JSON-compatible object.
 */
export function resolvePath(obj: any, path: string | null | undefined): any {
  if (!obj || !path) return undefined;

  const parts = path
    .replace(/\[(\w+)\]/g, '.$1') // convert [0] to .0
    .replace(/^\./, '') // strip leading dot
    .split('.');

  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}
