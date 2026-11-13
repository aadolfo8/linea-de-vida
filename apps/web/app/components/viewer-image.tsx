import { api } from '../../lib/api';
import { mediaUrl, thumbnailVariantUrl } from '../../lib/media';
import type { TimelinePhoto } from './timeline-model';

const ORIGINAL_MIME = /^image\/(jpeg|png|webp|gif)$/i;

export function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** What the viewer is currently trying to show for the open photo. */
export type Shown = {
  id: string;
  variant: 'thumbnail' | 'original';
  status: 'loading' | 'ready' | 'error';
  /** Bumped to remount the image when the thumbnail is retried. */
  retry: number;
  /** The original failed and the thumbnail stands in for it. */
  fallback: boolean;
};

export const freshShown = (photo: TimelinePhoto): Shown => ({
  id: photo.id,
  variant: ORIGINAL_MIME.test(photo.mimeType) ? 'original' : 'thumbnail',
  status: 'loading',
  retry: 0,
  fallback: false,
});

/**
 * The photo itself: the thumbnail first, then the original on top once it has loaded. The
 * parent owns the loading, fallback and retry state so its notices stay outside the zoomed frame.
 */
export function ViewerImage({
  photo,
  shown,
  onLoad,
  onError,
}: {
  photo: TimelinePhoto;
  shown: Shown;
  onLoad: (width: number, height: number) => void;
  onError: () => void;
}) {
  const thumbnailSrc = thumbnailVariantUrl(api, photo.thumbnailUrl, 1280);
  const src =
    shown.variant === 'original' ? mediaUrl(api, `/v1/photos/${photo.id}/content`) : thumbnailSrc;

  return (
    <>
      {shown.variant === 'original' && shown.status === 'loading' && (
        <>
          {/* Keep the small preview visible until the full image is ready. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
          <img
            className="pv-under"
            src={thumbnailSrc}
            alt=""
            aria-hidden="true"
            loading="eager"
            draggable={false}
          />
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
      <img
        key={`${photo.id}-${shown.variant}-${shown.retry}`}
        className="pv-img"
        src={src}
        alt={photo.fileName}
        data-source={shown.variant}
        data-ready={shown.status === 'ready'}
        draggable={false}
        onLoad={(event) =>
          onLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
        }
        onError={onError}
      />
    </>
  );
}
