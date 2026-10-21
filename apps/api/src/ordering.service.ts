import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DateSource, Prisma } from '@prisma/client';
import { FilenameDateKind, parseFilenameDate } from './filename-date';
import { FolderWithRule, applicableRule, flagsFromScope } from './folder-rule-scope';
import { effectiveDate } from './manual-date.service';
import { chunk, parsePhotoIds } from './photo-ids';
import { readPhotoDimensions } from './photo-dimensions';
import { PrismaService } from './prisma.service';

export const PILES = ['undated', 'yearOnly', 'dated', 'hidden'] as const;
export type Pile = (typeof PILES)[number];
export const PHOTO_ORDERS = ['newest', 'name'] as const;
type PhotoOrder = (typeof PHOTO_ORDERS)[number];

export type OrderingScope = { sourceId?: string; folderId?: string; includeSubfolders?: boolean };

const FILENAME_KINDS: FilenameDateKind[] = [
  'whatsapp',
  'android-camera',
  'pixel',
  'screenshot',
  'messenger',
  'timestamp',
];

/** Where a date came from, as the screen groups it: camera, Google Fotos, name, folder, by hand. */
export const originKind = (source: DateSource) =>
  source === 'EXIF' || source === 'DRIVE_IMAGE_METADATA'
    ? 'camera'
    : source === 'TAKEOUT'
      ? 'google'
      : source === 'FILENAME'
        ? 'filename'
        : source === 'FOLDER' || source === 'FOLDER_RULE'
          ? 'folder'
          : source === 'MANUAL'
            ? 'manual'
            : 'none';

const notFound = (code: string, message: string) => new NotFoundException({ code, message });
const invalid = (code: string, message: string) => new BadRequestException({ code, message });

/** Photos still to date: no date at all, or only a year. */
const TO_DATE = ['UNKNOWN', 'YEAR'] as const;

const pileWhere = (pile: Pile): Prisma.PhotoWhereInput =>
  pile === 'hidden'
    ? { hiddenAt: { not: null } }
    : pile === 'undated'
      ? { hiddenAt: null, effectiveDateValue: null }
      : pile === 'yearOnly'
        ? { hiddenAt: null, effectiveDateValue: { not: null }, effectiveDatePrecision: 'YEAR' }
        : { hiddenAt: null, effectiveDatePrecision: { in: ['MONTH', 'DAY'] } };

export type FolderNode = {
  id: string;
  name: string;
  path: string[];
  parentId: string | null;
  depth: number;
  photoCount: number;
  toDateCount: number;
  subtreePhotoCount: number;
  subtreeToDateCount: number;
  dateRule: {
    dateValue: Date;
    precision: string;
    scope: string;
    includeSubfolders: boolean;
    overrideCameraDates: boolean;
  } | null;
  children: FolderNode[];
};

