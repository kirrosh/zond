/** Case-insensitive check whether a header is already present in the map. */
export function hasHeaderCI(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}
