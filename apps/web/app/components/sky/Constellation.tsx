'use client';

import Link from 'next/link';
import {
  useLayoutEffect,
  useMemo,
  useRef,
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

/** Shapes of the stars shown while a group's photos are still on their way. */
const PLACEHOLDER_ASPECTS = [1.5, 0.75, 1.5, 1.33, 0.8, 1.78, 1.5];
/** A group asks for its photos once it is this many viewports away. */
const NEAR_VIEWPORTS = 1.6;
/** A touch that moves less than this far and ends this fast is a tap, not a scroll. */
const TAP_SLOP = 10;
const TAP_MAX_MS = 300;
/** How big a still-unrevealed placeholder star stays. */
const STAR_SCALE = 0.06;

type Cell = {
  photo: TimelinePhoto | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Reveal delay: tiles nearer the leading edge appear first. */
  lag: number;
};

/** Tiles start as stars; the frame loop grows them into photos as they enter. */
const STAR_STYLE = {
  transform: `scale(${STAR_SCALE})`,
  borderRadius: '50%',
  '--dot': 1,
} as CSSProperties;

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
      ({ item, x, y, w, h }) => ({
        photo: item.photo,
        x,
        y,
        w,
        h,
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
  /** Fires once per epoch, when the group approaches the viewport. */
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
  const requested = useRef(false);
  const settled = useRef(false);
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
    requested.current = false;
    engine.wake();
  }, [engine, epoch]);
  // New tiles (or a new layout) must be painted at least once even if the track is at rest.
  useLayoutEffect(() => {
    settled.current = false;
  }, [cells]);

  useSkyFrame((frame) => {
    const item = itemRef.current;
    if (!item?.measured) return;
    if (!requested.current && (item.o - frame.current) / frame.length < NEAR_VIEWPORTS) {
      requested.current = true;
      near.current?.();
    }
    if (reduced || (settled.current && !frame.moved)) return;
    settled.current = !frame.moved;
    const base = (1.12 - (item.o + item.s * 0.35 - frame.current) / frame.length) / 0.34;
    cells.forEach((cell, position) => {
      const tile = tileRefs.current[position];
      if (!tile) return;
      const progress = cell.photo ? smooth(clamp(base - cell.lag * 1.4)) : STAR_SCALE;
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
              ...(reduced && cell.photo ? undefined : STAR_STYLE),
            }}
          >
            {cell.photo && (
              /* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */
              <img
                src={thumbnailVariantUrl(api, cell.photo.thumbnailUrl, 640)}
                srcSet={`${thumbnailVariantUrl(api, cell.photo.thumbnailUrl, 640)} 640w, ${thumbnailVariantUrl(api, cell.photo.thumbnailUrl, 1280)} 1280w`}
                sizes={`${Math.round(cell.w)}px`}
                alt=""
                loading="lazy"
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
