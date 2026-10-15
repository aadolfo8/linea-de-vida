import { describe, expect, it } from 'vitest';
import { parseOrganizeLocation, writeOrganizeLocation } from './organize-navigation';

describe('organize navigation state', () => {
  it('restores task, folder, filters, and search from the URL', () => {
    expect(
      parseOrganizeLocation(
        'https://example.test/organizar?source=s1&folder=f2&task=pending&classification=UNCLASSIFIED&q=summer&searchFolder=f3',
      ),
    ).toEqual({
      sourceId: 's1',
      folderId: 'f2',
      task: 'pending',
      classification: 'UNCLASSIFIED',
      query: 'summer',
      searchFolderId: 'f3',
    });
  });

  it('migrates the previous undated link and drops invalid values to safe defaults', () => {
    expect(
      parseOrganizeLocation('/organizar?filter=undated&task=unknown&classification=other'),
    ).toEqual({
      sourceId: null,
      folderId: null,
      task: 'pending',
      classification: 'UNCLASSIFIED',
      query: '',
      searchFolderId: 'ALL',
    });
  });

  it('writes stable task and folder state while preserving other query values', () => {
    expect(
      writeOrganizeLocation('/organizar?oauth=drive-connected&filter=undated', {
        sourceId: 's1',
        folderId: 'f2',
        task: 'dates',
        classification: 'ALL',
        query: '',
        searchFolderId: 'ALL',
      }),
    ).toBe('/organizar?oauth=drive-connected&source=s1&folder=f2&task=dates');
  });
});
