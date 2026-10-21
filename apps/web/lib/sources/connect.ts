import { apiJson, settingsEndpoint } from '../api';

/** Starts the read-only Drive consent; the browser leaves for Google and comes back to Ajustes. */
export async function startDriveConnection(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const result = await apiJson<{ available: boolean; authorizationUrl?: string; message?: string }>(
    settingsEndpoint.driveAuthorize,
    { method: 'POST' },
  );
  if (!result.available || !result.authorizationUrl)
    return {
      ok: false,
      message: result.message ?? 'La conexión con Google Drive no está disponible ahora.',
    };
  window.location.assign(result.authorizationUrl);
  return { ok: true };
}
