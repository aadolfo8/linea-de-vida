import { describe, expect, it, vi } from 'vitest';
import { FolderDateRuleService } from '../src/folder-date-rule.service';

describe('FolderDateRuleService', () => {
  it('terminates when the stored folder tree has a cycle', async () => {
    const prisma: any = {
      indexedFolder: {
        findFirst: vi.fn(async () => ({ id: 'a', userId: 'owner', sourceId: 'source' })),
        findMany: vi.fn(async () => [
          { id: 'a', parentId: 'b', dateRule: null },
          { id: 'b', parentId: 'a', dateRule: null },
        ]),
      },
      photo: {
        findMany: vi.fn(async () => [
          {
            id: 'p',
            folderId: 'a',
            effectiveDateValue: null,
            effectiveDatePrecision: 'UNKNOWN',
            effectiveDateSource: 'NONE',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: null,
          },
        ]),
      },
    };
    const preview = await new FolderDateRuleService(prisma).preview('owner', 'a', {
      dateValue: new Date('2005-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      scope: 'FALLBACK_DESCENDANTS',
    });
    expect(preview.scopePhotoCount).toBe(1);
  });

  it('excludes descendants where a nearer folder rule takes precedence', async () => {
    const childRule = {
      dateValue: new Date('1998-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      scope: 'DIRECT_ONLY',
    };
    const prisma: any = {
      indexedFolder: {
        findFirst: vi.fn(async () => ({ id: 'root', userId: 'owner', sourceId: 'source' })),
        findMany: vi.fn(async () => [
          { id: 'root', parentId: null, dateRule: null },
          { id: 'child', parentId: 'root', dateRule: childRule },
        ]),
      },
      photo: {
        findMany: vi.fn(async () => [
          {
            id: 'child-photo',
            folderId: 'child',
            effectiveDateValue: childRule.dateValue,
            effectiveDatePrecision: 'YEAR',
            effectiveDateSource: 'FOLDER_RULE',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: null,
          },
        ]),
      },
    };

    const preview = await new FolderDateRuleService(prisma).preview('owner', 'root', {
      dateValue: new Date('2005-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      scope: 'FALLBACK_DESCENDANTS',
    });

    expect(preview).toEqual({
      scopePhotoCount: 0,
      willChangeCount: 0,
      unchangedCount: 0,
      preservesManualCount: 0,
      replacesAutomaticCount: 0,
      replacesFolderNameDateCount: 0,
    });
  });

  it('previews only photos in scope and reports preserved dates', async () => {
    const prisma: any = {
      indexedFolder: {
        findFirst: vi.fn(async () => ({ id: 'root', userId: 'owner', sourceId: 'source' })),
        findMany: vi.fn(async () => [
          { id: 'root', parentId: null, dateRule: null },
          { id: 'child', parentId: 'root', dateRule: null },
          { id: 'sibling', parentId: null, dateRule: null },
        ]),
      },
      photo: {
        findMany: vi.fn(async () => [
          {
            id: 'unknown',
            folderId: 'root',
            effectiveDateValue: null,
            effectiveDatePrecision: 'UNKNOWN',
            effectiveDateSource: 'NONE',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: null,
          },
          {
            id: 'folder-name-date',
            folderId: 'child',
            effectiveDateValue: new Date('1998-01-01T00:00:00.000Z'),
            effectiveDatePrecision: 'YEAR',
            effectiveDateSource: 'FOLDER',
            detectedDate: new Date('1998-01-01T00:00:00.000Z'),
            detectedPrecision: 'YEAR',
            detectedSource: 'FOLDER',
            override: null,
          },
          {
            id: 'camera-date',
            folderId: 'child',
            effectiveDateValue: new Date('2010-05-01T00:00:00.000Z'),
            effectiveDatePrecision: 'MONTH',
            effectiveDateSource: 'DRIVE_IMAGE_METADATA',
            detectedDate: new Date('2010-05-01T00:00:00.000Z'),
            detectedPrecision: 'MONTH',
            detectedSource: 'DRIVE_IMAGE_METADATA',
            override: null,
          },
          {
            id: 'manual-date',
            folderId: 'child',
            effectiveDateValue: new Date('1999-01-01T00:00:00.000Z'),
            effectiveDatePrecision: 'YEAR',
            effectiveDateSource: 'MANUAL',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: {
              dateValue: new Date('1999-01-01T00:00:00.000Z'),
              precision: 'YEAR',
            },
          },
          {
            id: 'outside-scope',
            folderId: 'sibling',
            effectiveDateValue: null,
            effectiveDatePrecision: 'UNKNOWN',
            effectiveDateSource: 'NONE',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: null,
          },
        ]),
      },
    };

    const preview = await new FolderDateRuleService(prisma).preview('owner', 'root', {
      dateValue: new Date('2005-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      scope: 'FALLBACK_DESCENDANTS',
    });

    expect(preview).toEqual({
      scopePhotoCount: 4,
      willChangeCount: 2,
      unchangedCount: 2,
      preservesManualCount: 1,
      replacesAutomaticCount: 1,
      replacesFolderNameDateCount: 1,
    });
  });

  it('recalculates existing photos without replacing detected or manual dates', async () => {
    let rootRule: any = null;
    const updates: any[] = [];
    const prisma: any = {
      indexedFolder: {
        findFirst: vi.fn(async () => ({ id: 'root', userId: 'owner', sourceId: 'source' })),
        findMany: vi.fn(async () => [
          { id: 'root', parentId: null, dateRule: rootRule },
          { id: 'child', parentId: 'root', dateRule: null },
        ]),
      },
      folderDateRule: {
        upsert: vi.fn(async ({ create }: any) => {
          rootRule = { id: 'rule', ...create };
          return rootRule;
        }),
      },
      photo: {
        findMany: vi.fn(async () => [
          {
            id: 'unknown',
            folderId: 'child',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: null,
          },
          {
            id: 'detected',
            folderId: 'child',
            detectedDate: new Date('2010-05-09T00:00:00.000Z'),
            detectedPrecision: 'MONTH',
            detectedSource: 'DRIVE_IMAGE_METADATA',
            override: null,
          },
          {
            id: 'manual',
            folderId: 'child',
            detectedDate: null,
            detectedPrecision: 'UNKNOWN',
            detectedSource: 'NONE',
            override: {
              dateValue: new Date('1999-01-01T00:00:00.000Z'),
              precision: 'YEAR',
            },
          },
        ]),
        updateMany: vi.fn(async (args: any) => updates.push(args)),
      },
    };

    const result = await new FolderDateRuleService(prisma).set('owner', 'root', {
      dateValue: new Date('2005-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      scope: 'FALLBACK_DESCENDANTS',
    });

    expect(result.affectedCount).toBe(3);
    expect(updates.map((update) => update.data.effectiveDateSource)).toEqual([
      'FOLDER_RULE',
      'DRIVE_IMAGE_METADATA',
      'MANUAL',
    ]);
  });

  const flagsCases = [
    [true, false, 'FALLBACK_DESCENDANTS'],
    [true, true, 'ALL_DESCENDANTS'],
    [false, false, 'DIRECT_ONLY'],
    [false, true, 'DIRECT_OVERRIDE'],
  ] as const;

  it.each(flagsCases)(
    'maps includeSubfolders=%s overrideCameraDates=%s to %s and back',
    async (includeSubfolders, overrideCameraDates, scope) => {
      const prisma: any = {
        indexedFolder: {
          findFirst: vi.fn(async () => ({ id: 'root', userId: 'owner', sourceId: 'source' })),
          findMany: vi.fn(async () => [{ id: 'root', parentId: null, dateRule: null }]),
        },
        folderDateRule: {
          upsert: vi.fn(async ({ create }: any) => ({ id: 'rule', ...create })),
        },
        photo: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
      };
      const result = await new FolderDateRuleService(prisma).setSimple('owner', 'root', {
        dateValue: new Date('2005-06-07T00:00:00.000Z'),
        precision: 'DAY',
        includeSubfolders,
        overrideCameraDates,
      });
      expect(prisma.folderDateRule.upsert.mock.calls[0][0].create).toMatchObject({
        precision: 'DAY',
        scope,
      });
      expect(result.rule).toMatchObject({
        precision: 'DAY',
        includeSubfolders,
        overrideCameraDates,
      });
    },
  );

  it('applies each flag combination to the right photos and only rewrites changed ones', async () => {
    const photo = (
      id: string,
      folderId: string,
      detectedSource: string,
      detected: string | null,
    ) => ({
      id,
      folderId,
      detectedDate: detected ? new Date(detected) : null,
      detectedPrecision: detected ? 'DAY' : 'UNKNOWN',
      detectedSource,
      effectiveDateValue: detected ? new Date(detected) : null,
      effectiveDatePrecision: detected ? 'DAY' : 'UNKNOWN',
      effectiveDateSource: detected ? detectedSource : 'NONE',
      hiddenAt: null,
      override: null,
    });
    const photos = [
      photo('direct-undated', 'root', 'NONE', null),
      photo('direct-camera', 'root', 'EXIF', '2010-05-09T00:00:00.000Z'),
      photo('child-undated', 'child', 'NONE', null),
      photo('child-camera', 'child', 'EXIF', '2011-06-10T00:00:00.000Z'),
    ];
    const run = async (includeSubfolders: boolean, overrideCameraDates: boolean) => {
      const updates: any[] = [];
      const prisma: any = {
        indexedFolder: {
          findFirst: vi.fn(async () => ({ id: 'root', userId: 'owner', sourceId: 'source' })),
          findMany: vi.fn(async () => [
            { id: 'root', parentId: null, dateRule: null },
            { id: 'child', parentId: 'root', dateRule: null },
          ]),
        },
        folderDateRule: { upsert: vi.fn(async ({ create }: any) => create) },
        photo: {
          findMany: vi.fn(async () => photos),
          updateMany: vi.fn(async (args: any) => updates.push(args)),
        },
      };
      // The rule stored by the upsert is what the next evaluation sees.
      prisma.folderDateRule.upsert.mockImplementation(async ({ create }: any) => {
        prisma.indexedFolder.findMany.mockResolvedValue([
          { id: 'root', parentId: null, dateRule: create },
          { id: 'child', parentId: 'root', dateRule: null },
        ]);
        return create;
      });
      const result = await new FolderDateRuleService(prisma).setSimple('owner', 'root', {
        dateValue: new Date('2005-06-07T00:00:00.000Z'),
        precision: 'DAY',
        includeSubfolders,
        overrideCameraDates,
      });
      return {
        affected: result.affectedCount,
        written: updates.flatMap((update) => update.where.id.in).sort(),
      };
    };
    expect(await run(true, false)).toEqual({
      affected: 2,
      written: ['child-undated', 'direct-undated'],
    });
    expect(await run(true, true)).toEqual({
      affected: 4,
      written: ['child-camera', 'child-undated', 'direct-camera', 'direct-undated'],
    });
    expect(await run(false, false)).toEqual({ affected: 1, written: ['direct-undated'] });
    expect(await run(false, true)).toEqual({
      affected: 2,
      written: ['direct-camera', 'direct-undated'],
    });
  });

  it('does not count hidden photos in the preview or the affected count', async () => {
    const hidden = {
      id: 'hidden',
      folderId: 'root',
      effectiveDateValue: null,
      effectiveDatePrecision: 'UNKNOWN',
      effectiveDateSource: 'NONE',
      detectedDate: null,
      detectedPrecision: 'UNKNOWN',
      detectedSource: 'NONE',
      hiddenAt: new Date(),
      override: null,
    };
    const prisma: any = {
      indexedFolder: {
        findFirst: vi.fn(async () => ({ id: 'root', userId: 'owner', sourceId: 'source' })),
        findMany: vi.fn(async () => [{ id: 'root', parentId: null, dateRule: null }]),
      },
      photo: { findMany: vi.fn(async () => [hidden]), updateMany: vi.fn() },
    };
    const preview = await new FolderDateRuleService(prisma).previewSimple('owner', 'root', {
      dateValue: new Date('2005-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      includeSubfolders: true,
      overrideCameraDates: false,
    });
    expect(preview.scopePhotoCount).toBe(0);
  });
});
