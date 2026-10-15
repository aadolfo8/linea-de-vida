/** Accept either a Drive folder link or its folder identifier. */
export function driveFolderIdFromInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const pathMatch = url.pathname.match(/\/folders\/([^/]+)/i);
    const id = pathMatch?.[1] ?? url.searchParams.get('id');
    return id ? decodeURIComponent(id) : trimmed;
  } catch {
    const match = trimmed.match(/\/folders\/([^/?#]+)/i);
    return (match?.[1] ?? trimmed).trim();
  }
}
