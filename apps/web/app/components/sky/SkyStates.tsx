import './constellation.css';

const SKELETON = {
  /** The years depth: several constellations, each a numeral outline over a few tiles. */
  years: [3, 4, 3],
  /** A year or month depth: fewer, denser groups. */
  depth: [5, 4],
} as const;

/**
 * Loading state of a depth: a skeleton in the sky's look (decorative, hidden from assistive
 * technology) plus the status line that is read out.
 */
export function SkyLoading({
  label,
  variant = 'depth',
}: {
  label: string;
  variant?: keyof typeof SKELETON;
}) {
  return (
    <div className="sky-state" aria-busy="true">
      <div className="sky-skeleton" data-variant={variant} aria-hidden="true">
        {SKELETON[variant].map((tiles, group) => (
          <div key={group} className="sky-skel-grp">
            <i className="sky-skel-num" />
            <span className="sky-skel-tiles">
              {Array.from({ length: tiles }, (_, tile) => (
                <i key={tile} className="sky-skel-tile" />
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="sky-wait" role="status" aria-live="polite">
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