/** Read side of the "Ordenar" screen: piles, folder tree, photo lists and filename suggestions. */
@Injectable()
export class OrderingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- scope ---------------------------------------------------------------------------------

  /** Validates ownership of the optional source/folder filters and turns them into a photo filter. */
  private async scope(userId: string, scope: OrderingScope): Promise<Prisma.PhotoWhereInput> {
    const where: Prisma.PhotoWhereInput = { userId, status: 'ACTIVE' };
    if (scope.sourceId) {
      const source = await this.prisma.photoSource.findFirst({
        where: { id: scope.sourceId, userId },
        select: { id: true },
      });
      if (!source) throw notFound('SOURCE_NOT_FOUND', 'Photo source not found.');
      where.sourceId = scope.sourceId;
    }
    if (scope.folderId) {
      const folder = await this.prisma.indexedFolder.findFirst({
        where: {
          id: scope.folderId,
          userId,
          ...(scope.sourceId ? { sourceId: scope.sourceId } : {}),
        },
        select: { id: true, sourceId: true },
      });
      if (!folder) throw notFound('FOLDER_NOT_FOUND', 'Indexed folder not found.');
      const ids =
        scope.includeSubfolders === false
          ? [folder.id]
          : await this.subtreeIds(userId, folder.sourceId, folder.id);
      where.folderId = ids.length === 1 ? ids[0] : { in: ids };
    }
    return where;
  }

  private async subtreeIds(userId: string, sourceId: string, rootId: string) {
    const folders = await this.prisma.indexedFolder.findMany({
      where: { userId, sourceId },
      select: { id: true, parentId: true },
    });
    const children = new Map<string, string[]>();
    for (const folder of folders)
      if (folder.parentId)
        children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder.id]);
    const ids = [rootId];
    for (let index = 0; index < ids.length; index++) ids.push(...(children.get(ids[index]!) ?? []));
    return ids;
  }

  // ---- piles ---------------------------------------------------------------------------------

  async piles(userId: string, scope: OrderingScope) {
    const base = await this.scope(userId, scope);
    const [undated, yearOnly, dated, hidden] = await Promise.all(
      PILES.map((pile) => this.prisma.photo.count({ where: { ...base, ...pileWhere(pile) } })),
    );
    return { undated, yearOnly, dated, hidden, total: undated! + yearOnly! + dated! };
  }

  // ---- folder tree ---------------------------------------------------------------------------

  private async buildTree(userId: string, sourceId: string) {
    const [folders, totals, pending, unfiled, unfiledPending] = await Promise.all([
      this.prisma.indexedFolder.findMany({
        where: { userId, sourceId, status: 'ACTIVE' },
        include: { dateRule: true },
      }),
      this.prisma.photo.groupBy({
        by: ['folderId'],
        where: { userId, sourceId, status: 'ACTIVE', hiddenAt: null, folderId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.photo.groupBy({
        by: ['folderId'],
        where: {
          userId,
          sourceId,
          status: 'ACTIVE',
          hiddenAt: null,
          folderId: { not: null },
          effectiveDatePrecision: { in: [...TO_DATE] },
        },
        _count: { _all: true },
      }),
      this.prisma.photo.count({
        where: { userId, sourceId, status: 'ACTIVE', hiddenAt: null, folderId: null },
      }),
      this.prisma.photo.count({
        where: {
          userId,
          sourceId,
          status: 'ACTIVE',
          hiddenAt: null,
          folderId: null,
          effectiveDatePrecision: { in: [...TO_DATE] },
        },
      }),
    ]);
    const totalByFolder = new Map(totals.map((group) => [group.folderId!, group._count._all]));
    const pendingByFolder = new Map(pending.map((group) => [group.folderId!, group._count._all]));
    const nodes = new Map<string, FolderNode>();
    for (const folder of folders) {
      const own = totalByFolder.get(folder.id) ?? 0;
      const ownPending = pendingByFolder.get(folder.id) ?? 0;
      nodes.set(folder.id, {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        parentId: folder.parentId,
        depth: 0,
        photoCount: own,
        toDateCount: ownPending,
        subtreePhotoCount: own,
        subtreeToDateCount: ownPending,
        dateRule: folder.dateRule
          ? {
              dateValue: folder.dateRule.dateValue,
              precision: folder.dateRule.precision,
              scope: folder.dateRule.scope,
              ...flagsFromScope(folder.dateRule.scope),
            }
          : null,
        children: [],
      });
    }
    const roots: FolderNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      // A folder whose parent is not indexed (or would form a cycle) is shown as a root.
      if (parent && !this.isAncestor(nodes, node.id, parent)) parent.children.push(node);
      else roots.push(node);
    }
    const byName = (a: FolderNode, b: FolderNode) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) ||
      a.id.localeCompare(b.id);
    // Post-order accumulation: children are added to their parent's subtree totals.
    const visit = (node: FolderNode, depth: number) => {
      node.depth = depth;
      node.children.sort(byName);
      for (const child of node.children) {
        visit(child, depth + 1);
        node.subtreePhotoCount += child.subtreePhotoCount;
        node.subtreeToDateCount += child.subtreeToDateCount;
      }
    };
    roots.sort(byName);
    for (const root of roots) visit(root, 0);
    return { nodes, roots, unfiled: { photoCount: unfiled, toDateCount: unfiledPending } };
  }

  /** Whether `candidate` is `nodeId` itself or one of its descendants (cycle guard). */
  private isAncestor(nodes: Map<string, FolderNode>, nodeId: string, candidate: FolderNode) {
    const seen = new Set<string>();
    let current: FolderNode | undefined = candidate;
    while (current && !seen.has(current.id)) {
      if (current.id === nodeId) return true;
      seen.add(current.id);
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }
    return false;
  }

  async folderTree(userId: string, sourceId: string) {
    const source = await this.prisma.photoSource.findFirst({
      where: { id: sourceId, userId },
      select: { id: true },
    });
    if (!source) throw notFound('SOURCE_NOT_FOUND', 'Photo source not found.');
    const { roots, nodes, unfiled } = await this.buildTree(userId, sourceId);
    return {
      sourceId,
      folderCount: nodes.size,
      items: roots,
      unfiled,
      totals: {
        photoCount:
          roots.reduce((sum, root) => sum + root.subtreePhotoCount, 0) + unfiled.photoCount,
        toDateCount:
          roots.reduce((sum, root) => sum + root.subtreeToDateCount, 0) + unfiled.toDateCount,
      },
    };
  }

  /** One folder with its breadcrumb (root first) and its own and subtree counts. */
  async folder(userId: string, folderId: string) {
    const record = await this.prisma.indexedFolder.findFirst({
      where: { id: folderId, userId },
      select: { id: true, sourceId: true },
    });
    if (!record) throw notFound('FOLDER_NOT_FOUND', 'Indexed folder not found.');
    const { nodes } = await this.buildTree(userId, record.sourceId);
    const node = nodes.get(folderId);
    if (!node) throw notFound('FOLDER_NOT_FOUND', 'Indexed folder not found.');
    const breadcrumb: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    for (let current: FolderNode | undefined = node; current && !seen.has(current.id);) {
      seen.add(current.id);
      breadcrumb.unshift({ id: current.id, name: current.name });
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }
    const { children, ...own } = node;
    return {
      ...own,
      sourceId: record.sourceId,
      breadcrumb,
      childFolders: children.map((child) => ({
        id: child.id,
        name: child.name,
        subtreePhotoCount: child.subtreePhotoCount,
        subtreeToDateCount: child.subtreeToDateCount,
      })),
    };
  }

  // ---- photo lists ---------------------------------------------------------------------------

  private encodeCursor(scope: string, value: string | null, id: string) {
    return Buffer.from(JSON.stringify({ scope, value, id })).toString('base64url');
  }

  private decodeCursor(scope: string, cursor?: string) {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        scope?: unknown;
        value?: unknown;
        id?: unknown;
      };
      if (
        parsed.scope !== scope ||
        typeof parsed.id !== 'string' ||
        (parsed.value !== null && typeof parsed.value !== 'string')
      )
        throw new Error('invalid');
      return { value: parsed.value as string | null, id: parsed.id };
    } catch {
      throw invalid('INVALID_CURSOR', 'The cursor is invalid.');
    }
  }

  async photos(
    userId: string,
    query: OrderingScope & { pile?: string; order?: string; cursor?: string; limit?: string },
  ) {
    const pile = query.pile as Pile;
    if (!PILES.includes(pile))
      throw invalid('INVALID_PILE', `pile must be one of ${PILES.join(', ')}.`);
    const order = (query.order ?? (pile === 'undated' ? 'name' : 'newest')) as PhotoOrder;
    if (!PHOTO_ORDERS.includes(order))
      throw invalid('INVALID_ORDER', `order must be one of ${PHOTO_ORDERS.join(', ')}.`);
    let limit = 60;
    if (query.limit !== undefined) {
      if (!/^\d{1,9}$/.test(query.limit.trim()))
        throw invalid('INVALID_LIMIT', 'limit must be a whole number.');
      limit = Math.min(200, Math.max(1, Number(query.limit)));
    }
    const base = await this.scope(userId, query);
    const scopeKey = [
      pile,
      order,
      query.sourceId ?? '',
      query.folderId ?? '',
      query.includeSubfolders === false,
    ].join(':');
    const after = this.decodeCursor(scopeKey, query.cursor);
    if (after && order === 'newest' && after.value && Number.isNaN(Date.parse(after.value)))
      throw invalid('INVALID_CURSOR', 'The cursor is invalid.');

    const conditions: Prisma.PhotoWhereInput[] = [];
    if (after && order === 'name')
      conditions.push({
        OR: [
          { fileName: { gt: after.value ?? '' } },
          { fileName: after.value ?? '', id: { gt: after.id } },
        ],
      });
    if (after && order === 'newest') {
      // Newest first with undated photos last, so the keyset has to cross the null boundary.
      const date = after.value ? new Date(after.value) : null;
      conditions.push(
        date
          ? {
              OR: [
                { effectiveDateValue: { lt: date } },
                { effectiveDateValue: date, id: { lt: after.id } },
                { effectiveDateValue: null },
              ],
            }
          : { effectiveDateValue: null, id: { lt: after.id } },
      );
    }
    const records = await this.prisma.photo.findMany({
      where: { ...base, ...pileWhere(pile), ...(conditions.length ? { AND: conditions } : {}) },
      orderBy:
        order === 'name'
          ? [{ fileName: 'asc' }, { id: 'asc' }]
          : [{ effectiveDateValue: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = records.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((photo) => {
        const dimensions = readPhotoDimensions(photo.imageMetadata);
        return {
          id: photo.id,
          fileName: photo.fileName,
          thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
          ...(dimensions ? { dimensions } : {}),
          effectiveDate: {
            value: photo.effectiveDateValue,
            precision: photo.effectiveDatePrecision,
            origin: photo.effectiveDateSource,
            originKind: originKind(photo.effectiveDateSource),
          },
          hidden: photo.hiddenAt !== null,
          folderId: photo.folderId,
        };
      }),
      nextCursor:
        records.length > limit && last
          ? this.encodeCursor(
              scopeKey,
              order === 'name' ? last.fileName : (last.effectiveDateValue?.toISOString() ?? null),
              last.id,
            )
          : null,
    };
  }

  // ---- filename suggestions ------------------------------------------------------------------

  /**
   * Photos still to date whose file name carries a full date that would become their date.
   * New syncs apply file-name dates on their own; this finds the photos indexed before that
   * existed, or whose copies were indexed under a weaker source.
   */
  private async suggestionCandidates(userId: string, scope: OrderingScope, only?: Set<string>) {
    const base = await this.scope(userId, scope);
    const rulesBySource = new Map<string, Map<string, FolderWithRule>>();
    const found: Array<{ id: string; fileName: string; kind: FilenameDateKind; date: Date }> = [];
    let after: string | undefined;
    for (;;) {
      const photos = await this.prisma.photo.findMany({
        where: {
          ...base,
          hiddenAt: null,
          effectiveDatePrecision: { in: [...TO_DATE] },
          detectedSource: { in: ['NONE', 'FOLDER'] },
          override: { is: null },
          ...(after || only
            ? { id: { ...(only ? { in: [...only] } : {}), ...(after ? { gt: after } : {}) } }
            : {}),
        },
        orderBy: { id: 'asc' },
        take: 2_000,
        select: { id: true, fileName: true, folderId: true, sourceId: true },
      });
      for (const photo of photos) {
        const parsed = parseFilenameDate(photo.fileName);
        if (!parsed) continue;
        if (!rulesBySource.has(photo.sourceId))
          rulesBySource.set(
            photo.sourceId,
            new Map(
              (
                await this.prisma.indexedFolder.findMany({
                  where: { userId, sourceId: photo.sourceId },
                  include: { dateRule: true },
                })
              ).map((folder) => [folder.id, folder]),
            ),
          );
        // A folder date that overrides detected dates would win over the name: not a suggestion.
        const outcome = effectiveDate({
          detectedDate: parsed.value,
          detectedPrecision: 'DAY',
          detectedSource: 'FILENAME',
          folderRule: applicableRule(rulesBySource.get(photo.sourceId)!, photo.folderId),
          override: null,
        });
        if (outcome.origin === 'FILENAME')
          found.push({
            id: photo.id,
            fileName: photo.fileName,
            kind: parsed.kind,
            date: parsed.value,
          });
      }
      if (photos.length < 2_000) return found;
      after = photos.at(-1)!.id;
    }
  }

  async filenameSuggestions(userId: string, scope: OrderingScope) {
    const candidates = await this.suggestionCandidates(userId, scope);
    const groups = new Map<
      FilenameDateKind,
      {
        kind: FilenameDateKind;
        photoCount: number;
        earliest: Date;
        latest: Date;
        examples: Array<{ id: string; fileName: string; date: Date }>;
      }
    >();
    for (const candidate of candidates) {
      const group = groups.get(candidate.kind) ?? {
        kind: candidate.kind,
        photoCount: 0,
        earliest: candidate.date,
        latest: candidate.date,
        examples: [],
      };
      group.photoCount++;
      if (candidate.date < group.earliest) group.earliest = candidate.date;
      if (candidate.date > group.latest) group.latest = candidate.date;
      if (group.examples.length < 3)
        group.examples.push({
          id: candidate.id,
          fileName: candidate.fileName,
          date: candidate.date,
        });
      groups.set(candidate.kind, group);
    }
    return {
      totalCount: candidates.length,
      groups: [...groups.values()].sort(
        (a, b) => b.photoCount - a.photoCount || a.kind.localeCompare(b.kind),
      ),
    };
  }

  /**
   * Applies the file-name dates as detected dates (never as manual ones, so camera evidence found
   * later still wins and the origin stays "por su nombre").
   */
  async acceptFilenameSuggestions(
    userId: string,
    input: OrderingScope & { kinds?: unknown; photoIds?: unknown },
  ) {
    let kinds: Set<string> | undefined;
    if (input.kinds !== undefined && input.kinds !== null) {
      if (
        !Array.isArray(input.kinds) ||
        input.kinds.some((kind) => !FILENAME_KINDS.includes(kind as FilenameDateKind))
      )
        throw invalid(
          'INVALID_SUGGESTION_KINDS',
          `kinds must be a list of ${FILENAME_KINDS.join(', ')}.`,
        );
      kinds = new Set(input.kinds as string[]);
    }
    const only =
      input.photoIds === undefined || input.photoIds === null
        ? undefined
        : new Set(parsePhotoIds(input.photoIds));
    const candidates = (await this.suggestionCandidates(userId, input, only)).filter(
      (candidate) => !kinds || kinds.has(candidate.kind),
    );
    const byDate = new Map<number, { date: Date; ids: string[] }>();
    for (const candidate of candidates) {
      const entry = byDate.get(candidate.date.getTime()) ?? { date: candidate.date, ids: [] };
      entry.ids.push(candidate.id);
      byDate.set(candidate.date.getTime(), entry);
    }
    let appliedCount = 0;
    for (const { date, ids } of byDate.values())
      for (const batch of chunk(ids, 500)) {
        const result = await this.prisma.photo.updateMany({
          where: {
            id: { in: batch },
            userId,
            effectiveDatePrecision: { in: [...TO_DATE] },
            override: { is: null },
          },
          data: {
            detectedDate: date,
            detectedPrecision: 'DAY',
            detectedSource: 'FILENAME',
            effectiveDateValue: date,
            effectiveDatePrecision: 'DAY',
            effectiveDateSource: 'FILENAME',
          },
        });
        appliedCount += result.count;
      }
    return { appliedCount };
  }
}
