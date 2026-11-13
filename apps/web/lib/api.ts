/** Same origin by default: Next forwards `/v1` to the API in development and the proxy does in production. */
export const api = process.env.NEXT_PUBLIC_API_URL ?? '/v1';

export async function apiCall(path: string, init?: RequestInit) {
  return fetch(`${api}${path}`, { credentials: 'include', ...init });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiCall(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const retryAfter = response.headers.get('Retry-After');
    throw new ApiError(
      response.status,
      typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
      typeof body.message === 'string' ? body.message : `Request failed: ${response.status}`,
      typeof body.requestId === 'string' ? body.requestId : response.headers.get('X-Request-Id'),
      retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : null,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** The `RequestInit` of a JSON request. */
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const isUnauthenticated = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

/** An expired session sends the person back to the start instead of leaving a dead screen. */
export function signOutIfExpired(error: unknown) {
  if (isUnauthenticated(error)) window.location.replace('/');
}

export type Connection = { id: string; provider: string; status: string };
export type Session = {
  user: { displayName?: string | null; email?: string | null; connections?: Connection[] };
  driveConfigured: boolean;
  developmentMode: boolean;
};

export type Source = {
  id: string;
  name: string;
  driveFolderId: string;
  type: 'GENERIC' | 'GOOGLE_TAKEOUT';
  status: string;
};

export function activeDriveConnection(session: Session | null) {
  return (
    session?.user.connections?.find((connection) => connection.provider === 'google-drive') ?? null
  );
}

export function routeForSession(hasSession: boolean) {
  return hasSession ? '/timeline' : '/';
}

export const settingsEndpoint = {
  driveAuthorize: '/oauth/google/drive/authorize',
  folderChildren: (connectionId: string, folderId: string) =>
    `/oauth-connections/${connectionId}/drive/folders/${encodeURIComponent(folderId)}/children`,
  createSource: '/photo-sources',
  removeSource: (sourceId: string) => `/photo-sources/${encodeURIComponent(sourceId)}`,
  sync: (sourceId: string) => `/photo-sources/${sourceId}/sync-runs`,
  run: (runId: string) => `/sync-runs/${runId}`,
  disconnect: (connectionId: string) => `/oauth-connections/${connectionId}`,
};
