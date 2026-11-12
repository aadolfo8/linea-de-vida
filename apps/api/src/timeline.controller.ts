import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { PrismaService } from './prisma.service';
import { MediaProxyService } from './media-proxy.service';
import { ManualDateInput, ManualDateService, photoDateResponse } from './manual-date.service';
import { compactPhoto } from './photo-summary';
import { readYearCovers, spread, COVER_LIMITS } from './covers';

@Controller('v1')
export class TimelineController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ManualDateService) private readonly manualDates: ManualDateService,
    @Inject(MediaProxyService) private readonly media: MediaProxyService,
  ) {}
  private cursor(scope: string, offset: number) {
    return Buffer.from(JSON.stringify({ scope, offset })).toString('base64url');
  }
  private page(cursor: string | undefined, rawLimit: string | undefined, scope: string) {
    const limit = Math.min(100, Math.max(1, Number(rawLimit ?? 30) || 30));
    if (!cursor) return { limit, offset: 0 };
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        scope?: string;
        offset?: unknown;
      };
      if (value.scope !== scope || !Number.isInteger(value.offset) || (value.offset as number) < 0)
        throw new Error('invalid');
      return { limit, offset: value.offset as number };
    } catch {
      throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'The cursor is invalid.' });
    }
  }
  private keysetCursor(scope: string, date: Date | null, id: string) {
    return Buffer.from(JSON.stringify({ scope, date: date?.toISOString() ?? null, id })).toString(
      'base64url',
    );
  }
  private timelineCursor(scope: string, cursor?: string) {
    if (!cursor) return null;
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        scope?: string;
        date?: string;
        id?: string;
      };
      const date = new Date(value.date ?? '');
      if (value.scope !== scope || typeof value.id !== 'string' || Number.isNaN(date.getTime()))
        throw new Error('invalid');
      return { date, id: value.id };
    } catch {
      throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'The cursor is invalid.' });
    }
  }
  private compactPhoto(photo: any) {
    return compactPhoto(photo);
  }
  private year(value: string) {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 2100)
      throw new BadRequestException({ code: 'INVALID_YEAR', message: 'A valid year is required.' });
    return year;
  }
  private month(value: string) {
    const month = Number(value);
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: 'A valid month is required.',
      });
    return month;
  }
  @UseGuards(SessionGuard)
  @Get('timeline/years')
  async years(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    // One pass over the owner's photos: the count per year also gives the first and last year.
    const counts = await this.prisma.$queryRawUnsafe<{ year: number; photoCount: bigint }[]>(
      `SELECT EXTRACT(YEAR FROM "effectiveDateValue")::int AS year, COUNT(*)::bigint AS "photoCount"
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND "hiddenAt" IS NULL AND "effectiveDateValue" IS NOT NULL
       GROUP BY 1`,
      userId,
    );
    if (!counts.length) return { firstYear: null, lastYear: null, latestYear: null, items: [] };
    const firstYear = Math.min(...counts.map((row) => row.year));
    const lastYear = Math.max(...counts.map((row) => row.year));
    const byYear = new Map(counts.map((row) => [row.year, Number(row.photoCount)]));
    const { limit, offset } = this.page(cursor, rawLimit, 'years');
    const items = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
      const year = lastYear - index;
      return { year, photoCount: byYear.get(year) ?? 0 };
    });
    const paginated = cursor !== undefined || rawLimit !== undefined;
    return {
      firstYear,
      lastYear,
      latestYear: lastYear,
      items: items.slice(offset, offset + limit),
      ...(paginated
        ? {
            nextCursor: offset + limit < items.length ? this.cursor('years', offset + limit) : null,
          }
        : {}),
    };
  }
  @UseGuards(SessionGuard) @Get('timeline/years/:year') async yearSummary(
    @CurrentUserId() userId: string,
    @Param('year') year: string,
  ) {
    const parsedYear = this.year(year);
    const start = new Date(Date.UTC(parsedYear, 0, 1));
    const end = new Date(Date.UTC(parsedYear + 1, 0, 1));
    const rows = await this.prisma.$queryRawUnsafe<
      {
        month: number;
        photoCount: bigint;
      }[]
    >(
      `SELECT EXTRACT(MONTH FROM "effectiveDateValue")::int AS month, COUNT(*)::bigint AS "photoCount"
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND "hiddenAt" IS NULL
         AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
         AND "effectiveDatePrecision" IN ('MONTH', 'DAY')
       GROUP BY 1`,
      userId,
      start,
      end,
    );
    const unknownRows = await this.prisma.$queryRawUnsafe<{ photoCount: bigint }[]>(
      `SELECT COUNT(*)::bigint AS "photoCount" FROM "Photo"
       WHERE "userId" = $1 AND status = 'ACTIVE' AND "hiddenAt" IS NULL
         AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
         AND "effectiveDatePrecision" = 'YEAR'`,
      userId,
      start,
      end,
    );
    // Chosen covers come first; the automatic picks fill the free slots without repeating them.
    const chosen = (await readYearCovers(this.prisma, userId, parsedYear)).year.valid;
    const previewIds = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `WITH ordered AS (
         SELECT id, "effectiveDateValue", NTILE(8) OVER (ORDER BY "effectiveDateValue" DESC, id DESC) AS bucket
         FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND "hiddenAt" IS NULL
           AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
           AND id <> ALL($4::text[])
       ) SELECT DISTINCT ON (bucket) id FROM ordered ORDER BY bucket, "effectiveDateValue" DESC, id DESC`,
      userId,
      start,
      end,
      chosen.map((photo) => photo.id),
    );
    const fill = spread(previewIds, COVER_LIMITS.YEAR - chosen.length);
    const records = fill.length
      ? await this.prisma.photo.findMany({
          where: { userId, id: { in: fill.map((row) => row.id) } },
          include: { override: true },
        })
      : [];
    const byId = new Map(records.map((photo) => [photo.id, photo]));
    const months = new Map(rows.map((row) => [row.month, Number(row.photoCount)]));
    const unknownMonthCount = Number(unknownRows[0]?.photoCount ?? 0);
    const total = [...months.values()].reduce((sum, count) => sum + count, 0) + unknownMonthCount;
    return {
      year: parsedYear,
      total,
      months: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        photoCount: months.get(index + 1) ?? 0,
      })),
      unknownMonthCount,
      previews: [...chosen, ...fill.map((row) => byId.get(row.id)).filter(Boolean)].map((photo) =>
        this.compactPhoto(photo),
      ),
    };
  }
  @UseGuards(SessionGuard) @Get('timeline/years/:year/months/:month/photos') async monthPhotos(
    @CurrentUserId() userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const parsedYear = this.year(year);
    const parsedMonth = this.month(month);
    return this.timelinePhotos(userId, parsedYear, parsedMonth, cursor, rawLimit, false);
  }
  @UseGuards(SessionGuard)
  @Get('timeline/years/:year/unknown-month/photos')
  async unknownMonthPhotos(
    @CurrentUserId() userId: string,
    @Param('year') year: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    return this.timelinePhotos(userId, this.year(year), null, cursor, rawLimit, true);
  }
  private async timelinePhotos(
    userId: string,
    year: number,
    month: number | null,
    cursor: string | undefined,
    rawLimit: string | undefined,
    unknownMonth: boolean,
  ) {
    const limit = Math.min(100, Math.max(1, Number(rawLimit ?? 30) || 30));
    const scope = `timeline-photos:${year}:${unknownMonth ? 'unknown-month' : month}`;
    const after = this.timelineCursor(scope, cursor);
    const start = unknownMonth
      ? new Date(Date.UTC(year, 0, 1))
      : new Date(Date.UTC(year, month! - 1, 1));
    const end = unknownMonth
      ? new Date(Date.UTC(year + 1, 0, 1))
      : new Date(Date.UTC(year, month!, 1));
    const records = await this.prisma.photo.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        hiddenAt: null,
        effectiveDateValue: { gte: start, lt: end },
        effectiveDatePrecision: unknownMonth ? 'YEAR' : { in: ['MONTH', 'DAY'] },
        ...(after
          ? {
              OR: [
                { effectiveDateValue: { lt: after.date } },
                { effectiveDateValue: after.date, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ effectiveDateValue: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { override: true },
    });
    const items = records.slice(0, limit).map((photo) => this.compactPhoto(photo));
    const last = records[limit - 1];
    return {
      items,
      nextCursor:
        records.length > limit && last
          ? this.keysetCursor(scope, last.effectiveDateValue!, last.id)
          : null,
    };
  }
  @UseGuards(SessionGuard) @Get('timeline/years/:year/month-previews') async monthPreviews(
    @CurrentUserId() userId: string,
    @Param('year') year: string,
  ) {
    const parsedYear = this.year(year);
    const start = new Date(Date.UTC(parsedYear, 0, 1));
    const end = new Date(Date.UTC(parsedYear + 1, 0, 1));
    const covers = await readYearCovers(this.prisma, userId, parsedYear);
    const chosenOf = (month: number | null) =>
      (month === null ? covers.unknownMonth : covers.months.get(month))?.valid ?? [];
    const chosenIds = [covers.unknownMonth, ...covers.months.values()].flatMap((scope) =>
      scope.valid.map((photo) => photo.id),
    );
    // One pass for the whole year: count per group and one photo per NTILE bucket (up to 6),
    // leaving out the photos already chosen as covers (they are counted, not picked again).
    const rows = await this.prisma.$queryRawUnsafe<
      { month: number | null; photoCount: bigint; id: string | null }[]
    >(
      `WITH scoped AS (
         SELECT id, "effectiveDateValue",
                CASE WHEN "effectiveDatePrecision" = 'YEAR' THEN NULL
                     ELSE EXTRACT(MONTH FROM "effectiveDateValue")::int END AS month
         FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND "hiddenAt" IS NULL
           AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
           AND "effectiveDatePrecision" IN ('YEAR', 'MONTH', 'DAY')
       ), counts AS (
         SELECT month, COUNT(*) AS "photoCount" FROM scoped GROUP BY month
       ), bucketed AS (
         SELECT id, month, "effectiveDateValue",
                NTILE(6) OVER (PARTITION BY month ORDER BY "effectiveDateValue" DESC, id DESC) AS bucket
         FROM scoped WHERE id <> ALL($4::text[])
       ), picked AS (
         SELECT DISTINCT ON (month, bucket) month, bucket, id FROM bucketed
         ORDER BY month, bucket, "effectiveDateValue" DESC, id DESC
       ) SELECT c.month, c."photoCount", p.id FROM counts c
       LEFT JOIN picked p ON p.month IS NOT DISTINCT FROM c.month
       ORDER BY c.month NULLS LAST, p.bucket`,
      userId,
      start,
      end,
      chosenIds,
    );
    const fillRows = rows.filter((row) => row.id);
    const records = fillRows.length
      ? await this.prisma.photo.findMany({
          where: { userId, id: { in: fillRows.map((row) => row.id!) } },
          include: { override: true },
        })
      : [];
    const byId = new Map(records.map((photo) => [photo.id, photo]));
    const groups = new Map<number | null, { photoCount: number; previews: any[] }>();
    for (const row of rows) {
      const group = groups.get(row.month) ?? { photoCount: Number(row.photoCount), previews: [] };
      const photo = row.id ? byId.get(row.id) : undefined;
      if (photo) group.previews.push(photo);
      groups.set(row.month, group);
    }
    for (const [month, group] of groups)
      group.previews = [
        ...chosenOf(month),
        ...spread(group.previews, COVER_LIMITS.MONTH - chosenOf(month).length),
      ].map((photo) => this.compactPhoto(photo));
    return {
      year: parsedYear,
      items: [...groups].map(([month, group]) => ({
        month,
        kind: month === null ? 'YEAR' : 'MONTH',
        label: month === null ? 'Fecha sin concretar' : null,
        ...group,
      })),
    };
  }
  @UseGuards(SessionGuard) @Get('photos') async photos(
    @CurrentUserId() userId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('day') day?: string,
    @Query('precision') precision?: 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN',
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    if (precision === 'UNKNOWN') {
      if (year || month || day)
        throw new BadRequestException({
          code: 'INVALID_GRANULARITY',
          message: 'Unknown dates cannot include a calendar value.',
        });
    } else if (!year) {
      throw new BadRequestException({
        code: 'INVALID_GRANULARITY',
        message: 'A valid year is required.',
      });
    }
    const parsedYear = year ? this.year(year) : undefined;
    const parsedMonth = month ? this.month(month) : undefined;
    const parsedDay = day ? Number(day) : undefined;
    const maximumDay =
      parsedYear && parsedMonth
        ? new Date(Date.UTC(parsedYear, parsedMonth, 0)).getUTCDate()
        : undefined;
    if (
      parsedDay !== undefined &&
      (!parsedMonth ||
        !Number.isInteger(parsedDay) ||
        parsedDay < 1 ||
        parsedDay > (maximumDay ?? 0))
    )
      throw new BadRequestException({ code: 'INVALID_DAY', message: 'A valid day is required.' });
    if (
      (precision === 'YEAR' && (parsedMonth || parsedDay)) ||
      (precision === 'MONTH' && (!parsedMonth || parsedDay)) ||
      (precision === 'DAY' && (!parsedMonth || !parsedDay))
    )
      throw new BadRequestException({
        code: 'INVALID_GRANULARITY',
        message: 'The date precision does not match the requested granularity.',
      });
    if ((parsedMonth && !precision) || (parsedDay && !precision))
      throw new BadRequestException({
        code: 'INVALID_GRANULARITY',
        message: 'Partial date groups require their precision.',
      });
    const scope = `photos:${parsedYear ?? 'unknown'}:${parsedMonth ?? ''}:${parsedDay ?? ''}:${precision ?? 'all'}`;
    const { limit, offset } = this.page(cursor, rawLimit, scope);
    const records = await this.prisma.photo.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        hiddenAt: null,
        ...(precision === 'UNKNOWN'
          ? { effectiveDateValue: null }
          : {
              effectiveDateValue: {
                gte: new Date(Date.UTC(parsedYear!, 0, 1)),
                lt: new Date(Date.UTC(parsedYear! + 1, 0, 1)),
              },
              ...(parsedMonth
                ? {
                    effectiveDateValue: {
                      gte: new Date(Date.UTC(parsedYear!, parsedMonth - 1, parsedDay ?? 1)),
                      lt: parsedDay
                        ? new Date(Date.UTC(parsedYear!, parsedMonth - 1, parsedDay + 1))
                        : new Date(Date.UTC(parsedYear!, parsedMonth, 1)),
                    },
                  }
                : {}),
              ...(precision ? { effectiveDatePrecision: precision } : {}),
            }),
      },
      orderBy: [{ effectiveDateValue: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      include: { override: true },
    });
    const page = records.slice(0, limit);
    return {
      items: page.map((photo) => ({
        ...photoDateResponse(photo),
        thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
      })),
      nextCursor: records.length > limit ? this.cursor(scope, offset + limit) : null,
    };
  }
  @UseGuards(SessionGuard, CsrfGuard)
  @Put('photos/:id/manual-date')
  async setManualDate(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() body: ManualDateInput,
  ) {
    const [photo] = await this.manualDates.set(userId, [id], body);
    return photoDateResponse(photo);
  }
  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('photos/:id/manual-date')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteManualDate(@CurrentUserId() userId: string, @Param('id') id: string) {
    await this.manualDates.remove(userId, id);
  }
  @UseGuards(SessionGuard) @Get('photos/:id/thumbnail') async thumbnail(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.media.thumbnail(userId, id, request, response);
  }

  @UseGuards(SessionGuard) @Get('photos/:id/content') async content(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.media.content(userId, id, request, response);
  }
}
