export const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

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

export const isUnauthenticated = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

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
  folderChildren: (connectionId: string, folderId: string) =>
    `/oauth-connections/${connectionId}/drive/folders/${encodeURIComponent(folderId)}/children`,
  createSource: '/photo-sources',
  sync: (sourceId: string) => `/photo-sources/${sourceId}/sync-runs`,
  run: (runId: string) => `/sync-runs/${runId}`,
  issues: (runId: string) => `/sync-runs/${runId}/issues?limit=30`,
  history: (sourceId: string, cursor?: string) =>
    `/photo-sources/${sourceId}/sync-runs?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  disconnect: (connectionId: string) => `/oauth-connections/${connectionId}`,
};
