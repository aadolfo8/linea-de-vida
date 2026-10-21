'use client';

import './constellation.css';

export function SkyLoading({ label }: { label: string }) {
  return (
    <div className="sky-state" aria-busy="true">
      <p className="sky-wait" role="status">
        {label}
      </p>
    </div>
  );
}

export function SkyError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sky-state" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function SkyEmptyArchive() {
  return (
    <div className="sky-state">
      <h2>Tu archivo todavía no tiene fechas disponibles.</h2>
      <p>Añade una carpeta o revisa las fotografías que todavía no tienen fecha.</p>
      <div className="sky-state-actions">
        <a href="/ordenar">Ir a Ordenar</a>
        <a href="/ordenar?pile=undated">Fotografías sin fecha</a>
      </div>
    </div>
  );
}
