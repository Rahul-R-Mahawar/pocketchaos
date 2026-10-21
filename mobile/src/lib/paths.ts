/**
 * True for "/a/b" paths with no "." or ".." segments, including percent-encoded and backslash forms, which
 * URL parsers resolve. A URL built as `${prefix}${path}` from such a path cannot climb out of `prefix`.
 */
export function isSafeAbsolutePath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  return pathname.split(/[\\/]/).every((segment) => !/^(?:\.|%2e){1,2}$/i.test(segment));
}
