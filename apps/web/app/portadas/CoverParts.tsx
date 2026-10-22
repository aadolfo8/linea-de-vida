'use client';

import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { api } from '../../lib/api';
import { thumbnailVariantUrl } from '../../lib/media';
import { photoDateLabel, type TimelinePhoto } from '../components/timeline-model';

const photoLabel = (photo: TimelinePhoto) => `${photo.fileName}, ${photoDateLabel(photo)}`;

/** The photos a cover can be made of. A chosen one shows the place it holds on the cover. */
export function CandidateGrid({
  photos,
  chosen,
  onToggle,
}: {
  photos: readonly TimelinePhoto[];
  chosen: readonly string[];
  onToggle: (photo: TimelinePhoto) => void;
}) {
  return (
    <div className="ord-grid selecting cov-grid" role="group" aria-label="Fotos que puedes elegir">
      {photos.map((photo) => {
        const position = chosen.indexOf(photo.id) + 1;
        return (
          <div key={photo.id} className="ord-tile" data-photo-id={photo.id}>
            <button
              type="button"
              className="ord-tile-main"
              aria-pressed={position > 0}
              aria-label={
                position > 0
                  ? `${photoLabel(photo)}, elegida en el puesto ${position}`
                  : photoLabel(photo)
              }
              onClick={() => onToggle(photo)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private proxy URLs, sized by the API */}
              <img
                src={thumbnailVariantUrl(api, photo.thumbnailUrl, 640)}
                alt=""
                loading="lazy"
                draggable={false}
              />
              <span className="cov-badge" aria-hidden="true">
                {position > 0 ? position : ''}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The chosen photos in order, each with the way to move it earlier, later or out. */
export function ChosenStrip({
  photos,
  limit,
  busy,
  onMove,
  onRemove,
}: {
  photos: readonly TimelinePhoto[];
  limit: number;
  busy: boolean;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  if (photos.length === 0)
    return (
      <p className="ord-hint cov-strip-empty">
        Aún no has elegido ninguna: la portada se completa sola. Toca una foto para añadirla.
      </p>
    );
  return (
    <div>
      <ol className="cov-strip" aria-label="Fotos elegidas, en orden">
        {photos.map((photo, index) => (
          <li key={photo.id} data-chosen-id={photo.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private proxy URLs, sized by the API */}
            <img
              src={thumbnailVariantUrl(api, photo.thumbnailUrl, 640)}
              alt=""
              loading="lazy"
              draggable={false}
            />
            <span className="cov-num" aria-hidden="true">
              {index + 1}
            </span>
            <span className="cov-controls">
              <button
                type="button"
                data-act="earlier"
                aria-label={`Mover antes la foto ${index + 1}: ${photo.fileName}`}
                disabled={busy || index === 0}
                onClick={() => onMove(photo.id, -1)}
              >
                <ArrowLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                data-act="later"
                aria-label={`Mover después la foto ${index + 1}: ${photo.fileName}`}
                disabled={busy || index === photos.length - 1}
                onClick={() => onMove(photo.id, 1)}
              >
                <ArrowRight aria-hidden="true" />
              </button>
              <button
                type="button"
                data-act="remove"
                aria-label={`Quitar la foto ${index + 1}: ${photo.fileName}`}
                disabled={busy}
                onClick={() => onRemove(photo.id)}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {photos.length < limit && (
        <p className="ord-hint">
          {limit - photos.length === 1
            ? 'La que falta se completa sola.'
            : `Las ${limit - photos.length} que faltan se completan solas.`}
        </p>
      )}
    </div>
  );
}
