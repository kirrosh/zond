/** Concatenate baseUrl and path, stripping any trailing slashes from base. */
export function joinBaseAndPath(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export type QueryValue = string | number | boolean;

/** Build a URL from base + path with an optional query record. Values are
 *  coerced to strings via String(); URL-encoding is delegated to
 *  URLSearchParams. */
export function buildUrl(
  baseUrl: string | undefined,
  path: string,
  query?: Record<string, QueryValue>,
): string {
  let url = joinBaseAndPath(baseUrl, path);
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) params.append(k, String(v));
    url += `?${params.toString()}`;
  }
  return url;
}
