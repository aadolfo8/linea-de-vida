import { useRouter } from '../../../lib/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { api } from '../../../lib/api';
import { subscribeArchiveIndexUpdated } from '../../../lib/archive-index-events';
import { thumbnailVariantUrl } from '../../../lib/media';
import { getCachedMonthPreviews, loadMonthPreviews } from '../timeline-cache';
import {
  monthTitle,
  photoCountLabel,
  photoDateLabel,
  timelineHref,
  timelineHrefWithReturn,
  type TimelineMonth,
  type TimelineMonthPreviews,
  type TimelinePhoto,
} from '../timeline-model';
import { TimelinePhotoViewer, type ViewerSource } from '../TimelinePhotoViewer';
import { useTimelinePosition } from '../useTimelinePosition';
import './month.css';
import { SkyHint } from './SkyChrome';
import { SkyRail, type SkyRailEntry } from './SkyRail';
import { SkyOverlay, useSky, useSkyFrame, useSkyItem, useSkyMeasure } from './SkyStage';
import { SkyError, SkyLoading } from './SkyStates';
import { PeriodHeader } from './SkyThread';
import {
  extendSectionLayout,
  groupMonthPhotos,
  monthGeometry,
  sectionRailLabel,
  shouldLoadMore,
  type MonthGeometry,
  type MonthSection,
  type SectionLayout,
} from './month-layout';
import { shouldRestorePosition, travelLocation } from './travel';
import { useMonthPhotos } from './use-month-photos';
import { tileImageSettled, trackTileImage } from './tile-loading';
import { useTravelEntry } from './use-travel';

/** Tiles appear once as they come within this many viewports of the leading edge. */
const REVEAL_REACH = 1.02;

