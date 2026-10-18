/**
 * Canonical form used both when storing an endpoint path and when matching a proxied request:
 * leading slash, no duplicate slashes, no trailing slash (except the root "/").
 */
export function normalizeEndpointPath(rawPath: string): string {
  const collapsed = `/${rawPath}`.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}
