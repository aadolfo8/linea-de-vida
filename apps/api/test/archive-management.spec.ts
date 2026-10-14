import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app.controller';
import { FolderDateRuleService } from '../src/folder-date-rule.service';

function controllerFixture() {
  const photos = [
    { id: 'photo-1', userId: 'owner', driveFileId: 'drive-1', folderId: 'child' },
    { id: 'photo-2', userId: 'owner', driveFileId: 'drive-2', folderId: 'grandchild' },
  ];
  const exclusions: any[] = [];
  const updates: any[] = [];
  const prisma: any = {
    photoSource: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.userId === 'owner' && where.id === 'source'
          ? { id: 'source', userId: 'owner' }
          : null,
      ),
      delete: vi.fn(async () => ({ id: 'source' })),
    },
    syncRun: {
      findFirst: vi.fn(async () => null),
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
      deleteMany: vi.fn(async () => ({ count: 4 })),
    },
    folderDateRule: {
      upsert: vi.fn(async (args: any) => args.create),
      deleteMany: vi.fn(async () => ({ count: 1 })),
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
      deleteMany: vi.fn(async () => ({ count: photos.length })),
    },
    photoExclusion: {
      upsert: vi.fn(async (args: any) => exclusions.push(args)),
    },
    $transaction: async (operation: any) =>
      Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
  };
  const controller = new AppController(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new FolderDateRuleService(prisma),
  );
  return { controller, prisma, photos, exclusions, updates };
}

