import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app.controller';

function controllerFixture() {
  const photos = [
    { id: 'photo-1', userId: 'owner', driveFileId: 'drive-1', folderId: 'child' },
    { id: 'photo-2', userId: 'owner', driveFileId: 'drive-2', folderId: 'grandchild' },
  ];
  const overrides: any[] = [];
  const exclusions: any[] = [];
  const updates: any[] = [];
  const prisma: any = {
    photoSource: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.userId === 'owner' && where.id === 'source'
          ? { id: 'source', userId: 'owner' }
          : null,
      ),
    },
    syncRun: {
      findMany: vi.fn(async () => [
        { id: 'run-2', photoSourceId: 'source' },
        { id: 'run-1', photoSourceId: 'source' },
      ]),
    },
    indexedFolder: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.userId === 'owner' && where.id === 'child'
          ? { id: 'child', userId: 'owner', sourceId: 'source', path: ['Root', 'Child'] }
          : null,
      ),
      findMany: vi.fn(async () => [
        { id: 'root', parentId: null },
        { id: 'child', parentId: 'root' },
        { id: 'grandchild', parentId: 'child' },
        { id: 'sibling', parentId: 'root' },
      ]),
    },
    photo: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          photos.find((photo) => photo.id === where.id && photo.userId === where.userId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: any) =>
        where.folderId?.in
          ? photos.filter((photo) => where.folderId.in.includes(photo.folderId))
          : where.folderId
            ? photos.filter(
                (photo) => photo.userId === where.userId && photo.folderId === where.folderId,
              )
            : [],
      ),
      update: vi.fn(async ({ where, data }: any) => updates.push({ where, data })),
      delete: vi.fn(async ({ where }: any) => {
        const index = photos.findIndex((photo) => photo.id === where.id);
        if (index >= 0) photos.splice(index, 1);
      }),
    },
    manualDateOverride: {
      upsert: vi.fn(async (args: any) => overrides.push(args)),
    },
    photoExclusion: {
      upsert: vi.fn(async (args: any) => exclusions.push(args)),
    },
    $transaction: async (operation: any) => operation(prisma),
  };
  const controller = new AppController(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, prisma, photos, overrides, exclusions, updates };
}

describe('indexed archive management', () => {
  it('applies a recursive MONTH override only to the owned folder and descendants', async () => {
    const fixture = controllerFixture();
    await expect(
      fixture.controller.setFolderDate('owner', 'child', {
        year: 2024,
        month: 2,
        precision: 'MONTH',
        recursive: true,
      }),
    ).resolves.toEqual({ affectedCount: 2 });
    expect(fixture.overrides).toHaveLength(2);
    expect(fixture.updates).toHaveLength(2);
    expect(fixture.overrides[0].update.precision).toBe('MONTH');
    await expect(
      fixture.controller.setFolderDate('other', 'child', {
        year: 2024,
        precision: 'YEAR',
        recursive: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates an owned tombstone, removes only local metadata, and hides cross-user deletion', async () => {
    const fixture = controllerFixture();
    await fixture.controller.deletePhoto('owner', 'photo-1');
    expect(fixture.exclusions[0].create).toEqual({ userId: 'owner', driveFileId: 'drive-1' });
    expect(fixture.photos.some((photo) => photo.id === 'photo-1')).toBe(false);
    await expect(fixture.controller.deletePhoto('other', 'photo-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('scopes cursor-paginated sync history to an owned source', async () => {
    const fixture = controllerFixture();
    const first = await fixture.controller.sourceRuns('owner', 'source', undefined, '1');
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    expect(fixture.prisma.syncRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { photoSourceId: 'source' }, take: 2 }),
    );
    await expect(
      fixture.controller.sourceRuns('other', 'source', undefined, '1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paginates folder photos with ownership derived server-side', async () => {
    const fixture = controllerFixture();
    const page = await fixture.controller.indexedFolderPhotos('owner', 'child', undefined, '1');
    expect(page.items).toHaveLength(1);
    expect(fixture.prisma.photo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', folderId: 'child', status: 'ACTIVE' },
        take: 2,
      }),
    );
    await expect(fixture.controller.indexedFolderPhotos('other', 'child')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('uses exact month and leap-day boundaries for photo queries', async () => {
    const fixture = controllerFixture();
    await fixture.controller.photos('owner', '2024', '2', undefined, 'MONTH');
    expect(fixture.prisma.photo.findMany.mock.calls.at(-1)[0].where.effectiveDateValue).toEqual({
      gte: new Date('2024-02-01T00:00:00.000Z'),
      lt: new Date('2024-03-01T00:00:00.000Z'),
    });
    await fixture.controller.photos('owner', '2024', '2', '29', 'DAY');
    expect(fixture.prisma.photo.findMany.mock.calls.at(-1)[0].where.effectiveDateValue.lt).toEqual(
      new Date('2024-03-01T00:00:00.000Z'),
    );
    await expect(fixture.controller.photos('owner', '2023', '2', '29', 'DAY')).rejects.toThrow();
  });
});
