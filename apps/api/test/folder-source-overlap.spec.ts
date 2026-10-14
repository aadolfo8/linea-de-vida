import { describe, expect, it } from 'vitest';
import { DriveItem } from '../src/drive';
import {
  findOverlappingFolderSource,
  FolderAncestryUnavailable,
} from '../src/folder-source-overlap';

const folder = (id: string, parents: string[] = []): DriveItem => ({
  id,
  name: id,
  mimeType: 'application/vnd.google-apps.folder',
  parents,
});

function driveTree(items: Record<string, DriveItem[]>) {
  return {
    getFolder: async (_connection: unknown, id: string) =>
      Object.values(items)
        .flat()
        .find((item) => item.id === id) ?? null,
  } as any;
}

describe('findOverlappingFolderSource', () => {
  const connection = { refreshTokenCiphertext: null };

  it('detects a candidate nested under an existing source', async () => {
    const drive = driveTree({
      root: [folder('archive')],
      archive: [folder('year', ['archive'])],
      year: [folder('month', ['year'])],
    });
    await expect(
      findOverlappingFolderSource(connection, 'month', ['archive'], drive),
    ).resolves.toBe('archive');
  });

  it('detects an existing source nested under the candidate', async () => {
    const drive = driveTree({
      root: [folder('archive')],
      archive: [folder('year', ['archive'])],
    });
    await expect(findOverlappingFolderSource(connection, 'archive', ['year'], drive)).resolves.toBe(
      'year',
    );
  });

  it('allows disjoint sources and does not inspect unrelated Drive folders', async () => {
    const drive = driveTree({
      root: [folder('archive'), folder('other')],
    });
    await expect(
      findOverlappingFolderSource(connection, 'archive', ['other'], drive),
    ).resolves.toBe(null);
  });

  it('fails closed when ancestry cannot be verified', async () => {
    const drive = driveTree({ root: [folder('archive', ['inaccessible-parent'])] });
    await expect(
      findOverlappingFolderSource(connection, 'archive', ['other'], drive),
    ).rejects.toBeInstanceOf(FolderAncestryUnavailable);
  });
});
