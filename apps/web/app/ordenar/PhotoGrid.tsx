import { Check, Maximize2 } from 'lucide-react';
import { useEffect, useRef, type MouseEvent } from 'react';
import { api } from '../../lib/api';
import { originLabels, storedShortLabel } from '../../lib/ordering/dates';
import { photoAria } from '../../lib/ordering/copy';
import { thumbnailVariantUrl } from '../../lib/media';
import type { OrderingPhoto } from '../../lib/ordering/types';

/** What a tile says about its date: "ago 2004 · cámara", or "Sin fecha". */
export function chipText(photo: OrderingPhoto) {
  const { value, precision, originKind } = photo.effectiveDate;
  const date = storedShortLabel(value, precision);
  if (!date) return 'Sin fecha';
  const origin = originLabels[originKind];
  return origin ? `${date} · ${origin}` : date;
}

function PhotoTile({
  photo,
  selected,
  leaving,
  onToggle,
  onPeek,
}: {
  photo: OrderingPhoto;
  selected: boolean;
  leaving: boolean;
  onToggle: (id: string, event: MouseEvent) => void;
  onPeek: (id: string) => void;
}) {
  const precision = photo.effectiveDate.precision;
  return (
    <div className={`ord-tile${leaving ? ' leaving' : ''}`} data-photo-id={photo.id}>
      <button
        type="button"
        className="ord-tile-main"
        aria-pressed={selected}
        aria-label={photoAria(photo)}
        onClick={(event) => onToggle(photo.id, event)}
        onDoubleClick={() => onPeek(photo.id)}
      >
        <img
          src={thumbnailVariantUrl(api, photo.thumbnailUrl, 640)}
          alt=""
          loading="lazy"
          draggable={false}
        />
        <span className="ord-check" aria-hidden="true">
          <Check />
        </span>
        <span
          className={`ord-chip${precision === 'UNKNOWN' ? ' none' : precision === 'YEAR' ? ' year' : ''}${photo.effectiveDate.originKind === 'manual' ? ' manual' : ''}`}
        >
          {chipText(photo)}
        </span>
      </button>
      <button
        type="button"
        className="ord-zoom"
        aria-label={`Ver grande ${photo.fileName}`}
        onClick={() => onPeek(photo.id)}
      >
        <Maximize2 aria-hidden="true" />
      </button>
    </div>
  );
}

export function PhotoGrid({
  photos,
  selected,
  leaving,
  onToggle,
  onPeek,
}: {
  photos: readonly OrderingPhoto[];
  selected: ReadonlySet<string>;
  leaving: ReadonlySet<string>;
  onToggle: (id: string, event: MouseEvent) => void;
  onPeek: (id: string) => void;
}) {
  return (
    <div className={`ord-grid${selected.size ? ' selecting' : ''}`} role="group" aria-label="Fotos">
      {photos.map((photo) => (
        <PhotoTile
          key={photo.id}
          photo={photo}
          selected={selected.has(photo.id)}
          leaving={leaving.has(photo.id)}
          onToggle={onToggle}
          onPeek={onPeek}
        />
      ))}
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="ord-grid" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="ord-skeleton" />
      ))}
    </div>
  );
}

/** Loads the next page when the end of the grid scrolls into view; a button is the fallback. */
export function LoadMore({
  loading,
  failed,
  onLoad,
}: {
  loading: boolean;
  failed: boolean;
  onLoad: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;
  const canObserve = typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !canObserve || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadRef.current();
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canObserve, failed, loading]);

  return (
    <div className="ord-more" ref={sentinel}>
      {failed && (
        <p role="alert" className="sp-alert">
          No se pudieron cargar más fotos.
        </p>
      )}
      <button type="button" className="sp-btn" disabled={loading} onClick={onLoad}>
        {loading ? 'Cargando…' : failed ? 'Reintentar' : 'Cargar más fotos'}
      </button>
    </div>
  );
}
