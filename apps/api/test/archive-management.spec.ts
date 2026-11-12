import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SourcesController } from '../src/sources.controller';
import { TimelineController } from '../src/timeline.controller';

function controllerFixture() {
  const photos = [
    {
      id: 'photo-1',
      userId: 'owner',
      driveFileId: 'drive-1',
      sourceId: 'source',
      folderId: 'child',
      fileName: 'Summer.jpg',
      mimeType: 'image/jpeg',
      effectiveDateValue: null,
      effectiveDatePrecision: 'UNKNOWN',
      effectiveDateSource: 'NONE',
      hiddenAt: null as Date | null,
      source: { name: 'Family archive' },
      folder: { path: ['Root', 'Child'] },
      override: {
        dateValue: new Date('2020-01-01'),
        precision: 'YEAR',
        reason: 'Family note',
      },
    },
    {
      id: 'photo-2',
      userId: 'owner',
      driveFileId: 'drive-2',
      sourceId: 'source',
      folderId: 'grandchild',
      fileName: 'Winter.jpg',
      mimeType: 'image/jpeg',
      effectiveDateValue: new Date('2024-01-01'),
      effectiveDatePrecision: 'YEAR',
      effectiveDateSource: 'EXIF',
      hiddenAt: null as Date | null,
      source: { name: 'Family archive' },
      folder: { path: ['Root', 'Child', 'Grandchild'] },
      override: null,
    },
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
      findMany: vi.fn(async ({ where, include }: any) =>
        where.hiddenAt
          ? photos.filter((photo) => photo.userId === where.userId && photo.hiddenAt)
          : where.id?.in
            ? photos
                .filter((photo) => where.id.in.includes(photo.id) && photo.userId === where.userId)
                .map(({ id, hiddenAt }) => ({ id, hiddenAt }))
            : include?.folder
              ? photos.filter(
                  (photo) =>
                    photo.userId === where.userId &&
                    photo.sourceId === where.sourceId &&
                    (!where.folderId || photo.folderId === where.folderId) &&
                    (!where.fileName ||
                      photo.fileName.toLowerCase().includes(where.fileName.contains)) &&
                    (!where.effectiveDateValue || photo.effectiveDateValue === null),
                )
              : where.folderId?.in
                ? photos.filter((photo) => where.folderId.in.includes(photo.folderId))
                : where.folderId
                  ? photos.filter(
                      (photo) => photo.userId === where.userId && photo.folderId === where.folderId,
                    )
                  : [],
      ),
      update: vi.fn(async ({ where, data }: any) => updates.push({ where, data })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matching = photos.filter(
          (photo) => where.id.in.includes(photo.id) && photo.userId === where.userId,
        );
        for (const photo of matching) Object.assign(photo, data);
        return { count: matching.length };
      }),
      delete: vi.fn(async ({ where }: any) => {
        const index = photos.findIndex((photo) => photo.id === where.id);
        if (index >= 0) photos.splice(index, 1);
      }),
      deleteMany: vi.fn(async () => ({ count: photos.length })),
    },
    photoCover: { findMany: vi.fn(async () => []) },
    photoFile: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    photoExclusion: {
      upsert: vi.fn(async (args: any) => exclusions.push(args)),
      findMany: vi.fn(async ({ where }: any) =>
        exclusions
          .map((entry) => ({
            id: 'excluded-1',
            ...entry.create,
            createdAt: new Date('2026-01-02'),
          }))
          .filter((entry) => entry.userId === where.userId),
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        exclusions.some((entry) => entry.create.userId === where.userId)
          ? { id: where.id, userId: where.userId }
          : null,
      ),
      deleteMany: vi.fn(async () => ({ count: exclusions.splice(0).length })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: async (operation: any) =>
      Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
  };
  const controller = new TimelineController(prisma, {} as any, {} as any);
  const sources = new SourcesController(prisma, {} as any, {} as any, {} as any);
  return { controller, sources, prisma, photos, exclusions, updates };
}

describe('indexed archive management', () => {
  it('removes only an owned, idle source and its local index', async () => {
    const fixture = controllerFixture();
    fixture.exclusions.push({
      create: {
        userId: 'owner',
        driveFileId: 'previously-excluded',
        sourceId: 'source',
        sourceName: 'Family archive',
      },
    });
    await expect(fixture.sources.removeSource('owner', 'source')).resolves.toBeUndefined();
    expect(fixture.prisma.photoFile.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', sourceId: 'source' },
    });
    expect(fixture.prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', sourceId: 'source', files: { none: {} } },
    });
    expect(fixture.prisma.indexedFolder.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', sourceId: 'source' },
    });
    expect(fixture.prisma.photoSource.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
    expect(fixture.exclusions).toHaveLength(1);
    expect(fixture.exclusions[0].create).toMatchObject({
      driveFileId: 'previously-excluded',
      sourceId: 'source',
    });
  });

  it('does not remove a source while a sync is queued or running', async () => {
    const fixture = controllerFixture();
    fixture.prisma.syncRun.findFirst.mockResolvedValueOnce({ id: 'active-run' });
    await expect(fixture.sources.removeSource('owner', 'source')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fixture.prisma.photo.deleteMany).not.toHaveBeenCalled();
    expect(fixture.prisma.indexedFolder.deleteMany).not.toHaveBeenCalled();
    expect(fixture.prisma.photoSource.delete).not.toHaveBeenCalled();
  });

  it('does not disclose or remove another user’s source', async () => {
    const fixture = controllerFixture();
    await expect(fixture.sources.removeSource('other', 'source')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fixture.prisma.photo.deleteMany).not.toHaveBeenCalled();
    expect(fixture.prisma.photoSource.delete).not.toHaveBeenCalled();
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
      photoCover: { findMany: vi.fn(async () => []) },
    };
    return {
      prisma,
      controller: new TimelineController(prisma, {} as any, {} as any),
    };
  }

  it('returns the complete year range, including empty years, without querying photos', async () => {
    const { controller, prisma } = timelineController();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
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
