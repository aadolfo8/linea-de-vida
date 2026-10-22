import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { apiErrorCopy } from './errors';
import { countsFromPiles, describeSource, isSyncActive, relativeTime, type SyncRun } from './sync';
import { looksLikeTakeout } from './takeout';

const now = new Date('2026-10-21T12:00:00Z');
const run = (patch: Partial<SyncRun>): SyncRun => ({
  id: 'r1',
  photoSourceId: 's1',
  status: 'SUCCEEDED',
  updatedAt: '2026-10-21T10:00:00Z',
  ...patch,
});

describe('relative time', () => {
  it('reads recent moments in plain Spanish', () => {
    expect(relativeTime('2026-10-21T11:59:50Z', now)).toBe('ahora mismo');
    expect(relativeTime('2026-10-21T11:55:00Z', now)).toBe('hace 5 minutos');
    expect(relativeTime('2026-10-21T10:00:00Z', now)).toBe('hace 2 horas');
    expect(relativeTime('2026-10-20T12:00:00Z', now)).toBe('ayer');
    expect(relativeTime('2026-10-18T12:00:00Z', now)).toBe('hace 3 días');
    expect(relativeTime('2026-08-21T12:00:00Z', now)).toBe('hace 2 meses');
  });

  it('has nothing to say without a valid date', () => {
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime('nope', now)).toBeNull();
  });
});

describe('source state', () => {
  it('says a source is up to date and when it was updated', () => {
    expect(describeSource({ status: 'ACTIVE', run: run({}) }, now)).toMatchObject({
      tone: 'ok',
      label: 'Al día · actualizado hace 2 horas',
      failed: false,
    });
  });

  it('shows found and processed counts while reading', () => {
    const state = describeSource(
      { status: 'ACTIVE', run: run({ status: 'RUNNING', foundCount: 200, processedCount: 50 }) },
      now,
    );
    expect(state).toMatchObject({ tone: 'busy', progress: { done: 50, total: 200 } });
    expect(state.label).toBe('Leyendo fotos nuevas… 50 de 200');
    expect(isSyncActive(run({ status: 'QUEUED' }))).toBe(true);
    expect(
      describeSource({ status: 'ACTIVE', run: run({ status: 'QUEUED' }) }, now).label,
    ).toContain('En cola');
    expect(
      describeSource({ status: 'ACTIVE', run: run({ status: 'RUNNING', foundCount: 0 }) }, now)
        .progress,
    ).toBeNull();
  });

  it('offers a retry when the last reading failed, without alarming', () => {
    const state = describeSource({ status: 'ACTIVE', run: run({ status: 'FAILED' }) }, now);
    expect(state).toMatchObject({ tone: 'error', failed: true });
    expect(state.label).toContain('Tus fotos siguen intactas');
  });

  it('mentions unreadable photos of a partial reading', () => {
    expect(
      describeSource({ status: 'ACTIVE', run: run({ status: 'PARTIAL', issueCount: 3 }) }, now)
        .label,
    ).toBe('Al día · actualizado hace 2 horas · 3 fotos no se pudieron leer');
  });

  it('handles a source never read and a disconnected one', () => {
    expect(describeSource({ status: 'ACTIVE', run: null }, now).tone).toBe('idle');
    expect(describeSource({ status: 'DISCONNECTED', run: run({}) }, now).tone).toBe('off');
  });

  it('turns piles into the three numbers of a card', () => {
    expect(countsFromPiles({ undated: 3, yearOnly: 2, total: 40, hidden: 1 })).toEqual({
      total: 40,
      toDate: 5,
      hidden: 1,
    });
  });
});

describe('Takeout hint', () => {
  it('recognises the usual export names', () => {
    expect(looksLikeTakeout('Takeout', [])).toBe(true);
    expect(looksLikeTakeout(null, ['Google Fotos'])).toBe(true);
    expect(looksLikeTakeout(null, ['Google Photos'])).toBe(true);
    expect(looksLikeTakeout(null, ['Photos from 2019', 'Photos from 2020', 'Vacaciones'])).toBe(
      true,
    );
    expect(looksLikeTakeout(null, ['Fotos de 1998', 'Fotos de 1999'])).toBe(true);
  });

  it('does not guess from a single year folder or ordinary names', () => {
    expect(looksLikeTakeout('Fotos de la familia', ['Escaneos', '1998', '1999'])).toBe(false);
    expect(looksLikeTakeout(null, ['Photos from 2019'])).toBe(false);
    expect(looksLikeTakeout(null, [])).toBe(false);
  });
});

describe('error copy', () => {
  const error = (code: string, status = 409) => new ApiError(status, code, 'x', null, null);

  it('explains a folder that overlaps another source', () => {
    expect(apiErrorCopy(error('FOLDER_SOURCE_OVERLAP'), 'fallback')).toContain(
      'contiene, o está dentro de, otra que ya has añadido',
    );
  });

  it('explains authorization and connection problems', () => {
    expect(apiErrorCopy(error('CONNECTION_NOT_FOUND', 404), 'fallback')).toContain(
      'Drive no está conectado',
    );
    expect(apiErrorCopy(error('X', 401), 'fallback')).toContain('sesión ha caducado');
    expect(apiErrorCopy(error('X', 403), 'fallback')).toContain('Google no nos deja leer');
    expect(apiErrorCopy(error('FOLDER_NOT_FOUND', 404), 'fallback')).toContain(
      'No encontramos esa carpeta',
    );
  });

  it('falls back for anything else', () => {
    expect(apiErrorCopy(new Error('boom'), 'fallback')).toBe('fallback');
    expect(apiErrorCopy(error('SOMETHING', 400), 'fallback')).toBe('fallback');
    expect(apiErrorCopy(error('SOMETHING', 503), 'fallback')).toContain(
      'Algo falló por nuestra parte',
    );
  });
});
