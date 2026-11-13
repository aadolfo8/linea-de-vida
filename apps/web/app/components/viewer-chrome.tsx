import type { RefObject } from 'react';
import { api } from '../../lib/api';
import { mediaUrl, thumbnailVariantUrl } from '../../lib/media';
import { photoDateLabel, type TimelinePhoto } from './timeline-model';
import type { Shown } from './viewer-image';

type KeepVisible = { onPointerEnter: () => void; onPointerLeave: () => void };

/** Loading, fallback, error and "load more" notices, kept outside the zoomed frame. */
export function ViewerNotes({
  shown,
  photo,
  isDownloadOnly,
  loadingMore,
  loadMoreError,
  keepVisible,
  onRetryImage,
  onRetryMore,
}: {
  shown: Shown;
  photo: TimelinePhoto;
  isDownloadOnly: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  keepVisible: KeepVisible;
  onRetryImage: () => void;
  onRetryMore: () => void;
}) {
  return (
    <div className="pv-notes">
      {shown.status === 'loading' && (
        <p className="pv-note" role="status" aria-live="polite">
          {shown.variant === 'original'
            ? 'Cargando fotografía en alta calidad…'
            : 'Cargando fotografía…'}
        </p>
      )}
      {shown.status === 'ready' && shown.fallback && (
        <p className="pv-note" role="status" aria-live="polite">
          El original no se pudo cargar; se muestra la miniatura.
        </p>
      )}
      {shown.status === 'error' && (
        <div className="pv-note" role="alert">
          <p>No se pudo cargar la fotografía.</p>
          <button type="button" onClick={onRetryImage}>
            Reintentar miniatura
          </button>
        </div>
      )}
      {isDownloadOnly && (
        <p className="pv-note pv-ui" {...keepVisible}>
          <span>Este formato se muestra con una vista previa.</span>
          <a href={mediaUrl(api, `/v1/photos/${photo.id}/content`)}>Descargar original</a>
        </p>
      )}
      {loadingMore && (
        <p className="pv-note" role="status" aria-live="polite">
          Cargando más fotografías…
        </p>
      )}
      {loadMoreError && (
        <p className="pv-note pv-ui" {...keepVisible}>
          <button type="button" onClick={onRetryMore}>
            Reintentar carga
          </button>
        </p>
      )}
    </div>
  );
}

/** The film strip with every loaded photo; the current one is the only tab stop. */
export function ViewerStrip({
  stripRef,
  photos,
  index,
  keepVisible,
  onSelect,
}: {
  stripRef: RefObject<HTMLElement | null>;
  photos: TimelinePhoto[];
  index: number;
  keepVisible: KeepVisible;
  onSelect: (next: number, step: -1 | 1) => void;
}) {
  return (
    <nav ref={stripRef} className="pv-strip pv-ui" aria-label="Fotos" {...keepVisible}>
      {photos.map((photo, photoIndex) => (
        <button
          key={photo.id}
          type="button"
          aria-label={`Foto ${photoIndex + 1}: ${photoDateLabel(photo)}`}
          aria-current={photoIndex === index ? 'true' : undefined}
          tabIndex={photoIndex === index ? 0 : -1}
          onClick={() => onSelect(photoIndex, photoIndex > index ? 1 : -1)}
        >
          <img
            src={thumbnailVariantUrl(api, photo.thumbnailUrl, 640)}
            alt=""
            width={photo.dimensions?.width}
            height={photo.dimensions?.height}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </button>
      ))}
    </nav>
  );
}
