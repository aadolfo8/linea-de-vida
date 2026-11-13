import { Link } from '../../../lib/link';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { api } from '../../../lib/api';
import { thumbnailVariantUrl } from '../../../lib/media';
import { photoAspectRatio, type TimelinePhoto } from '../timeline-model';
import './constellation.css';
import {
  constellationGeometry,
  type ConstellationGeometry,
  type ConstellationKind,
} from './constellation-layout';
import { mosaic } from './mosaic';
import { clamp, seededRng, smooth } from './rng';
import { isPlainClick } from './SkyChrome';
import { useSky, useSkyFrame, useSkyItem } from './SkyStage';
import { tileImageSettled, trackTileImage } from './tile-loading';

/** Shapes of the stars shown while a group's photos are still on their way. */
const PLACEHOLDER_ASPECTS = [1.5, 0.75, 1.5, 1.33, 0.8, 1.78, 1.5];
/** A group is near while it is within this many viewports ahead of the viewport... */
const NEAR_VIEWPORTS = 1.6;
/** ...or this many behind it. */
const NEAR_BEHIND = 0.6;
/** The scroll counts as settled below this speed (px/ms) for `SETTLE_DWELL` ms. */
const SETTLE_SPEED = 0.35;
const SETTLE_DWELL = 150;
/** The group around the viewport centre gets its photos first. */
const CENTRED_VIEWPORTS = 0.6;
/** Tiles at most this wide (CSS px) are served by the 640 variant even on dense screens. */
const SMALL_TILE = 420;
/** A touch that moves less than this far and ends this fast is a tap, not a scroll. */
const TAP_SLOP = 10;
const TAP_MAX_MS = 300;
/** A touch this soon after the page scrolled only stops the fling, as native lists do. */
const FLING_STOP_MS = 100;
let lastScrollAt = -Infinity;
if (typeof window !== 'undefined')
  window.addEventListener('scroll', (event) => (lastScrollAt = event.timeStamp), {
    passive: true,
  });
/** How big a still-unrevealed placeholder star stays. */
const STAR_SCALE = 0.06;

type Cell = {
  photo: TimelinePhoto | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  z: number;
  /** Reveal delay: tiles nearer the leading edge appear first. */
  lag: number;
};

/** Tiles of photos start as stars; the frame loop grows them into photos as they enter. */
const STAR_STYLE = {
  transform: `scale(${STAR_SCALE})`,
  borderRadius: '50%',
  '--dot': 1,
} as CSSProperties;

/** Placeholders stand for photos still on their way: visible at full size and shimmering. */
const PLACEHOLDER_STYLE = { borderRadius: 6, '--dot': 0 } as CSSProperties;

/**
 * Image sources of a preview tile. The 1280 variant is offered only to tiles big enough to
 * need it: on a 2x phone a small tile would otherwise pick it just because its pixel width is
 * doubled, and previews do not need that sharpness.
 */
export function previewSources(apiBase: string, thumbnailUrl: string, tileWidth: number) {
  const small = thumbnailVariantUrl(apiBase, thumbnailUrl, 640);
  if (tileWidth <= SMALL_TILE) return { src: small };
  return {
    src: small,
    srcSet: `${small} 640w, ${thumbnailVariantUrl(apiBase, thumbnailUrl, 1280)} 1280w`,
    sizes: `${Math.round(tileWidth)}px`,
  };
}

function useCells(
  photos: TimelinePhoto[] | null,
  geometry: ConstellationGeometry,
  seed: number,
  horizontal: boolean,
) {
  return useMemo<Cell[]>(() => {
    const source: { photo: TimelinePhoto | null; aspect: number }[] = photos?.length
      ? photos.map((photo) => ({ photo, aspect: photoAspectRatio(photo) ?? 1.5 }))
      : PLACEHOLDER_ASPECTS.map((aspect) => ({ photo: null, aspect }));
    const rng = seededRng(seed);
    return mosaic(source, geometry.clusterWidth, geometry.clusterHeight, rng, geometry.tileGap).map(
      ({ item, x, y, w, h, rotate, z }) => ({
        photo: item.photo,
        x,
        y,
        w,
        h,
        rotate,
        z,
        lag:
          (horizontal ? x / geometry.clusterWidth : y / geometry.clusterHeight) * 0.5 +
          rng() * 0.25,
      }),
    );
  }, [geometry.clusterHeight, geometry.clusterWidth, geometry.tileGap, horizontal, photos, seed]);
}

/**
 * A year or a month drawn as a constellation. The whole group is one link: the outline
 * numeral, the counts and the mosaic of preview photos all lead into the same destination.
 */
