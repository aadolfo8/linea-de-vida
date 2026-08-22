import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class RetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async purge(now = new Date()) {
    const issueDays = retentionDays(process.env.SYNC_ISSUE_RETENTION_DAYS, 30);
    const runDays = retentionDays(process.env.SYNC_RUN_RETENTION_DAYS, 90);
    const issueCutoff = new Date(now.getTime() - issueDays * 86_400_000);
    const runCutoff = new Date(now.getTime() - runDays * 86_400_000);
    const issues = await this.prisma.syncIssue.deleteMany({
      where: { createdAt: { lt: issueCutoff } },
    });
    const staleRuns = await this.prisma.syncRun.findMany({
      where: {
        status: { in: ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'] },
        createdAt: { lt: runCutoff },
      },
      select: { id: true },
    });
    if (staleRuns.length)
      await this.prisma.syncIssue.deleteMany({
        where: { syncRunId: { in: staleRuns.map((run) => run.id) } },
      });
    const runs = staleRuns.length
      ? await this.prisma.syncRun.deleteMany({
          where: { id: { in: staleRuns.map((run) => run.id) } },
        })
      : { count: 0 };
    return { issuesDeleted: issues.count, runsDeleted: runs.count };
  }
}

function retentionDays(value: string | undefined, fallback: number) {
  const days = Number(value ?? fallback);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error('Retention days must be 1–3650.');
  return days;
}
