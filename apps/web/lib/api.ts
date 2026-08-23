export const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

export async function apiCall(path: string, init?: RequestInit) {
  return fetch(`${api}${path}`, { credentials: 'include', ...init });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiCall(path, init);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
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
  folderChildren: (connectionId: string, folderId: string) =>
    `/oauth-connections/${connectionId}/drive/folders/${encodeURIComponent(folderId)}/children`,
  createSource: '/photo-sources',
  sync: (sourceId: string) => `/photo-sources/${sourceId}/sync-runs`,
  run: (runId: string) => `/sync-runs/${runId}`,
  issues: (runId: string) => `/sync-runs/${runId}/issues?limit=30`,
  disconnect: (connectionId: string) => `/oauth-connections/${connectionId}`,
};