export function Constellation({
  itemKey,
  index,
  count,
  kind,
  seed,
  title,
  meta,
  cta,
  ariaLabel,
  href,
  undated = false,
  photos,
  more,
  afterHeader = false,
  epoch = 0,
  onNear,
  onEnter,
}: {
  itemKey: string;
  index: number;
  count: number;
  kind: ConstellationKind;
  seed: number;
  title: string;
  meta: ReactNode;
  /** Affordance that appears on hover and focus, e.g. "Entrar en". */
  cta: string;
  ariaLabel: string;
  href: string;
  undated?: boolean;
  /** Preview photos; null while they have not arrived (stars are shown instead). */
  photos: TimelinePhoto[] | null;
  /** Photos beyond the previews, shown as "+N más". */
  more: number;
  afterHeader?: boolean;
  /** Changing it (e.g. the archive index was invalidated) lets `onNear` fire again. */
  epoch?: number;
  /**
   * Fires when the group is near the viewport and the scroll has settled for a moment (so a
   * fast flick past many groups requests nothing). It may fire again after the group was left
   * and approached again, or after `epoch` changes; consumers deduplicate.
   */
  onNear?: () => void;
  onEnter: (href: string, cluster: Element | null, title: string) => void;
}) {
  const { engine, viewport, orientation, reduced } = useSky();
  const horizontal = orientation === 'horizontal';
  const geometry = useMemo(
    () => constellationGeometry(kind, viewport, orientation, index, count, { afterHeader }),
    [afterHeader, count, index, kind, orientation, viewport],
  );
  const cells = useCells(photos, geometry, seed, horizontal);
  const { ref, itemRef } = useSkyItem<HTMLAnchorElement>(itemKey);
  const clusterRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const tileRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const near = useRef(onNear);
  const fired = useRef(false);
  const dwell = useRef(0);
  const motion = useRef<{ current: number; time: number } | null>(null);
  const settled = useRef(false);
  const [centred, setCentred] = useState(false);
  const centredNow = useRef(false);
  const touch = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  /** When a touch tap already entered, so the click it produces does not enter twice. */
  const tapped = useRef(0);
  useLayoutEffect(() => {
    near.current = onNear;
  });
  // Previews requested before an invalidation are gone: ask again once the group is near.
  const seenEpoch = useRef(epoch);
  useLayoutEffect(() => {
    if (seenEpoch.current === epoch) return;
    seenEpoch.current = epoch;
    fired.current = false;
    engine.wake();
  }, [engine, epoch]);
  useEffect(() => () => window.clearTimeout(dwell.current), []);
  // New tiles (or a new layout) must be painted at least once even if the track is at rest.
  // The frame loop is what grows stars into photos, and it sleeps while the track rests: wake
  // it, or the photos of a group that just arrived stay stars until the person scrolls.
  useLayoutEffect(() => {
    settled.current = false;
    engine.wake();
  }, [cells, engine]);

  useSkyFrame((frame) => {
    const item = itemRef.current;
    if (!item?.measured) return;
    const last = motion.current;
    motion.current = { current: frame.current, time: frame.time };
    const speed = last
      ? Math.abs(frame.current - last.current) / Math.max(1, frame.time - last.time)
      : 0;
    const isNear =
      item.o - frame.current < NEAR_VIEWPORTS * frame.length &&
      item.o + item.s - frame.current > -NEAR_BEHIND * frame.length;
    if (!isNear) {
      window.clearTimeout(dwell.current);
      dwell.current = 0;
      fired.current = false;
    } else if (!fired.current) {
      if (speed >= SETTLE_SPEED) {
        window.clearTimeout(dwell.current);
        dwell.current = 0;
      } else if (!dwell.current) {
        dwell.current = window.setTimeout(() => {
          dwell.current = 0;
          fired.current = true;
          near.current?.();
        }, SETTLE_DWELL);
      }
    }
    const isCentred =
      Math.abs(item.o + item.s / 2 - (frame.current + frame.length / 2)) <
      CENTRED_VIEWPORTS * frame.length;
    if (isCentred !== centredNow.current) {
      centredNow.current = isCentred;
      setCentred(isCentred);
    }
    if (reduced || (settled.current && !frame.moved)) return;
    settled.current = !frame.moved;
    const base = (1.12 - (item.o + item.s * 0.35 - frame.current) / frame.length) / 0.34;
    cells.forEach((cell, position) => {
      if (!cell.photo) return;
      const tile = tileRefs.current[position];
      if (!tile) return;
      const progress = smooth(clamp(base - cell.lag * 1.4));
      if (tile.dataset.progress === String(progress)) return;
      tile.dataset.progress = String(progress);
      tile.style.transform = `scale(${(0.05 + 0.95 * progress).toFixed(4)})`;
      tile.style.borderRadius = `${((1 - progress) * 50).toFixed(1)}%`;
      tile.style.setProperty('--dot', (1 - progress * 1.5).toFixed(3));
      const image = tile.firstElementChild as HTMLImageElement | null;
      if (image) {
        image.style.opacity = progress.toFixed(3);
        image.style.filter =
          progress > 0.995
            ? ''
            : `blur(${((1 - progress) * 10).toFixed(1)}px) brightness(${(1 + (1 - progress) * 1.5).toFixed(2)})`;
      }
    });
    if (labelRef.current) labelRef.current.style.opacity = smooth(clamp(base * 1.4)).toFixed(3);
  });

  const section: CSSProperties = horizontal
    ? {
        width: geometry.sectionSize,
        height: '100%',
        marginLeft: geometry.marginLead,
        marginRight: geometry.marginTail,
      }
    : {
        height: geometry.sectionSize,
        marginTop: geometry.marginLead,
        marginBottom: geometry.marginTail,
      };
  // The gaps between groups belong to the nearest group, so a tap there still enters it.
  const reach = {
    '--grp-reach-lead': `${Math.min(120, Math.max(0, geometry.marginLead) / 2)}px`,
    '--grp-reach-tail': `${Math.min(120, Math.max(0, geometry.marginTail) / 2)}px`,
  } as CSSProperties;
  // A tap counts even while the track is still settling from a scroll: the browser then
  // reports no click, but the pointer never moved. A drag ends in pointercancel instead.
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    if (event.timeStamp - lastScrollAt < FLING_STOP_MS) {
      touch.current = null;
      return;
    }
    touch.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
    };
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved >= TAP_SLOP || event.timeStamp - start.at >= TAP_MAX_MS) return;
    tapped.current = event.timeStamp;
    onEnter(href, clusterRef.current, title);
  };

  const label: CSSProperties = horizontal
    ? { left: geometry.clusterX, bottom: geometry.labelBottom }
    : { left: geometry.clusterX, top: 0 };

  return (
    <Link
      ref={ref}
      href={href}
      className="sky-grp"
      aria-label={ariaLabel}
      data-undated={undated}
      data-node-x={geometry.nodeX}
      data-node-y={geometry.nodeY}
      style={{ ...section, ...reach }}
      data-axis={horizontal ? 'x' : 'y'}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (touch.current = null)}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        // The tap already entered; its click arrives right after and must not repeat it.
        if (tapped.current && event.timeStamp - tapped.current < 700) return;
        onEnter(href, clusterRef.current, title);
      }}
    >
      <span ref={labelRef} className="sky-lab" style={{ ...label, opacity: reduced ? 1 : 0 }}>
        <span className="sky-num" style={{ fontSize: geometry.numeralSize }}>
          {title}
        </span>
        <span className="sky-meta">
          <span>{meta}</span>
          <span className="sky-go" aria-hidden="true">
            {cta} →
          </span>
        </span>
      </span>
      <span
        ref={clusterRef}
        className="sky-cluster"
        style={{
          left: geometry.clusterX,
          top: geometry.clusterY,
          width: geometry.clusterWidth,
          height: geometry.clusterHeight,
        }}
      >
        {cells.map((cell, position) => (
          <span
            key={cell.photo?.id ?? `star-${position}`}
            ref={(element) => {
              tileRefs.current[position] = element;
            }}
            className="sky-tile"
            data-star={cell.photo ? undefined : 'true'}
            style={{
              left: cell.x,
              top: cell.y,
              width: cell.w,
              height: cell.h,
              rotate: `${cell.rotate}deg`,
              zIndex: cell.z,
              ...(cell.photo ? (reduced ? undefined : STAR_STYLE) : PLACEHOLDER_STYLE),
            }}
          >
            {cell.photo && (
              <img
                {...previewSources(api, cell.photo.thumbnailUrl, cell.w)}
                ref={trackTileImage}
                onLoad={tileImageSettled}
                onError={tileImageSettled}
                alt=""
                loading="lazy"
                fetchPriority={centred ? 'high' : 'low'}
                decoding="async"
                style={reduced ? undefined : { opacity: 0 }}
              />
            )}
          </span>
        ))}
        {more > 0 && <span className="sky-more">+{more.toLocaleString('es-ES')} más</span>}
      </span>
    </Link>
  );
}
