import { describe, expect, it } from 'vitest';
import type { TimelinePhoto } from '../../app/components/timeline-model';
import {
  coverStatus,
  monthName,
  monthScope,
  moveChoice,
  previewPhotos,
  sameOrder,
  scopeKey,
  scopeTitle,
  toggleChoice,
  UNKNOWN_MONTH_SCOPE,
  YEAR_SCOPE,
} from './model';

const photo = (id: string): TimelinePhoto => ({
  id,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/${id}/thumbnail`,
  effectiveDate: { value: '2024-03-02', precision: 'DAY' },
});

describe('cover choices', () => {
  it('adds at the end, removes on a second tap and renumbers the rest', () => {
    const one = toggleChoice([], 'a', 3);
    const two = toggleChoice(one.ids, 'b', 3);
    const three = toggleChoice(two.ids, 'c', 3);
    expect(three.ids).toEqual(['a', 'b', 'c']);
    expect(toggleChoice(three.ids, 'b', 3)).toEqual({ ids: ['a', 'c'], blocked: false });
  });

  it('refuses a photo beyond the limit but still lets one be removed', () => {
    expect(toggleChoice(['a', 'b'], 'c', 2)).toEqual({ ids: ['a', 'b'], blocked: true });
    expect(toggleChoice(['a', 'b'], 'a', 2)).toEqual({ ids: ['b'], blocked: false });
  });

  it('moves a photo one place and stops at the edges', () => {
    expect(moveChoice(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveChoice(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveChoice(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveChoice(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveChoice(['a'], 'x', 1)).toEqual(['a']);
  });

  it('compares order, not just membership', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('cover preview', () => {
  it('puts the chosen photos first and fills with the automatic ones, once each', () => {
    const shown = previewPhotos(
      [photo('c2'), photo('c1')],
      [photo('c1'), photo('a1'), photo('a2'), photo('a3')],
      4,
    );
    expect(shown.map((p) => p.id)).toEqual(['c2', 'c1', 'a1', 'a2']);
  });

  it('never shows more than the limit', () => {
    expect(previewPhotos([photo('1'), photo('2'), photo('3')], [photo('a')], 2)).toHaveLength(2);
  });
});

describe('cover labels', () => {
  it('names scopes in Spanish and keys them uniquely', () => {
    expect(scopeTitle(YEAR_SCOPE, 2024)).toBe('Portada de 2024');
    expect(scopeTitle(monthScope(3), 2024)).toBe('Marzo de 2024');
    expect(scopeTitle(UNKNOWN_MONTH_SCOPE, 2024)).toBe('Sin mes de 2024');
    expect(monthName(12)).toBe('Diciembre');
    expect(
      new Set([YEAR_SCOPE, monthScope(3), monthScope(4), UNKNOWN_MONTH_SCOPE].map(scopeKey)).size,
    ).toBe(4);
  });

  it('says automatic until something is chosen', () => {
    expect(coverStatus(undefined)).toBe('Automática');
    expect(coverStatus({ photos: [], dropped: [] })).toBe('Automática');
    expect(coverStatus({ photos: [photo('a'), photo('b')], dropped: [] })).toBe('Elegida (2)');
    expect(coverStatus({ photos: [], dropped: [{ photoId: 'x', reason: 'HIDDEN' }] })).toBe(
      'Elegida (0)',
    );
  });
});
