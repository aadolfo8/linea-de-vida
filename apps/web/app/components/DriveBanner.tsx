'use client';

import { useState } from 'react';
import { apiErrorCopy } from '../../lib/sources/errors';
import { startDriveConnection } from '../../lib/sources/connect';

/** One clear notice, on Ordenar and on Ajustes, when Drive is not connected. */
export function DriveBanner({ connected }: { connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (connected) return null;

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await startDriveConnection();
      if (!result.ok) setError(result.message);
    } catch (failure) {
      setError(
        apiErrorCopy(failure, 'No pudimos iniciar la conexión con Drive. Inténtalo de nuevo.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sp-banner warn" aria-label="Drive desconectado">
      <div className="text">
        <b>Drive no está conectado.</b>
        <small>
          Tus fotos ya guardadas siguen aquí, pero no podemos buscar fotos nuevas. La conexión es de
          solo lectura: Línea de vida nunca cambia nada en tu Drive.
        </small>
        {error && <small role="alert">{error}</small>}
      </div>
      <button
        type="button"
        className="sp-btn primary"
        disabled={busy}
        onClick={() => void connect()}
      >
        {busy ? 'Abriendo Google…' : 'Conectar Drive'}
      </button>
    </section>
  );
}
