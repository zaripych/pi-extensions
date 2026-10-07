/** Case- and separator-insensitive exact identifier equality — not a
 * prefix or fuzzy match. */
export function normalizeModelId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, '')
}
