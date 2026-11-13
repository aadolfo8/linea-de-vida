import { describe, expect, it } from 'vitest';
import { defaultPile, orderLocationSearch, parseOrderLocation } from './location';

describe('order location', () => {
  it('reads the source, folder, pile and subfolder switch', () => {
    expect(parseOrderLocation('?source=s1&folder=f1&pile=yearOnly&subfolders=0')).toEqual({
      sourceId: 's1',
      folderId: 'f1',
      pile: 'yearOnly',
      includeSubfolders: false,
    });
    expect(parseOrderLocation('')).toEqual({
      sourceId: null,
      folderId: null,
      pile: null,
      includeSubfolders: true,
    });
  });

  it('understands the old pile names and ignores unknown ones', () => {
    expect(parseOrderLocation('?pile=none').pile).toBe('undated');
    expect(parseOrderLocation('?pile=done').pile).toBe('dated');
    expect(parseOrderLocation('?pile=whatever').pile).toBeNull();
    expect(parseOrderLocation('?pile=constructor').pile).toBeNull();
    expect(parseOrderLocation('?pile=__proto__').pile).toBeNull();
  });

  it('writes only what differs from the defaults and round-trips', () => {
    const location = {
      sourceId: 's1',
      folderId: 'f1',
      pile: 'hidden' as const,
      includeSubfolders: false,
    };
    expect(orderLocationSearch(location)).toBe('?source=s1&folder=f1&pile=hidden&subfolders=0');
    expect(parseOrderLocation(orderLocationSearch(location))).toEqual(location);
    expect(
      orderLocationSearch({ sourceId: null, folderId: null, pile: null, includeSubfolders: true }),
    ).toBe('');
  });

  it('picks the first pile with work to do', () => {
    expect(defaultPile({ undated: 0, yearOnly: 3, dated: 9, hidden: 1, total: 12 })).toBe(
      'yearOnly',
    );
    expect(defaultPile({ undated: 2, yearOnly: 3, dated: 9, hidden: 1, total: 12 })).toBe(
      'undated',
    );
    expect(defaultPile({ undated: 0, yearOnly: 0, dated: 9, hidden: 1, total: 10 })).toBe('dated');
  });
});
