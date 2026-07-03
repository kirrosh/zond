/** Case-insensitive check whether a header is already present in the map.
 *  Deliberately not `new Headers(headers).has(name)` — the WHATWG Headers
 *  constructor throws on values with invalid characters (e.g. raw CRLF),
 *  which real interpolated var values can contain; a plain key scan never
 *  throws on the value shape. */
export function hasHeaderCI(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}
