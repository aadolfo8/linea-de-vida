import { describe, expect, it, vi } from 'vitest';
import { FolderDateRuleService } from '../src/folder-date-rule.service';

describe('FolderDateRuleService', () => {
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
