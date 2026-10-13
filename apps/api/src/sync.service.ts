import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  DatePrecision,
  DateSource,
  FolderDateRuleScope,
  PhotoStatus,
  Prisma,
  SyncIssueCode,
  SyncIssueSeverity,
  SyncPhase,
  SyncRunStatus,
  TakeoutMatchStatus,
} from '@prisma/client';
import { JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DriveAdapter, DriveItem, DriveRequestError, isFolder, isImage } from './drive';
import { PhotoDateResolver } from './date-resolver';
import { PrismaService } from './prisma.service';
import { TakeoutMatcher, TakeoutMetadata, TakeoutMetadataParser } from './takeout';
import { effectiveDate } from './manual-date.service';

const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000, jitter: 0.25 },
  removeOnComplete: true,
  removeOnFail: true,
};

/** Creates a BullMQ-safe, deterministic identifier for one source sync run. */
export const syncJobId = (sourceId: string, runId: string) => {
  const source = Buffer.from(sourceId).toString('base64url');
  const run = Buffer.from(runId).toString('base64url');
  return `sync-s${source.length}-${source}r${run.length}-${run}`;
};

type TakeoutCandidate = { fileName: string; metadata: TakeoutMetadata };
type FolderWork = {
  id: string;
  path: string[];
  parentDriveFolderId?: string;
  cursor?: string;
  takeout?: { candidates: TakeoutCandidate[]; cursor?: string; complete: boolean; bytes: number };
};
type Checkpoint = { pendingFolders: FolderWork[]; seenFolders: string[] };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SyncService {
  private producer?: Queue;
  private producerConnection?: IORedis;
  private closing?: Promise<void>;

  private queue() {
    if (this.closing) throw new Error('Sync producer is shutting down.');
    if (!this.producer) {
      const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
      });
      this.producerConnection = connection;
      connection.on('error', () =>
        console.error(JSON.stringify({ event: 'sync_producer_redis_error' })),
      );
      try {
        this.producer = new Queue('photo-sync', { connection });
        this.producer.on('error', () =>
          console.error(JSON.stringify({ event: 'sync_producer_error' })),
        );
      } catch (error) {
        connection.disconnect();
        this.producerConnection = undefined;
        throw error;
      }
    }
    return this.producer;
  }

  onModuleDestroy() {
    this.closing ??= (async () => {
      try {
        await this.producer?.close();
      } finally {
        // BullMQ does not own an externally supplied Redis client.
        this.producerConnection?.disconnect();
      }
    })();
    return this.closing;
  }

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(DriveAdapter)
    private readonly drive: DriveAdapter,
    @Inject(PhotoDateResolver)
    private readonly dates: PhotoDateResolver,
    @Inject(TakeoutMetadataParser)
    private readonly takeoutParser = new TakeoutMetadataParser(),
    @Inject(TakeoutMatcher)
    private readonly takeoutMatcher = new TakeoutMatcher(),
  ) {}

  async enqueue(userId: string, sourceId: string) {
    const source = await this.prisma.photoSource.findFirst({
      where: { id: sourceId, userId, status: 'ACTIVE' },
    });
    if (!source)
      throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: 'Photo source not found.' });
    let run = await this.prisma.syncRun.findFirst({
      where: { photoSourceId: source.id, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      try {
        run = await this.prisma.syncRun.create({ data: { photoSourceId: source.id } });
      } catch {
        run = await this.prisma.syncRun.findFirst({
          where: { photoSourceId: source.id, status: { in: ['QUEUED', 'RUNNING'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (!run) throw new Error('Could not create a sync run.');
      }
    }
    try {
      await this.queue().add(
        'scan',
        { syncRunId: run.id },
        { ...jobOptions, jobId: syncJobId(source.id, run.id) },
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'SYNC_ENQUEUE_FAILED',
        message: 'The sync could not be queued. Please try again.',
      });
    }
    return run;
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (
          !(error instanceof DriveRequestError) ||
          ![429, 500, 502, 503, 504].includes(error.status)
        )
          throw error;
        if (attempt === 2) throw error;
        const exponential = 1_000 * 2 ** attempt;
        const delay = error.retryAfterMs ?? Math.round(exponential * (0.75 + Math.random() * 0.25));
        await wait(Math.min(delay, 60_000));
      }
    }
  }

  private async persist(
    runId: string,
    checkpoint: Checkpoint,
    counts: { found: number; processed: number; indexed: number; issues: number },
  ) {
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: {
        phase: SyncPhase.SCANNING,
        checkpoint,
        cursorCompletedAt: checkpoint.pendingFolders[0]?.cursor ?? null,
        foundCount: counts.found,
        processedCount: counts.processed,
        scannedCount: counts.found,
        indexedCount: counts.indexed,
        issueCount: counts.issues,
      },
    });
  }

  async execute(syncRunId: string) {
    const run = await this.prisma.syncRun.findUnique({
      where: { id: syncRunId },
      include: { source: { include: { connection: true } } },
    });
    if (!run || run.status === SyncRunStatus.SUCCEEDED) return;
    await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'RUNNING' } });
    const saved = run.checkpoint as Checkpoint | null;
    let checkpoint: Checkpoint;
    if (saved) checkpoint = saved;
    else {
      let root: DriveItem | null;
      try {
        root = await this.retry(() =>
          this.drive.getFolder(run.source.connection, run.source.driveFolderId),
        );
      } catch (error) {
        if (error instanceof DriveRequestError && error.status === 404)
          await this.prisma.indexedFolder.updateMany({
            where: { sourceId: run.source.id },
            data: { status: 'MISSING' },
          });
        const transient =
          error instanceof DriveRequestError && [429, 500, 502, 503, 504].includes(error.status);
        if (transient) throw error;
        await this.prisma.syncIssue.create({
          data: {
            syncRunId: run.id,
            code: SyncIssueCode.ACCESS_DENIED,
            severity: SyncIssueSeverity.ERROR,
            details: 'The configured root folder is unavailable.',
          },
        });
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', issueCount: run.issueCount + 1 },
        });
        return;
      }
      if (!root || !isFolder(root)) {
        await this.prisma.indexedFolder.updateMany({
          where: { sourceId: run.source.id },
          data: { status: 'MISSING' },
        });
        await this.prisma.syncIssue.create({
          data: {
            syncRunId: run.id,
            code: SyncIssueCode.ACCESS_DENIED,
            severity: SyncIssueSeverity.ERROR,
            details: 'The configured root folder is unavailable.',
          },
        });
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', issueCount: run.issueCount + 1 },
        });
        return;
      }
      checkpoint = {
        pendingFolders: [{ id: root.id, path: [root.name] }],
        seenFolders: [],
      };
    }
    const maxFolders = Math.max(100, Number(process.env.SYNC_MAX_PENDING_FOLDERS ?? 10_000));
    const counts = {
      found: run.foundCount,
      processed: run.processedCount,
      indexed: run.indexedCount,
      issues: run.issueCount,
    };
    let partial = run.issueCount > 0;
    const issue = async (
      code: SyncIssueCode,
      severity: SyncIssueSeverity,
      details: string,
      driveFileId?: string,
    ) => {
      counts.issues++;
      partial = true;
      await this.prisma.syncIssue.create({
        data: { syncRunId: run.id, code, severity, details, driveFileId },
      });
    };
    const index = async (
      item: DriveItem,
      folder: FolderWork,
      indexedFolderId: string,
      folderRule: {
        dateValue: Date;
        precision: DatePrecision;
        scope: FolderDateRuleScope;
      } | null,
      candidates: Array<{ fileName: string; metadata: TakeoutMetadata }>,
    ) => {
      const excluded = await this.prisma.photoExclusion.findUnique({
        where: { userId_driveFileId: { userId: run.source.userId, driveFileId: item.id } },
      });
      if (excluded) return false;
      const match =
        run.source.type === 'GOOGLE_TAKEOUT'
          ? this.takeoutMatcher.match(item.name, candidates)
          : { status: 'NOT_APPLICABLE' as const, reason: 'source-is-generic', metadata: undefined };
      if (match.status === 'TAKEOUT_AMBIGUOUS')
        await issue(
          SyncIssueCode.AMBIGUOUS_TAKEOUT_MATCH,
          SyncIssueSeverity.WARNING,
          'Takeout metadata match was ambiguous.',
          item.id,
        );
      const detected = this.dates.resolve({
        driveImageTime: item.imageTime,
        takeoutPhotoTakenTime: match.metadata?.photoTakenTime
          ? new Date(Number(match.metadata.photoTakenTime) * 1000).toISOString()
          : undefined,
        folderSegments: folder.path,
      });
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.photo.findUnique({
          where: { userId_driveFileId: { userId: run.source.userId, driveFileId: item.id } },
          include: { override: true },
        });
        const effective = effectiveDate({
          detectedDate: detected.value,
          detectedPrecision: detected.precision as DatePrecision,
          detectedSource: detected.source as DateSource,
          folderRule,
          override: existing?.override,
        });
        const data = {
          sourceId: run.source.id,
          folderId: indexedFolderId,
          fileName: item.name,
          mimeType: item.mimeType,
          status: PhotoStatus.ACTIVE,
          lastSeenSyncRunId: run.id,
          detectedDate: detected.value,
          detectedPrecision: detected.precision as DatePrecision,
          detectedSource: detected.source as DateSource,
          takeoutMatchStatus: match.status as TakeoutMatchStatus,
          takeoutMatchReason: match.reason,
          gpsLatitude: match.metadata?.location?.latitude ?? null,
          gpsLongitude: match.metadata?.location?.longitude ?? null,
        };
        if (existing)
          await tx.photo.update({
            where: { id: existing.id },
            data: {
              ...data,
              effectiveDateValue: effective.value,
              effectiveDatePrecision: effective.precision as DatePrecision,
              effectiveDateSource: effective.origin as DateSource,
            },
          });
        else
          await tx.photo.create({
            data: {
              userId: run.source.userId,
              driveFileId: item.id,
              ...data,
              effectiveDateValue: effective.value,
              effectiveDatePrecision: effective.precision as DatePrecision,
              effectiveDateSource: effective.origin as DateSource,
            },
          });
      });
      counts.indexed++;
      return true;
    };
    try {
      while (checkpoint.pendingFolders.length) {
        const folder = checkpoint.pendingFolders[0]!;
        if (!folder.cursor && !folder.takeout && checkpoint.seenFolders.includes(folder.id)) {
          checkpoint.pendingFolders.shift();
          continue;
        }
        const parent = folder.parentDriveFolderId
          ? await this.prisma.indexedFolder.findUnique({
              where: {
                userId_driveFolderId: {
                  userId: run.source.userId,
                  driveFolderId: folder.parentDriveFolderId,
                },
              },
            })
          : null;
        const indexedFolder = await this.prisma.indexedFolder.upsert({
          where: {
            userId_driveFolderId: { userId: run.source.userId, driveFolderId: folder.id },
          },
          create: {
            userId: run.source.userId,
            sourceId: run.source.id,
            driveFolderId: folder.id,
            parentId: parent?.id ?? null,
            name: folder.path.at(-1)!,
            path: folder.path,
            status: 'ACTIVE',
            lastSeenSyncRunId: run.id,
          },
          update: {
            sourceId: run.source.id,
            parentId: parent?.id ?? null,
            name: folder.path.at(-1)!,
            path: folder.path,
            status: 'ACTIVE',
            lastSeenSyncRunId: run.id,
          },
          include: { dateRule: true },
        });
        let folderRule = indexedFolder.dateRule ?? null;
        let ancestorId = parent?.id ?? null;
        const visited = new Set([indexedFolder.id]);
        // A resumed checkpoint may never revisit its ancestors in this process.
        while (!folderRule && ancestorId && !visited.has(ancestorId)) {
          visited.add(ancestorId);
          const ancestor = await this.prisma.indexedFolder.findFirst({
            where: { id: ancestorId, userId: run.source.userId, sourceId: run.source.id },
            include: { dateRule: true },
          });
          if (!ancestor) break;
          if (ancestor.dateRule?.scope !== 'DIRECT_ONLY') folderRule = ancestor.dateRule;
          ancestorId = ancestor.parentId;
        }
        // Collect metadata across the entire folder before matching any image page.
        // Only the current folder carries this bounded, resumable metadata checkpoint.
        if (run.source.type === 'GOOGLE_TAKEOUT') {
          folder.takeout ??= { candidates: [], complete: false, bytes: 0 };
          const metadata = folder.takeout;
          while (!metadata.complete) {
            const metadataPage = await this.retry(() =>
              this.drive.listChildren(run.source.connection, folder.id, metadata.cursor),
            );
            const additions: TakeoutCandidate[] = [];
            const invalid: string[] = [];
            let addedBytes = 0;
            for (const sidecar of metadataPage.items.filter((entry) =>
              /\.json$/i.test(entry.name),
            )) {
              const text = await this.retry(async () => {
                const media = await this.drive.getContentStream(run.source.connection, sidecar.id);
                const chunks: Buffer[] = [];
                let size = 0;
                try {
                  for await (const chunk of media.stream) {
                    size += Buffer.byteLength(chunk);
                    if (size > 1024 * 1024) return null;
                    chunks.push(Buffer.from(chunk));
                  }
                } catch (error) {
                  // A broken body is a transport failure, not evidence of invalid JSON.
                  if (error instanceof DriveRequestError) throw error;
                  throw new DriveRequestError(503, 'Takeout metadata stream failed.');
                }
                return Buffer.concat(chunks).toString('utf8');
              });
              const parsed = text === null ? null : this.takeoutParser.parse(text);
              if (parsed?.kind === 'VALID') {
                const candidate = { fileName: sidecar.name, metadata: parsed.metadata };
                addedBytes += Buffer.byteLength(JSON.stringify(candidate));
                additions.push(candidate);
              } else invalid.push(sidecar.id);
              if (
                metadata.candidates.length + additions.length > 10_000 ||
                metadata.bytes + addedBytes > 8 * 1024 * 1024
              ) {
                await issue(
                  SyncIssueCode.LIMIT_REACHED,
                  SyncIssueSeverity.ERROR,
                  'The Takeout folder metadata safety limit was reached.',
                );
                await this.persist(run.id, checkpoint, counts);
                await this.prisma.syncRun.update({
                  where: { id: run.id },
                  data: { status: 'PARTIAL' },
                });
                return;
              }
            }
            for (const id of invalid)
              await issue(
                SyncIssueCode.INVALID_TAKEOUT_JSON,
                SyncIssueSeverity.WARNING,
                'Takeout metadata JSON was invalid.',
                id,
              );
            metadata.candidates.push(...additions);
            metadata.bytes += addedBytes;
            metadata.complete = !metadataPage.nextCursor;
            if (metadataPage.nextCursor) metadata.cursor = metadataPage.nextCursor;
            else delete metadata.cursor;
            await this.persist(run.id, checkpoint, counts);
          }
        }
        const candidates = folder.takeout?.candidates ?? [];
        const page = await this.retry(() =>
          this.drive.listChildren(run.source.connection, folder.id, folder.cursor),
        );
        const images = page.items.filter(isImage);
        counts.found += images.length;
        for (const child of page.items.filter(isFolder)) {
          if (!checkpoint.seenFolders.includes(child.id))
            checkpoint.pendingFolders.push({
              id: child.id,
              path: [...folder.path, child.name],
              parentDriveFolderId: folder.id,
            });
        }
        if (checkpoint.pendingFolders.length > maxFolders) {
          await issue(
            SyncIssueCode.UNKNOWN,
            SyncIssueSeverity.ERROR,
            'The configured pending-folder safety limit was reached.',
          );
          break;
        }
        const concurrency = Math.min(
          10,
          Math.max(5, Number(process.env.SYNC_ITEM_CONCURRENCY ?? 5)),
        );
        for (let offset = 0; offset < images.length; offset += concurrency) {
          await Promise.all(
            images.slice(offset, offset + concurrency).map(async (item) => {
              try {
                await index(item, folder, indexedFolder.id, folderRule, candidates);
                counts.processed++;
              } catch {
                counts.processed++;
                await issue(
                  SyncIssueCode.UNREADABLE_METADATA,
                  SyncIssueSeverity.WARNING,
                  'The file could not be indexed.',
                  item.id,
                );
              }
            }),
          );
        }
        if (page.nextCursor) folder.cursor = page.nextCursor;
        else {
          checkpoint.seenFolders.push(folder.id);
          checkpoint.pendingFolders.shift();
        }
        await this.persist(run.id, checkpoint, counts);
      }
      const status =
        partial || checkpoint.pendingFolders.length
          ? SyncRunStatus.PARTIAL
          : SyncRunStatus.SUCCEEDED;
      if (status === SyncRunStatus.SUCCEEDED) {
        await this.prisma.$transaction([
          this.prisma.photo.updateMany({
            where: { sourceId: run.source.id, lastSeenSyncRunId: { not: run.id } },
            data: { status: PhotoStatus.MISSING },
          }),
          this.prisma.indexedFolder.updateMany({
            where: { sourceId: run.source.id, lastSeenSyncRunId: { not: run.id } },
            data: { status: 'MISSING' },
          }),
        ]);
      }
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status,
          phase: SyncPhase.PROCESSING,
          checkpoint: Prisma.JsonNull,
          cursorCompletedAt: null,
          foundCount: counts.found,
          processedCount: counts.processed,
          scannedCount: counts.found,
          indexedCount: counts.indexed,
          issueCount: counts.issues,
        },
      });
    } catch (error) {
      const transient =
        error instanceof DriveRequestError && [429, 500, 502, 503, 504].includes(error.status);
      if (!transient)
        await issue(
          SyncIssueCode.ACCESS_DENIED,
          SyncIssueSeverity.ERROR,
          'Drive access was denied or the request was invalid.',
        );
      await this.persist(run.id, checkpoint, counts);
      if (!transient)
        await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED' } });
      if (transient) throw error;
    }
  }

  async failExhausted(syncRunId: string) {
    await this.prisma.syncRun.updateMany({
      where: { id: syncRunId, status: 'RUNNING' },
      data: { status: 'FAILED' },
    });
  }
}
