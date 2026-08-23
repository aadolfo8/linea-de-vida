export const apiOrigin = (apiUrl: string) => apiUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');

/** Resolves API-provided media paths against the API origin exactly once. */
export function mediaUrl(apiUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;

  const origin = apiOrigin(apiUrl);
  if (/^https?:\/\//i.test(origin)) return new URL(path, `${origin}/`).toString();
  if (path.startsWith('/')) return path;

  const relativeOrigin = origin ? `/${origin.replace(/^\/+|\/+$/g, '')}` : '';
  return `${relativeOrigin}/${path}`;
}
