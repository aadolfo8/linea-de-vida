import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Optional,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { PhotoSourceStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { decryptSecret, encryptSecret } from './crypto';
import { CsrfGuard, CurrentUserId, SessionGuard, sessionUserId, setSessionCookie } from './auth';
import { PrismaService } from './prisma.service';
import { SyncService } from './sync.service';
import { SyncScheduler } from './sync-scheduler';
import { DriveAdapter } from './drive';
import { MediaProxyService } from './media-proxy.service';
import { DRIVE_SCOPE, GOOGLE_LOGIN_SCOPES, GoogleOAuthClient, OAuthStateService } from './oauth';
import { ManualDateInput, ManualDateService, photoDateResponse } from './manual-date.service';
import { loadRuntimeConfig } from './production';
import { FolderDateRuleService } from './folder-date-rule.service';
import { findOverlappingFolderSource, FolderAncestryUnavailable } from './folder-source-overlap';
import { compactPhoto } from './photo-summary';
import { readYearCovers, spread, COVER_LIMITS } from './covers';
import { refreshPhotos } from './photo-catalog';
import { PhotoVisibilityService } from './photo-visibility.service';

@Controller('v1')
export class AppController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(DriveAdapter) private readonly drive: DriveAdapter,
    @Inject(GoogleOAuthClient) private readonly oauth: GoogleOAuthClient,
    @Inject(OAuthStateService) private readonly states: OAuthStateService,
    @Inject(ManualDateService) private readonly manualDates: ManualDateService,
    @Inject(MediaProxyService) private readonly media: MediaProxyService,
    @Inject(FolderDateRuleService) private readonly folderDates: FolderDateRuleService,
    @Inject(PhotoVisibilityService) private readonly visibility: PhotoVisibilityService,
    @Optional() @Inject(SyncScheduler) private readonly scheduler?: SyncScheduler,
  ) {}
  private loginRedirectUri() {
    return (
      process.env.GOOGLE_LOGIN_REDIRECT_URI ??
      `${process.env.API_ORIGIN ?? 'http://localhost:3001'}/v1/auth/google/callback`
    );
  }
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
  @Get('health') health() {
    return { status: 'ok', service: 'linea-de-vida' };
  }
  @Get('readiness') async readiness() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Dependencies are unavailable.',
      });
    }
    // The scheduler runs syncs in this process: a loop that stopped ticking means queued syncs
    // would wait forever, so the container must be reported unhealthy.
    if (this.scheduler?.started && !this.scheduler.isAlive())
      throw new ServiceUnavailableException({
        code: 'SCHEDULER_STALLED',
        message: 'The sync scheduler is not running.',
      });
    return { status: 'ready' };
  }
  @Get('metrics') metrics(@Req() request: Request, @Res() response: Response) {
    const token = loadRuntimeConfig().metricsToken;
    if (!token || request.get('authorization') !== `Bearer ${token}`) throw new NotFoundException();
    response
      .type('text/plain')
      .send(
        [
          '# HELP linea_de_vida_process_uptime_seconds Process uptime in seconds.',
          '# TYPE linea_de_vida_process_uptime_seconds gauge',
          `linea_de_vida_process_uptime_seconds ${Math.floor(process.uptime())}`,
        ].join('\n'),
      );
  }
  @UseGuards(CsrfGuard)
  @Post('auth/development-login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async developmentLogin(@Res({ passthrough: true }) response: Response) {
    if (process.env.GOOGLE_CLIENT_ID) throw new NotFoundException();
    const id = process.env.DEV_USER_ID ?? 'development-user';
    await this.prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, email: 'development@local.invalid', displayName: 'Development archive' },
    });
    setSessionCookie(response, id);
  }
  @UseGuards(CsrfGuard)
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('lv_session', {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  @UseGuards(CsrfGuard)
  @Post('auth/google/authorize')
  async googleLoginAuthorize(@Res({ passthrough: true }) response: Response) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return { available: false, message: 'Google OAuth is not configured.' };
    const redirectUri = this.loginRedirectUri();
    const state = await this.states.create('login');
    response.cookie('lv_login_state', state.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600_000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_LOGIN_SCOPES,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
      state: state.id,
      code_challenge: state.codeChallenge,
      code_challenge_method: 'S256',
    });
    return {
      available: true,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    };
  }
  @Get('auth/google/callback')
  async googleLoginCallback(
    @Req() request: Request,
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    if (!state || (!code && !error) || request.signedCookies?.lv_login_state !== state)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The login state was not accepted.',
      });
    const oauthState = await this.states.consume(state, 'login');
    if (!oauthState)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The login state was not accepted.',
      });
    if (error)
      return response.redirect(
        `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/?oauth=${
          error === 'access_denied' ? 'access-denied' : 'login-denied'
        }`,
      );
    const identity = await this.oauth.exchange(
      code,
      this.loginRedirectUri(),
      oauthState.codeVerifier,
    );
    if (!identity.scopes.includes(DRIVE_SCOPE))
      throw new BadRequestException({
        code: 'DRIVE_SCOPE_NOT_GRANTED',
        message: 'Drive read-only access is required.',
      });
    if (!identity.refreshToken)
      throw new BadRequestException({
        code: 'DRIVE_OFFLINE_ACCESS_REQUIRED',
        message: 'Google did not issue an offline refresh token. Re-authorize with consent.',
      });
    const refreshTokenCiphertext = encryptSecret(identity.refreshToken);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { googleSubject: identity.subject },
        update: { email: identity.email, displayName: identity.displayName },
        create: {
          googleSubject: identity.subject,
          email: identity.email,
          displayName: identity.displayName,
        },
      });
      const connection = await tx.oAuthConnection.upsert({
        where: {
          userId_provider_googleAccountId: {
            userId: user.id,
            provider: 'google-drive',
            googleAccountId: identity.subject,
          },
        },
        update: {
          grantedScopes: identity.scopes,
          refreshTokenCiphertext,
          status: 'ACTIVE',
        },
        create: {
          userId: user.id,
          provider: 'google-drive',
          googleAccountId: identity.subject,
          grantedScopes: identity.scopes,
          refreshTokenCiphertext,
        },
      });
      await tx.photoSource.updateMany({
        where: {
          userId: user.id,
          oauthConnectionId: connection.id,
          status: 'DISCONNECTED',
        },
        data: { status: 'ACTIVE' },
      });
      return user;
    });
    response.clearCookie('lv_login_state');
    setSessionCookie(response, user.id);
    response.redirect(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
  }
  @UseGuards(SessionGuard) @Get('me') async me(@CurrentUserId() userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        connections: {
          where: { status: 'ACTIVE' },
          select: { id: true, provider: true, status: true },
        },
      },
    });
    return {
      user,
      driveConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      developmentMode: !process.env.GOOGLE_CLIENT_ID,
    };
  }
  @UseGuards(SessionGuard, CsrfGuard) @Post('oauth/google/drive/authorize') async driveAuthorize(
    @CurrentUserId() userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return {
        available: false,
        message: 'Google OAuth is not configured. Development mode never simulates authorization.',
      };
    const state = await this.states.create('drive', userId);
    response.cookie('lv_drive_state', state.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600_000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_DRIVE_REDIRECT_URI!,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: state.id,
      code_challenge: state.codeChallenge,
      code_challenge_method: 'S256',
    });
    return {
      available: true,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    };
  }
  @Get('oauth/google/drive/callback') async driveCallback(
    @Req() request: Request,
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    const userId = sessionUserId(request);
    if (!userId || !state || (!code && !error) || request.signedCookies?.lv_drive_state !== state)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The Drive authorization state was not accepted.',
      });
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      throw new BadRequestException({
        code: 'OAUTH_UNAVAILABLE',
        message: 'Google OAuth is not configured.',
      });
    const oauthState = await this.states.consume(state, 'drive', userId);
    if (!oauthState)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The Drive authorization state was not accepted.',
      });
    if (error) {
      response.clearCookie('lv_drive_state');
      return response.redirect(
        `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/ajustes?oauth=drive-denied`,
      );
    }
    const token = await this.oauth.exchange(
      code,
      process.env.GOOGLE_DRIVE_REDIRECT_URI!,
      oauthState.codeVerifier,
    );
    const scopes = token.scopes;
    if (!scopes.includes(DRIVE_SCOPE))
      throw new BadRequestException({
        code: 'DRIVE_SCOPE_NOT_GRANTED',
        message: 'Drive read-only access is required.',
      });
    const existingConnection = await this.prisma.oAuthConnection.findFirst({
      where: { userId, provider: 'google-drive', googleAccountId: token.subject },
    });
    const refreshTokenCiphertext = token.refreshToken
      ? encryptSecret(token.refreshToken)
      : existingConnection?.refreshTokenCiphertext;
    if (!refreshTokenCiphertext)
      throw new BadRequestException({
        code: 'DRIVE_OFFLINE_ACCESS_REQUIRED',
        message: 'Google did not issue an offline refresh token. Re-authorize with consent.',
      });
    await this.prisma.$transaction(async (tx) => {
      const connection = await tx.oAuthConnection.upsert({
        where: {
          userId_provider_googleAccountId: {
            userId,
            provider: 'google-drive',
            googleAccountId: token.subject,
          },
        },
        update: {
          grantedScopes: scopes,
          refreshTokenCiphertext,
          status: 'ACTIVE',
        },
        create: {
          userId,
          provider: 'google-drive',
          googleAccountId: token.subject,
          grantedScopes: scopes,
          refreshTokenCiphertext,
        },
      });
      await tx.photoSource.updateMany({
        where: { userId, oauthConnectionId: connection.id, status: 'DISCONNECTED' },
        data: { status: 'ACTIVE' },
      });
    });
    response.clearCookie('lv_drive_state');
    response.redirect(
      `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/ajustes?oauth=drive-connected`,
    );
  }
  @UseGuards(SessionGuard)
  @Get('oauth-connections/:id/drive/folders/:folderId/children')
  async folderChildren(
    @CurrentUserId() userId: string,
    @Param('id') connectionId: string,
    @Param('folderId') folderId: string,
    @Query('cursor') cursor?: string,
  ) {
    if (!folderId || folderId === 'root')
      throw new BadRequestException({
        code: 'INVALID_FOLDER',
        message: 'Choose a concrete Drive folder.',
      });
    const connection = await this.prisma.oAuthConnection.findFirst({
      where: { id: connectionId, userId, status: 'ACTIVE' },
    });
    if (!connection)
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Active Drive connection not found.',
      });
    const page = await this.drive.listChildren(connection, folderId, cursor);
    return {
      items: page.items
        .filter((item) => item.mimeType === 'application/vnd.google-apps.folder')
        .map(({ id, name, parents }) => ({ id, name, parents })),
      nextCursor: page.nextCursor ?? null,
    };
  }
  @UseGuards(SessionGuard) @Get('photo-sources') async sources(@CurrentUserId() userId: string) {
    return {
      items: await this.prisma.photoSource.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      nextCursor: null,
    };
  }
  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('photo-sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSource(@CurrentUserId() userId: string, @Param('id') sourceId: string) {
    await this.prisma.$transaction(
      async (tx) => {
        const source = await tx.photoSource.findFirst({ where: { id: sourceId, userId } });
        if (!source)
          throw new NotFoundException({
            code: 'SOURCE_NOT_FOUND',
            message: 'Photo source not found.',
          });
        const activeRun = await tx.syncRun.findFirst({
          where: { photoSourceId: sourceId, status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true },
        });
        if (activeRun)
          throw new ConflictException({
            code: 'SOURCE_SYNC_ACTIVE',
            message: 'Wait for the current source review to finish before removing it.',
          });
        // Only this source's copies go: a photo that also lives in another source stays, mirroring
        // one of its remaining copies; a photo with no copy left is deleted.
        const affected = await tx.photoFile.findMany({
          where: { userId, sourceId },
          select: { photoId: true },
        });
        const photoIds = [...new Set(affected.map((file) => file.photoId))];
        await tx.photoFile.deleteMany({ where: { userId, sourceId } });
        await tx.photo.deleteMany({ where: { userId, sourceId, files: { none: {} } } });
        await refreshPhotos(tx, photoIds);
        await tx.indexedFolder.deleteMany({ where: { userId, sourceId } });
        await tx.photoSource.delete({ where: { id: sourceId } });
      },
      { timeout: 60_000 },
    );
  }
  @UseGuards(SessionGuard, CsrfGuard) @Post('photo-sources') async createSource(
    @CurrentUserId() userId: string,
    @Body()
    body: {
      oauthConnectionId: string;
      driveFolderId: string;
      name: string;
      type?: 'GENERIC' | 'GOOGLE_TAKEOUT';
    },
  ) {
    if (
      !body?.driveFolderId ||
      body.driveFolderId === 'root' ||
      !body?.oauthConnectionId ||
      !body?.name?.trim()
    )
      throw new BadRequestException({
        code: 'INVALID_FOLDER',
        message: 'Choose a concrete Drive folder.',
      });
    if (body.type !== undefined && body.type !== 'GENERIC' && body.type !== 'GOOGLE_TAKEOUT')
      throw new BadRequestException({
        code: 'INVALID_SOURCE_TYPE',
        message: 'Photo source type is invalid.',
      });
    const connection = await this.prisma.oAuthConnection.findFirst({
      where: { id: body.oauthConnectionId, userId, status: 'ACTIVE' },
    });
    if (!connection)
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Active Drive connection not found.',
      });
    const folder = await this.drive.getFolder(connection, body.driveFolderId);
    if (!folder || folder.mimeType !== 'application/vnd.google-apps.folder')
      throw new NotFoundException({
        code: 'FOLDER_NOT_FOUND',
        message: 'The selected Drive folder is unavailable.',
      });
    const existingSources = await this.prisma.photoSource.findMany({
      where: { userId, oauthConnectionId: connection.id },
      select: { driveFolderId: true },
    });
    if (existingSources.length) {
      let overlap: string | null;
      try {
        overlap = await findOverlappingFolderSource(
          connection,
          body.driveFolderId,
          existingSources.map((source) => source.driveFolderId),
          this.drive,
        );
      } catch (error) {
        if (!(error instanceof FolderAncestryUnavailable)) throw error;
        throw new ConflictException({
          code: 'FOLDER_OVERLAP_UNVERIFIED',
          message:
            'Drive folder relationships could not be verified. Check access to your existing folders and try again.',
        });
      }
      if (overlap) {
        throw new ConflictException({
          code: 'FOLDER_SOURCE_OVERLAP',
          message:
            'This folder contains, or is contained by, another configured source. Use the existing source or choose a separate folder.',
        });
      }
    }
    return this.prisma.photoSource.create({
      data: {
        userId,
        oauthConnectionId: connection.id,
        driveFolderId: body.driveFolderId,
        name: body.name.trim().slice(0, 200),
        type: body.type ?? 'GENERIC',
        status: PhotoSourceStatus.ACTIVE,
      },
    });
  }
  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('oauth-connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@CurrentUserId() userId: string, @Param('id') id: string) {
    const connection = await this.prisma.oAuthConnection.findFirst({ where: { id, userId } });
    if (!connection)
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Drive connection not found.',
      });
    await this.prisma.photoSource.updateMany({
      where: { oauthConnectionId: id },
      data: { status: 'DISCONNECTED' },
    });
    if (!connection.refreshTokenCiphertext) {
      await this.prisma.oAuthConnection.update({ where: { id }, data: { status: 'REVOKED' } });
      return;
    }
    try {
      await this.oauth.revoke(decryptSecret(connection.refreshTokenCiphertext));
      await this.prisma.oAuthConnection.update({
        where: { id },
        data: { status: 'REVOKED', refreshTokenCiphertext: null },
      });
    } catch {
      await this.prisma.oAuthConnection.update({
        where: { id },
        data: { status: 'REVOCATION_PENDING' },
      });
    }
  }
  @UseGuards(SessionGuard, CsrfGuard)
  @Post('photo-sources/:id/sync-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  syncSource(@CurrentUserId() userId: string, @Param('id') sourceId: string) {
    return this.sync.enqueue(userId, sourceId);
  }
  @UseGuards(SessionGuard) @Get('sync-runs/:id') async run(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    const run = await this.prisma.syncRun.findFirst({ where: { id, source: { userId } } });
    if (!run)
      throw new NotFoundException({ code: 'SYNC_NOT_FOUND', message: 'Sync run not found.' });
    return run;
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
