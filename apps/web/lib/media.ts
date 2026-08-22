export const apiOrigin = (apiUrl: string) => apiUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');

/** Resolves API-provided media paths against the API origin exactly once. */
export function mediaUrl(apiUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, `${apiOrigin(apiUrl)}/`).toString();
}
