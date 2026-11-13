import { useMemo } from 'react';
import { api } from '../../lib/api';
import { thumbnailVariantUrl } from '../../lib/media';
import { photoAspectRatio, type TimelinePhoto } from '../components/timeline-model';
import { mosaic } from '../components/sky/mosaic';
import { seededRng } from '../components/sky/rng';

/** The virtual canvas the mosaic is laid out in; cells are drawn as percentages of it. */
const WIDTH = 640;
const HEIGHT = 360;
const GAP = 4;

/**
 * The cover as the constellation draws it: the same scattered collage, with the first photo
 * largest and on top. Order matters, so the same photos in another order look different.
 */
export function CoverPreview({
  photos,
  seed,
  label,
}: {
  photos: readonly TimelinePhoto[];
  seed: number;
  label: string;
}) {
  const cells = useMemo(
    () =>
      mosaic(
        photos.map((photo) => ({ photo, aspect: photoAspectRatio(photo) ?? 1.5 })),
        WIDTH,
        HEIGHT,
        seededRng(seed),
        GAP,
      ),
    [photos, seed],
  );

  return (
    <figure className="cov-preview" aria-label={label}>
      {cells.length === 0 ? (
        <p className="cov-preview-empty">Todavía no hay fotos para mostrar.</p>
      ) : (
        cells.map(({ item, x, y, w, h, rotate, z }) => (
          <div
            key={item.photo.id}
            className="cov-cell"
            style={{
              left: `${(x / WIDTH) * 100}%`,
              top: `${(y / HEIGHT) * 100}%`,
              width: `${(w / WIDTH) * 100}%`,
              height: `${(h / HEIGHT) * 100}%`,
              rotate: `${rotate}deg`,
              zIndex: z,
            }}
          >
            <img
              src={thumbnailVariantUrl(api, item.photo.thumbnailUrl, 640)}
              alt=""
              loading="lazy"
              draggable={false}
            />
          </div>
        ))
      )}
    </figure>
  );
}
