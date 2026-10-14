import { describe, expect, it } from 'vitest';
import { visibleFolderTree } from './folder-tree';

const folders = [
  { id: 'root', parentId: null },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
  { id: 'other-root', parentId: null },
  { id: 'orphan', parentId: 'missing' },
];

describe('visibleFolderTree', () => {
  it('keeps descendants hidden when their parent is collapsed', () => {
    expect(visibleFolderTree(folders, new Set(['root'])).map(({ id }) => id)).toEqual([
      'root',
      'other-root',
      'orphan',
    ]);
  });

  it('shows descendants again when expanded and retains independent roots', () => {
    expect(visibleFolderTree(folders, new Set()).map(({ id }) => id)).toEqual([
      'root',
      'child',
      'grandchild',
      'other-root',
      'orphan',
    ]);
  });

  it('visits malformed cyclic components once', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(visibleFolderTree(cyclic, new Set()).map(({ id }) => id)).toEqual(['a', 'b']);
  });
});
