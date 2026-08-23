'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { mediaUrl } from '../../lib/media';
import styles from './preview.module.css';

type Variant = 'atlas' | 'control-desk' | 'monochrome';
type Precision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';
type Photo = {
  id: string;
  fileName: string;
  mimeType: string;
  thumbnailUrl: string;
  effectiveDate: { value: string | null; precision: Precision };
  period: { year: number | null; month: number | null; key: string };
};
type FeedPage = { items: Photo[]; nextCursor: string | null };
type LoadState = 'loading' | 'signed-out' | 'error' | 'ready';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const month = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const labels: Record<Variant, { title: string; intro: string; action: string }> = {
  atlas: {
    title: 'Atlas of shared journeys',
    intro: 'Known periods become route legs; unknown dates remain an unplaced horizon.',
    action: 'Follow the route',
  },
  'control-desk': {
    title: 'Creator control desk',
    intro: 'A timeline instrument that keeps chronological precision visible at every decision.',
    action: 'Inspect sequence',
  },
  monochrome: {
    title: 'Monochrome desktop archive',
    intro:
      'A compact working archive. The interface is monochrome; photographs keep their original color.',
    action: 'Open archive',
  },
};

function periodLabel(photo: Photo) {
  if (photo.period.year === null) return 'Unknown date';
  if (photo.period.month === null) return `${photo.period.year} · year only`;
  return `${month.format(new Date(Date.UTC(2024, photo.period.month - 1)))} ${photo.period.year}`;
}

function precisionLabel(precision: Precision) {
  return { DAY: 'Day known', MONTH: 'Month known', YEAR: 'Year only', UNKNOWN: 'Unknown date' }[
    precision
  ];
}

