import { describe, expect, it, vi } from 'vitest';
import { FolderDateRuleService } from '../src/folder-date-rule.service';

describe('FolderDateRuleService', () => {
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
        update: vi.fn(async (args: any) => updates.push(args)),
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
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
});
