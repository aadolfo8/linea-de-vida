import { describe, expect, it } from 'vitest';
import {
  findFolder,
  flattenTree,
  initialExpanded,
  pathToFolder,
  toDateText,
  treeKey,
} from './tree';
import type { FolderNode } from './types';

const node = (id: string, children: FolderNode[] = []): FolderNode => ({
  id,
  name: id.toUpperCase(),
  path: [id],
  parentId: null,
  depth: 0,
  photoCount: 1,
  toDateCount: 1,
  subtreePhotoCount: 1,
  subtreeToDateCount: 1,
  dateRule: null,
  children,
});

const tree = [node('a', [node('a1', [node('a1x')]), node('a2')]), node('b')];

describe('folder tree rows', () => {
  it('hides everything below a collapsed folder', () => {
    expect(flattenTree(tree, new Set()).map((row) => row.node.id)).toEqual(['a', 'b']);
    expect(flattenTree(tree, new Set(['a'])).map((row) => row.node.id)).toEqual([
      'a',
      'a1',
      'a2',
      'b',
    ]);
  });

  it('describes level, position and expansion for the tree roles', () => {
    const rows = flattenTree(tree, new Set(['a']));
    expect(rows[1]).toMatchObject({
      level: 2,
      position: 1,
      setSize: 2,
      hasChildren: true,
      expanded: false,
      parentId: 'a',
    });
    expect(rows[0]).toMatchObject({ level: 1, expanded: true });
  });

  it('finds paths and nodes, and opens the way to the selected folder', () => {
    expect(pathToFolder(tree, 'a1x')).toEqual(['a', 'a1', 'a1x']);
    expect(pathToFolder(tree, 'nope')).toEqual([]);
    expect(findFolder(tree, 'a2')?.id).toBe('a2');
    expect([...initialExpanded(tree, 'a1x')].sort()).toEqual(['a', 'a1', 'a1x', 'b']);
  });
});

describe('tree keyboard', () => {
  const rows = flattenTree(tree, new Set(['a']));

  it('moves with arrows, Home and End', () => {
    expect(treeKey(rows, 'a', 'ArrowDown')).toEqual({ kind: 'focus', id: 'a1' });
    expect(treeKey(rows, 'a1', 'ArrowUp')).toEqual({ kind: 'focus', id: 'a' });
    expect(treeKey(rows, 'a1', 'Home')).toEqual({ kind: 'focus', id: 'a' });
    expect(treeKey(rows, 'a', 'End')).toEqual({ kind: 'focus', id: 'b' });
    expect(treeKey(rows, 'b', 'ArrowDown')).toEqual({ kind: 'none' });
  });

  it('expands, enters and collapses with the side arrows', () => {
    expect(treeKey(rows, 'a1', 'ArrowRight')).toEqual({ kind: 'expand', id: 'a1' });
    expect(treeKey(rows, 'a', 'ArrowRight')).toEqual({ kind: 'focus', id: 'a1' });
    expect(treeKey(rows, 'a', 'ArrowLeft')).toEqual({ kind: 'collapse', id: 'a' });
    expect(treeKey(rows, 'a1', 'ArrowLeft')).toEqual({ kind: 'focus', id: 'a' });
    expect(treeKey(rows, 'b', 'ArrowRight')).toEqual({ kind: 'none' });
    expect(treeKey(rows, 'a', 'ArrowLeft')).not.toEqual({ kind: 'focus', id: 'a' });
  });

  it('chooses with Enter and Space and ignores other keys', () => {
    expect(treeKey(rows, 'a2', 'Enter')).toEqual({ kind: 'select', id: 'a2' });
    expect(treeKey(rows, 'a2', ' ')).toEqual({ kind: 'select', id: 'a2' });
    expect(treeKey(rows, 'a2', 'x')).toEqual({ kind: 'none' });
    expect(treeKey(rows, 'gone', 'Enter')).toEqual({ kind: 'none' });
  });
});

describe('counts text', () => {
  it('shows what is left to date, or a check', () => {
    expect(toDateText(12000)).toBe('12.000 por fechar');
    expect(toDateText(0)).toBe('✓');
  });
});