function PhotoTile({ photo, variant }: { photo: Photo; variant: Variant }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const unsupported = /^image\/(heic|heif)$/i.test(photo.mimeType);
  return (
    <article className={styles.photoTile}>
      <div className={styles.photoFrame}>
        {unsupported ? (
          <div className={styles.mediaFallback}>
            This format is indexed but cannot be previewed here.
          </div>
        ) : failed ? (
          <div className={styles.mediaFallback}>
            Preview unavailable.
            <button
              onClick={() => {
                setFailed(false);
                setRetry((value) => value + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <img
            key={retry}
            src={mediaUrl(api, photo.thumbnailUrl)}
            alt={photo.fileName}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className={styles.photoMeta}>
        <strong>{photo.fileName}</strong>
        <span>{precisionLabel(photo.effectiveDate.precision)}</span>
        {variant === 'control-desk' && <span className={styles.statusDot}>Indexed</span>}
      </div>
    </article>
  );
}

export function Preview({ variant }: { variant: Variant }) {
  const [state, setState] = useState<LoadState>('loading');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const text = labels[variant];

  const load = async (next: string | null = null, replace = false) => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const me = await fetch(`${api}/me`, { credentials: 'include' });
      if (!me.ok) {
        setState('signed-out');
        return;
      }
      const response = await fetch(
        `${api}/timeline/feed?limit=24${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('feed');
      const page = (await response.json()) as FeedPage;
      setPhotos((current) => {
        const existing = new Set((replace ? [] : current).map((item) => item.id));
        return [
          ...(replace ? [] : current),
          ...page.items.filter((item) => !existing.has(item.id)),
        ];
      });
      setCursor(page.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void load(null, true);
  }, []);
  const groups = useMemo(() => {
    const result = new Map<string, { label: string; photos: Photo[]; year: number | null }>();
    photos.forEach((photo) => {
      const group = result.get(photo.period.key);
      if (group) group.photos.push(photo);
      else
        result.set(photo.period.key, {
          label: periodLabel(photo),
          photos: [photo],
          year: photo.period.year,
        });
    });
    return [...result.entries()].map(([key, value]) => ({ key, ...value }));
  }, [photos]);
  const routeGroups = activePeriod ? groups.filter((group) => group.key === activePeriod) : groups;
  const years = [
    ...new Set(groups.map((group) => group.year).filter((year): year is number => year !== null)),
  ];

  return (
    <main className={`${styles.preview} ${styles[variant]}`}>
      <header className={styles.previewHeader}>
        <Link href="/design-preview" className={styles.back}>
          ← Back to comparison
        </Link>
        <span aria-live="polite">
          {state === 'ready' ? `${photos.length} items loaded` : 'Preview only'}
        </span>
      </header>
      <section className={styles.intro}>
        <div className={styles.worldMark} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
        </div>
        <button onClick={() => void load(null, true)} disabled={loadingMore}>
          {loadingMore ? 'Refreshing…' : text.action}
        </button>
      </section>
      {variant === 'atlas' && (
        <nav className={styles.routeLegend} aria-label="Route legend">
          <span>
            <i /> Day known
          </span>
          <span>
            <i /> Period known
          </span>
          <span>
            <i /> Unplaced
          </span>
        </nav>
      )}
      {variant === 'control-desk' && (
        <section className={styles.controlStrip} aria-label="Timeline controls">
          <span>FEED / CHRONOLOGICAL</span>
          <span>DATE PRECISION / PRESERVED</span>
          <span>MEDIA / READ ONLY</span>
        </section>
      )}
      {variant === 'monochrome' && (
        <section className={styles.archiveBar}>
          <span>ARCHIVE.EXE</span>
          <span>LOCAL VIEW / READ ONLY</span>
          <span>{state === 'ready' ? 'SESSION ACTIVE' : 'AWAITING SESSION'}</span>
        </section>
      )}
      {state === 'loading' && (
        <section className={styles.statePanel} aria-live="polite">
          <b>Loading your archive</b>
          <span>Checking the current session and its selected photo source.</span>
        </section>
      )}
      {state === 'signed-out' && (
        <section className={styles.statePanel}>
          <b>Sign in to load your own archive</b>
          <span>This comparison never substitutes another person’s photos or timeline.</span>
          <Link href="/">Go to sign in</Link>
        </section>
      )}
      {state === 'error' && (
        <section className={styles.statePanel}>
          <b>The timeline could not be loaded</b>
          <span>Your archive remains unchanged. Try the connection again.</span>
          <button onClick={() => void load(null, true)}>Try again</button>
        </section>
      )}
      {state === 'ready' && photos.length === 0 && (
        <section className={styles.emptyState}>
          <b>Visual demo state — no timeline items are available.</b>
          <span>
            When the selected folder has indexed photos, this preview renders those real items here.
          </span>
          <div aria-hidden="true" />
        </section>
      )}
      {state === 'ready' && groups.length > 0 && (
        <>
          <nav className={styles.periodNav} aria-label="Loaded timeline periods">
            <button
              className={!activePeriod ? styles.selected : ''}
              onClick={() => setActivePeriod(null)}
            >
              All loaded
            </button>
            {years.map((year) => (
              <button
                key={year}
                onClick={() =>
                  setActivePeriod(groups.find((group) => group.year === year)?.key ?? null)
                }
              >
                {year}
              </button>
            ))}
            {groups.map((group) => (
              <button key={group.key} onClick={() => setActivePeriod(group.key)}>
                {group.label}
              </button>
            ))}
          </nav>
          <section className={styles.timeline} aria-live="polite">
            {routeGroups.map((group) => (
              <section key={group.key} className={styles.period}>
                <header>
                  <span>{group.year ?? '—'}</span>
                  <h2>{group.label}</h2>
                  <b>{group.photos.length} items</b>
                </header>
                <div className={styles.photoRail}>
                  {group.photos.map((photo) => (
                    <PhotoTile key={photo.id} photo={photo} variant={variant} />
                  ))}
                </div>
              </section>
            ))}
          </section>
          {cursor && (
            <button
              className={styles.loadMore}
              onClick={() => void load(cursor)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load next period'}
            </button>
          )}
        </>
      )}
    </main>
  );
}