describe('indexed archive management', () => {
  it('removes only an owned, idle source and its local index', async () => {
    const fixture = controllerFixture();
    await expect(fixture.controller.removeSource('owner', 'source')).resolves.toBeUndefined();
    expect(fixture.prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', sourceId: 'source' },
    });
    expect(fixture.prisma.indexedFolder.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', sourceId: 'source' },
    });
    expect(fixture.prisma.photoSource.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
    expect(fixture.exclusions).toHaveLength(0);
  });

  it('does not remove a source while a sync is queued or running', async () => {
    const fixture = controllerFixture();
    fixture.prisma.syncRun.findFirst.mockResolvedValueOnce({ id: 'active-run' });
    await expect(fixture.controller.removeSource('owner', 'source')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fixture.prisma.photo.deleteMany).not.toHaveBeenCalled();
    expect(fixture.prisma.indexedFolder.deleteMany).not.toHaveBeenCalled();
    expect(fixture.prisma.photoSource.delete).not.toHaveBeenCalled();
  });

  it('does not disclose or remove another user’s source', async () => {
    const fixture = controllerFixture();
    await expect(fixture.controller.removeSource('other', 'source')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fixture.prisma.photo.deleteMany).not.toHaveBeenCalled();
    expect(fixture.prisma.photoSource.delete).not.toHaveBeenCalled();
  });

  it('removes a batch and makes retries safe without disclosing foreign IDs', async () => {
    const f = controllerFixture();
    expect(await f.controller.removePhotos('owner', { photoIds: ['photo-1', 'photo-1'] })).toEqual({
      results: [{ id: 'photo-1', status: 'REMOVED' }],
    });
    expect(await f.controller.removePhotos('owner', { photoIds: ['photo-1'] })).toEqual({
      results: [{ id: 'photo-1', status: 'ABSENT' }],
    });
    expect(await f.controller.removePhotos('other', { photoIds: ['photo-2', 'unknown'] })).toEqual({
      results: [
        { id: 'photo-2', status: 'ABSENT' },
        { id: 'unknown', status: 'ABSENT' },
      ],
    });
    expect(f.photos.some((photo) => photo.id === 'photo-2')).toBe(true);
    expect(f.exclusions).toHaveLength(1);
  });

  it('reports per-item failure and retries only the unfinished item', async () => {
    const f = controllerFixture();
    f.prisma.photoExclusion.upsert.mockRejectedValueOnce(new Error('temporary database failure'));
    expect(await f.controller.removePhotos('owner', { photoIds: ['photo-1', 'photo-2'] })).toEqual({
      results: [
        { id: 'photo-1', status: 'FAILED' },
        { id: 'photo-2', status: 'REMOVED' },
      ],
    });
    expect(f.photos.map((photo) => photo.id)).toEqual(['photo-1']);
    expect(await f.controller.removePhotos('owner', { photoIds: ['photo-1', 'photo-2'] })).toEqual({
      results: [
        { id: 'photo-1', status: 'REMOVED' },
        { id: 'photo-2', status: 'ABSENT' },
      ],
    });
  });

  it.each([undefined, null, [], [''], [42], Array(51).fill('photo-1'), ['x'.repeat(201)]])(
    'validates batch input before mutations: %j',
    async (photoIds) => {
      const f = controllerFixture();
      await expect(f.controller.removePhotos('owner', { photoIds })).rejects.toMatchObject({
        status: 400,
      });
      expect(f.prisma.photo.delete).not.toHaveBeenCalled();
    },
  );

  it('applies a recursive MONTH override only to the owned folder and descendants', async () => {
    const fixture = controllerFixture();
    await expect(
      fixture.controller.setFolderDate('owner', 'child', {
        year: 2024,
        month: 2,
        precision: 'MONTH',
      }),
    ).resolves.toMatchObject({
      rule: { folderId: 'child', precision: 'MONTH', scope: 'FALLBACK_DESCENDANTS' },
      affectedCount: 0,
    });
    await expect(
      fixture.controller.setFolderDate('other', 'child', {
        year: 2024,
        precision: 'YEAR',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes only a rule belonging to the current user', async () => {
    const fixture = controllerFixture();
    await expect(fixture.controller.removeFolderDate('owner', 'child')).resolves.toEqual({
      affectedCount: 0,
    });
    expect(fixture.prisma.folderDateRule.deleteMany).toHaveBeenCalledWith({
      where: { folderId: 'child' },
    });
    await expect(fixture.controller.removeFolderDate('other', 'child')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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

describe('temporal timeline contracts', () => {
  const record = (id: string, date: string, precision: 'YEAR' | 'MONTH' | 'DAY' = 'DAY') => ({
    id,
    userId: 'owner',
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    effectiveDateValue: new Date(date),
    effectiveDatePrecision: precision,
    detectedDate: new Date(date),
    detectedPrecision: precision,
    detectedSource: 'EXIF',
    override: null,
  });
  function timelineController() {
    const prisma: any = {
      $queryRawUnsafe: vi.fn(),
      photo: { findMany: vi.fn(async () => [record('preview', '2024-07-15')]) },
    };
    return {
      prisma,
      controller: new AppController(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      ),
    };
  }

  it('returns the complete year range, including empty years, without querying photos', async () => {
    const { controller, prisma } = timelineController();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ firstYear: 2020, lastYear: 2022 }])
      .mockResolvedValueOnce([
        { year: 2020, photoCount: BigInt(2) },
        { year: 2022, photoCount: BigInt(1) },
      ]);
    await expect(controller.years('owner')).resolves.toEqual({
      firstYear: 2020,
      lastYear: 2022,
      latestYear: 2022,
      items: [
        { year: 2022, photoCount: 1 },
        { year: 2021, photoCount: 0 },
        { year: 2020, photoCount: 2 },
      ],
    });
    expect(prisma.photo.findMany).not.toHaveBeenCalled();
  });

  it('keeps YEAR precision in the explicit unknown-month category and returns private proxy previews', async () => {
    const { controller, prisma } = timelineController();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ month: 7, photoCount: BigInt(2) }])
      .mockResolvedValueOnce([{ photoCount: BigInt(1) }])
      .mockResolvedValueOnce([{ id: 'preview', imageMetadata: { width: 3000, height: 2000 } }]);
    prisma.photo.findMany.mockResolvedValueOnce([
      { ...record('preview', '2024-07-01'), imageMetadata: { width: 3000, height: 2000 } },
    ]);
    const summary = await controller.yearSummary('owner', '2024');
    expect(summary.months).toHaveLength(12);
    expect(summary.months[6]).toEqual({ month: 7, photoCount: 2 });
    expect(summary.unknownMonthCount).toBe(1);
    expect(summary.previews[0].thumbnailUrl).toBe('/v1/photos/preview/thumbnail');
    expect(summary.previews[0].dimensions).toEqual({ width: 3000, height: 2000 });
    expect(JSON.stringify(summary)).not.toContain('drive');
  });

  it('filters month photos by owner, actual month boundaries, and MONTH/DAY precision with a keyset cursor', async () => {
    const { controller, prisma } = timelineController();
    prisma.photo.findMany.mockResolvedValueOnce([
      record('one', '2024-02-12'),
      record('two', '2024-02-01'),
    ]);
    const page = await controller.monthPhotos('owner', '2024', '2', undefined, '1');
    expect(prisma.photo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner',
          effectiveDatePrecision: { in: ['MONTH', 'DAY'] },
          effectiveDateValue: {
            gte: new Date('2024-02-01T00:00:00.000Z'),
            lt: new Date('2024-03-01T00:00:00.000Z'),
          },
        }),
        take: 2,
      }),
    );
    expect(page.nextCursor).toBeTruthy();
    await expect(controller.monthPhotos('owner', '2024', '2', 'bad-cursor')).rejects.toThrow(
      'cursor',
    );
  });

  it('uses YEAR precision only for the safe unknown-month photo route', async () => {
    const { controller, prisma } = timelineController();
    prisma.photo.findMany.mockResolvedValueOnce([record('year-only', '2024-01-01', 'YEAR')]);
    const page = await controller.unknownMonthPhotos('owner', '2024');
    expect(page.items[0].effectiveDate.precision).toBe('YEAR');
    expect(prisma.photo.findMany.mock.calls[0][0].where.effectiveDatePrecision).toBe('YEAR');
  });
});