/** `CSS.escape` where it exists; ids are opaque strings, so quotes and backslashes are escaped otherwise. */
const cssEscape = (value: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');

const totalOf = (data: TimelineMonthPreviews | null, month: TimelineMonth) => {
  const wanted = month === 'sin-mes' ? null : month;
  return data?.items.find((group) => group.month === wanted)?.photoCount ?? null;
};

/**
 * Depth 2: every photo of one month (or of the photos that only know their year), paged while
 * travelling, grouped by day and laid out in masonry lanes with their real proportions.
 */
export function MonthDepth({
  year,
  month,
  returnTo,
  returnLabel,
  onLanded,
}: {
  year: number;
  month: TimelineMonth;
  returnTo: string | null;
  returnLabel: string | null;
  onLanded: () => void;
}) {
  const router = useRouter();
  const { engine, orientation, viewport, reduced } = useSky();
  const undated = month === 'sin-mes';
  const path = `/timeline/${year}/${month}`;
  const [restore] = useState(() => shouldRestorePosition(travelLocation(path)));
  useTimelinePosition(`sky:${path}`, { restorePosition: restore, variant: orientation });

  const [revision, setRevision] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [total, setTotal] = useState(() => totalOf(getCachedMonthPreviews(year), month));
  const { photos, cursor, loaded, loading, failed, loadNext, loadMoreForViewer, retry } =
    useMonthPhotos(year, month, revision);

  useEffect(
    () =>
      subscribeArchiveIndexUpdated(() => {
        setViewerIndex(null);
        setRevision((value) => value + 1);
      }),
    [],
  );

  useEffect(() => {
    let current = true;
    loadMonthPreviews(year)
      .then((data) => {
        if (current) setTotal(totalOf(data, month));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [month, revision, year]);

  const empty = loaded && photos.length === 0 && cursor === null;
  // A period without photos is not a destination: send people back up to the year.
  useEffect(() => {
    if (!empty) return;
    router.replace(timelineHrefWithReturn(timelineHref({ year }), returnTo, returnLabel));
  }, [empty, returnLabel, returnTo, router, year]);

  useTravelEntry({
    ready: loaded || failed,
    location: travelLocation(path),
    onLanded,
  });

  const sections = useMemo(() => groupMonthPhotos(photos), [photos]);
  const geometry = useMemo(() => monthGeometry(viewport, orientation), [orientation, viewport]);
  const layouts = useRef(new Map<string, SectionLayout>());
  const laidOut = useMemo(() => {
    const next = new Map<string, SectionLayout>();
    const result = sections.map((section) => {
      const layout = extendSectionLayout(
        layouts.current.get(section.key) ?? null,
        section.photos,
        geometry,
      );
      next.set(section.key, layout);
      return layout;
    });
    layouts.current = next;
    return result;
  }, [geometry, sections]);

  // Page in more photos when the travel position approaches the end of what is loaded. A
  // request only waits for the appended photos to be measured: once it settles and the track
  // did not grow (duplicates, an empty page, a lane that absorbed them) the guard is released
  // so paging goes on while a cursor exists and the end is near.
  const lastRequestLength = useRef(-1);
  const awaitingMeasure = useRef(false);
  const [settledPages, setSettledPages] = useState(0);
  useEffect(() => {
    if (settledPages === 0) return;
    awaitingMeasure.current = true;
    engine.scheduleMeasure();
  }, [engine, settledPages]);
  useSkyMeasure(() => {
    if (!awaitingMeasure.current) return;
    awaitingMeasure.current = false;
    if (engine.trackLength === lastRequestLength.current) lastRequestLength.current = -1;
  });
  useSkyFrame((frame) => {
    if (!loaded) return;
    if (
      !shouldLoadMore({
        current: frame.current,
        viewportLength: frame.length,
        trackLength: engine.trackLength,
        hasMore: cursor !== null,
        busy: loading,
        failed,
        lastRequestLength: lastRequestLength.current,
      })
    )
      return;
    lastRequestLength.current = engine.trackLength;
    void loadNext().then(() => setSettledPages((value) => value + 1));
  });

  const photosRef = useRef(photos);
  useLayoutEffect(() => {
    photosRef.current = photos;
  });
  const openAt = useCallback((photoId: string) => {
    const index = photosRef.current.findIndex((photo) => photo.id === photoId);
    if (index >= 0) setViewerIndex(index);
  }, []);

  // The viewer grows from, and shrinks back to, the tile of the photo it shows.
  const tileOf = useCallback(
    (photoId: string) =>
      document.querySelector<HTMLElement>(`button.sky-ph[data-photo-id="${cssEscape(photoId)}"]`),
    [],
  );
  // Changing photo moves the hidden track onto the new tile, so closing lands on a real one.
  const followPhoto = useCallback(
    (photoId: string) => {
      const tile = tileOf(photoId);
      if (tile) engine.follow(tile);
    },
    [engine, tileOf],
  );
  const viewerSource = useMemo<ViewerSource>(() => {
    return {
      rectOf: (photoId) => tileOf(photoId)?.getBoundingClientRect() ?? null,
      focusTile: (photoId) => {
        const tile = tileOf(photoId);
        tile?.focus({ preventScroll: true });
        return tile !== null;
      },
    };
  }, [tileOf]);

  // While the viewer is open the sky stays put behind it.
  const viewerOpen = viewerIndex !== null;
  useEffect(() => {
    if (!viewerOpen) return;
    engine.busy = true;
    return () => {
      engine.busy = false;
      engine.syncToScroll();
    };
  }, [engine, viewerOpen]);

  const rail = useMemo<SkyRailEntry[]>(
    () =>
      sections.map((section) => ({
        key: `day:${section.key}`,
        label: sectionRailLabel(section),
        small: section.photos.length.toLocaleString('es-ES'),
        aria: `Ir a ${section.label}`,
      })),
    [sections],
  );

  if (failed && !loaded)
    return (
      <SkyError
        message="No se pudieron cargar las fotos de este periodo. Tu archivo sigue intacto."
        onRetry={retry}
      />
    );
  if (!loaded || empty)
    return <SkyLoading label={`Cargando ${undated ? `${year}, sin mes` : monthTitle(month)}…`} />;

  const title = undated ? `${year}, sin mes` : `${monthTitle(month)} ${year}`;
  const known = Math.max(photos.length, total ?? 0);
  const days = sections.filter((section) => section.kind === 'day').length;
  const complete = cursor === null;

  return (
    <>
      <PeriodHeader
        compact
        itemKey="header"
        title={title}
        meta={
          <>
            <b>{known.toLocaleString('es-ES')}</b> {known === 1 ? 'foto' : 'fotos'}
            {complete && days > 1 ? ` · ${days} días` : ''}
          </>
        }
      />
      {sections.map((section, index) => (
        <DaySection
          key={section.key}
          section={section}
          layout={laidOut[index]!}
          geometry={geometry}
          first={index === 0}
          reduced={reduced}
          onOpen={openAt}
        />
      ))}
      <div
        className="sky-tail"
        style={
          orientation === 'horizontal'
            ? { width: geometry.tail, height: '100%' }
            : { height: geometry.tail }
        }
      >
        {failed ? (
          <div role="alert">
            <p>No se pudieron cargar más fotos.</p>
            <button
              type="button"
              onClick={() => {
                lastRequestLength.current = -1;
                retry();
              }}
            >
              Reintentar
            </button>
          </div>
        ) : loading ? (
          <p role="status" className="sky-wait">
            Cargando más fotos…
          </p>
        ) : null}
      </div>
      <SkyOverlay>
        <SkyRail entries={rail} label="Saltar a un día" />
        <SkyHint text={`Pulsa una foto para abrirla · Esc para volver a ${year}`} />
      </SkyOverlay>
      {viewerOpen && (
        <SkyOverlay>
          <TimelinePhotoViewer
            photos={photos}
            initialIndex={viewerIndex!}
            total={total}
            source={viewerSource}
            onPhotoChange={followPhoto}
            loadMore={cursor ? loadMoreForViewer : undefined}
            onClose={() => setViewerIndex(null)}
          />
        </SkyOverlay>
      )}
    </>
  );
}

/** One day (or one honest "no day" bucket): a heading and its photos in masonry lanes. */
const DaySection = memo(function DaySection({
  section,
  layout,
  geometry,
  first,
  reduced,
  onOpen,
}: {
  section: MonthSection;
  layout: SectionLayout;
  geometry: MonthGeometry;
  first: boolean;
  reduced: boolean;
  onOpen: (photoId: string) => void;
}) {
  const horizontal = geometry.axis === 'horizontal';
  const { ref, itemRef } = useSkyItem<HTMLDivElement>(`day:${section.key}`);
  const pending = useRef<{ el: HTMLElement; position: number }[]>([]);
  const pointer = useRef(0);

  // Photos that have not been revealed yet, in the order the track reaches them.
  useLayoutEffect(() => {
    const buttons = ref.current?.querySelectorAll<HTMLElement>('button.sky-ph') ?? [];
    const list: { el: HTMLElement; position: number }[] = [];
    buttons.forEach((el, index) => {
      if (el.dataset.in) return;
      const placement = layout.placements[index]!;
      list.push({
        el,
        position: horizontal ? placement.x : geometry.headingSpace + placement.y,
      });
    });
    pending.current = list.sort((a, b) => a.position - b.position);
    pointer.current = 0;
  }, [geometry.headingSpace, horizontal, layout, ref]);

  useSkyFrame((frame) => {
    const item = itemRef.current;
    if (!item?.measured || pointer.current >= pending.current.length) return;
    const edge = frame.current + frame.length * REVEAL_REACH - item.o;
    const list = pending.current;
    while (pointer.current < list.length && list[pointer.current]!.position < edge) {
      list[pointer.current]!.el.dataset.in = 'true';
      pointer.current += 1;
    }
  });

  const along = layout.length + (horizontal ? 0 : geometry.headingSpace);
  const style: CSSProperties = horizontal
    ? {
        width: along,
        height: '100%',
        marginLeft: first ? geometry.leadFirst : geometry.leadNext,
      }
    : { height: along, marginTop: first ? geometry.leadFirst : geometry.leadNext };
  const heading: CSSProperties = horizontal
    ? { left: 0, top: geometry.crossOffset - 30 }
    : { left: geometry.crossOffset, top: 0 };
  const count = section.photos.length;

  return (
    <div
      ref={ref}
      className="sky-day"
      role="group"
      aria-label={`${section.label}: ${photoCountLabel(count)}`}
      data-undated={section.kind !== 'day'}
      style={style}
    >
      <h2 style={heading}>
        {section.label}
        <small>{count.toLocaleString('es-ES')}</small>
      </h2>
      {layout.placements.map(({ item, x, y, w, h }) => (
        <PhotoTile
          key={item.id}
          photo={item.photo}
          left={horizontal ? x : geometry.crossOffset + x}
          top={horizontal ? geometry.crossOffset + y : geometry.headingSpace + y}
          width={w}
          height={h}
          shown={reduced}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
});

const PhotoTile = memo(function PhotoTile({
  photo,
  left,
  top,
  width,
  height,
  shown,
  onOpen,
}: {
  photo: TimelinePhoto;
  left: number;
  top: number;
  width: number;
  height: number;
  shown: boolean;
  onOpen: (photoId: string) => void;
}) {
  const small = thumbnailVariantUrl(api, photo.thumbnailUrl, 640);
  const large = thumbnailVariantUrl(api, photo.thumbnailUrl, 1280);
  return (
    <button
      type="button"
      className="sky-ph"
      data-photo-id={photo.id}
      data-in={shown ? 'true' : undefined}
      aria-label={photoDateLabel(photo)}
      style={{ left, top, width, height }}
      onClick={() => onOpen(photo.id)}
    >
      <img
        src={small}
        srcSet={`${small} 640w, ${large} 1280w`}
        sizes={`${Math.round(width)}px`}
        ref={trackTileImage}
        onLoad={tileImageSettled}
        onError={tileImageSettled}
        alt=""
        width={photo.dimensions?.width}
        height={photo.dimensions?.height}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </button>
  );
});
