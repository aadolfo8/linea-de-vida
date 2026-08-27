import {
  BadRequestException,
  Body,
  Controller,
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
import { DateSource, FolderDateRuleScope, PhotoSourceStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { decryptSecret, encryptSecret } from './crypto';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { PrismaService } from './prisma.service';
import { SyncService } from './sync.service';
import { DriveAdapter } from './drive';
import { MediaProxyService } from './media-proxy.service';
import { DRIVE_SCOPE, GOOGLE_LOGIN_SCOPES, GoogleOAuthClient, OAuthStateService } from './oauth';
import {
  ManualDateInput,
  ManualDateService,
  photoDateResponse,
  validateManualDate,
} from './manual-date.service';
import { loadRuntimeConfig } from './production';
import { FolderDateRuleService } from './folder-date-rule.service';

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
    return {
      id: photo.id,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
      effectiveDate: {
        value: photo.effectiveDateValue,
        precision: photo.effectiveDatePrecision,
      },
    };
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
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Dependencies are unavailable.',
      });
    }
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
    response.cookie('lv_session', id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: false,
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
      await tx.oAuthConnection.upsert({
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
      return user;
    });
    response.clearCookie('lv_login_state');
    response.cookie('lv_session', user.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
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
    const userId = request.signedCookies?.lv_session;
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
    if (error)
      return response.redirect(
        `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/?oauth=drive-denied`,
      );
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
    await this.prisma.oAuthConnection.upsert({
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
    response.clearCookie('lv_drive_state');
    response.redirect(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
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
  @UseGuards(SessionGuard) @Get('photo-sources/:id/sync-runs') async sourceRuns(
    @CurrentUserId() userId: string,
    @Param('id') sourceId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const source = await this.prisma.photoSource.findFirst({ where: { id: sourceId, userId } });
    if (!source)
      throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: 'Photo source not found.' });
    const scope = `sync-history:${sourceId}`;
    const { limit, offset } = this.page(cursor, rawLimit, scope);
    const records = await this.prisma.syncRun.findMany({
      where: { photoSourceId: sourceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
    });
    return {
      items: records.slice(0, limit),
      nextCursor: records.length > limit ? this.cursor(scope, offset + limit) : null,
    };
  }
  @UseGuards(SessionGuard) @Get('photo-sources/:id/indexed-folders') async indexedFolders(
    @CurrentUserId() userId: string,
    @Param('id') sourceId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const source = await this.prisma.photoSource.findFirst({ where: { id: sourceId, userId } });
    if (!source)
      throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: 'Photo source not found.' });
    const scope = `indexed-folders:${sourceId}`;
    const { limit, offset } = this.page(cursor, rawLimit, scope);
    const [records, totals, pending] = await Promise.all([
      this.prisma.indexedFolder.findMany({
        where: { sourceId, userId },
        orderBy: [{ path: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit + 1,
        include: {
          dateRule: true,
          _count: { select: { photos: { where: { status: 'ACTIVE' } } } },
        },
      }),
      this.prisma.photo.groupBy({
        by: ['folderId'],
        where: { sourceId, userId, status: 'ACTIVE', folderId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.photo.groupBy({
        by: ['folderId'],
        where: {
          sourceId,
          userId,
          status: 'ACTIVE',
          folderId: { not: null },
          effectiveDateValue: null,
        },
        _count: { _all: true },
      }),
    ]);
    const totalsByFolder = new Map(totals.map((group) => [group.folderId!, group._count._all]));
    const pendingByFolder = new Map(pending.map((group) => [group.folderId!, group._count._all]));
    return {
      items: records.slice(0, limit).map(({ _count, ...folder }) => ({
        ...folder,
        photoCount: _count.photos,
        classifiedPhotoCount:
          (totalsByFolder.get(folder.id) ?? 0) - (pendingByFolder.get(folder.id) ?? 0),
        unclassifiedPhotoCount: pendingByFolder.get(folder.id) ?? 0,
      })),
      nextCursor: records.length > limit ? this.cursor(scope, offset + limit) : null,
    };
  }
  @UseGuards(SessionGuard) @Get('indexed-folders/:id/photos') async indexedFolderPhotos(
    @CurrentUserId() userId: string,
    @Param('id') folderId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
    @Query('classification') classification?: string,
  ) {
    const folder = await this.prisma.indexedFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder)
      throw new NotFoundException({
        code: 'FOLDER_NOT_FOUND',
        message: 'Indexed folder not found.',
      });
    const scope = `indexed-folder-photos:${folderId}`;
    const { limit, offset } = this.page(cursor, rawLimit, scope);
    const classificationWhere =
      classification === 'UNCLASSIFIED'
        ? { effectiveDateValue: null }
        : classification === 'MANUAL'
          ? { effectiveDateSource: 'MANUAL' as const }
          : classification === 'FOLDER'
            ? { effectiveDateSource: 'FOLDER_RULE' as const }
            : classification === 'AUTOMATIC'
              ? {
                  effectiveDateSource: {
                    in: ['EXIF', 'DRIVE_IMAGE_METADATA', 'TAKEOUT', 'FOLDER'] as DateSource[],
                  },
                }
              : {};
    const records = await this.prisma.photo.findMany({
      where: { userId, folderId, status: 'ACTIVE', ...classificationWhere },
      orderBy: [{ fileName: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      include: { override: true },
    });
    return {
      items: records.slice(0, limit).map((photo) => ({
        ...photoDateResponse(photo),
        thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
      })),
      nextCursor: records.length > limit ? this.cursor(scope, offset + limit) : null,
    };
  }
  @UseGuards(SessionGuard, CsrfGuard) @Put('indexed-folders/:id/date-override') async setFolderDate(
    @CurrentUserId() userId: string,
    @Param('id') folderId: string,
    @Body() body: ManualDateInput & { scope?: unknown },
  ) {
    if (body.precision !== 'YEAR' && body.precision !== 'MONTH')
      throw new BadRequestException({
        code: 'INVALID_PRECISION',
        message: 'Folder rules support YEAR or MONTH precision.',
      });
    const manual = validateManualDate(body);
    const scope = body.scope ?? 'FALLBACK_DESCENDANTS';
    if (!Object.values(FolderDateRuleScope).includes(scope as FolderDateRuleScope))
      throw new BadRequestException({
        code: 'INVALID_FOLDER_RULE_SCOPE',
        message: 'The folder rule scope is invalid.',
      });
    return this.folderDates.set(userId, folderId, {
      dateValue: manual.dateValue,
      precision: manual.precision,
      scope: scope as FolderDateRuleScope,
    });
  }
  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('indexed-folders/:id/date-override')
  async removeFolderDate(@CurrentUserId() userId: string, @Param('id') folderId: string) {
    return this.folderDates.remove(userId, folderId);
  }
  @UseGuards(SessionGuard)
  @Get('photo-sources/:id/classification-summary')
  async classificationSummary(@CurrentUserId() userId: string, @Param('id') sourceId: string) {
    const source = await this.prisma.photoSource.findFirst({ where: { id: sourceId, userId } });
    if (!source)
      throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: 'Photo source not found.' });
    const groups = await this.prisma.photo.groupBy({
      by: ['effectiveDateSource'],
      where: { sourceId, userId, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const count = (sources: string[]) =>
      groups
        .filter((group) => sources.includes(group.effectiveDateSource))
        .reduce((total, group) => total + group._count._all, 0);
    const unclassified = await this.prisma.photo.count({
      where: { sourceId, userId, status: 'ACTIVE', effectiveDateValue: null },
    });
    return {
      total:
        count(['EXIF', 'DRIVE_IMAGE_METADATA', 'TAKEOUT', 'FOLDER', 'FOLDER_RULE', 'MANUAL']) +
        unclassified,
      automatic: count(['EXIF', 'DRIVE_IMAGE_METADATA', 'TAKEOUT', 'FOLDER']),
      folder: count(['FOLDER_RULE']),
      manual: count(['MANUAL']),
      unclassified,
    };
  }
  @UseGuards(SessionGuard) @Get('photo-sources/:id/pending-photos') async pendingPhotos(
    @CurrentUserId() userId: string,
    @Param('id') sourceId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const source = await this.prisma.photoSource.findFirst({ where: { id: sourceId, userId } });
    if (!source)
      throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: 'Photo source not found.' });
    const scope = `source-pending-photos:${sourceId}`;
    const { limit, offset } = this.page(cursor, rawLimit, scope);
    const records = await this.prisma.photo.findMany({
      where: { sourceId, userId, status: 'ACTIVE', effectiveDateValue: null },
      orderBy: [{ folderId: 'asc' }, { fileName: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      include: { override: true },
    });
    return {
      items: records.slice(0, limit).map((photo) => ({
        ...photoDateResponse(photo),
        thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
      })),
      nextCursor: records.length > limit ? this.cursor(scope, offset + limit) : null,
    };
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
  @UseGuards(SessionGuard) @Get('sync-runs/:id/issues') async runIssues(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const run = await this.prisma.syncRun.findFirst({ where: { id, source: { userId } } });
    if (!run)
      throw new NotFoundException({ code: 'SYNC_NOT_FOUND', message: 'Sync run not found.' });
    const { limit, offset } = this.page(cursor, rawLimit, `sync-issues:${id}`);
    const records = await this.prisma.syncIssue.findMany({
      where: { syncRunId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    return {
      items: records.slice(0, limit),
      nextCursor: records.length > limit ? this.cursor(`sync-issues:${id}`, offset + limit) : null,
    };
  }
  @UseGuards(SessionGuard)
  @Get('timeline/years')
  async years(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<
      { firstYear: number | null; lastYear: number | null }[]
    >(
      `SELECT MIN(EXTRACT(YEAR FROM "effectiveDateValue")::int) AS "firstYear",
              MAX(EXTRACT(YEAR FROM "effectiveDateValue")::int) AS "lastYear"
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND "effectiveDateValue" IS NOT NULL`,
      userId,
    );
    const firstYear = rows[0]?.firstYear;
    const lastYear = rows[0]?.lastYear;
    if (!firstYear || !lastYear)
      return { firstYear: null, lastYear: null, latestYear: null, items: [] };
    const counts = await this.prisma.$queryRawUnsafe<{ year: number; photoCount: bigint }[]>(
      `SELECT EXTRACT(YEAR FROM "effectiveDateValue")::int AS year, COUNT(*)::bigint AS "photoCount"
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND "effectiveDateValue" IS NOT NULL
       GROUP BY 1`,
      userId,
    );
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
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE'
         AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
         AND "effectiveDatePrecision" IN ('MONTH', 'DAY')
       GROUP BY 1`,
      userId,
      start,
      end,
    );
    const unknownRows = await this.prisma.$queryRawUnsafe<{ photoCount: bigint }[]>(
      `SELECT COUNT(*)::bigint AS "photoCount" FROM "Photo"
       WHERE "userId" = $1 AND status = 'ACTIVE'
         AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
         AND "effectiveDatePrecision" = 'YEAR'`,
      userId,
      start,
      end,
    );
    const previewIds = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `WITH ordered AS (
         SELECT id, "effectiveDateValue", NTILE(8) OVER (ORDER BY "effectiveDateValue" DESC, id DESC) AS bucket
         FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE'
           AND "effectiveDateValue" >= $2 AND "effectiveDateValue" < $3
       ) SELECT DISTINCT ON (bucket) id FROM ordered ORDER BY bucket, "effectiveDateValue" DESC, id DESC`,
      userId,
      start,
      end,
    );
    const records = previewIds.length
      ? await this.prisma.photo.findMany({
          where: { userId, id: { in: previewIds.map((row) => row.id) } },
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
      previews: previewIds
        .map((row) => byId.get(row.id))
        .filter(Boolean)
        .map((photo) => this.compactPhoto(photo)),
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
  @UseGuards(SessionGuard) @Get('timeline/years/:year/months') async months(
    @CurrentUserId() userId: string,
    @Param('year') year: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const parsedYear = this.year(year);
    const { limit, offset } = this.page(cursor, rawLimit, `months:${parsedYear}`);
    const rows = await this.prisma.$queryRawUnsafe<{ month: number | null; photoCount: bigint }[]>(
      `SELECT EXTRACT(MONTH FROM "effectiveDateValue")::int AS month, COUNT(*)::bigint AS "photoCount"
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND EXTRACT(YEAR FROM "effectiveDateValue")::int = $2
         AND "effectiveDatePrecision" IN ('MONTH', 'DAY') GROUP BY 1
       UNION ALL
       SELECT NULL::int AS month, COUNT(*)::bigint AS "photoCount" FROM "Photo"
       WHERE "userId" = $1 AND status = 'ACTIVE' AND EXTRACT(YEAR FROM "effectiveDateValue")::int = $2
         AND "effectiveDatePrecision" = 'YEAR'
       ORDER BY month NULLS LAST LIMIT $3 OFFSET $4`,
      userId,
      parsedYear,
      limit + 1,
      offset,
    );
    const items = rows
      .filter((row) => Number(row.photoCount) > 0)
      .slice(0, limit)
      .map((row) => ({
        month: row.month,
        kind: row.month === null ? 'YEAR' : 'MONTH',
        label: row.month === null ? 'Fecha sin concretar' : null,
        photoCount: Number(row.photoCount),
      }));
    return {
      items,
      nextCursor: rows.length > limit ? this.cursor(`months:${parsedYear}`, offset + limit) : null,
    };
  }
  @UseGuards(SessionGuard) @Get('timeline/years/:year/months/:month/days') async days(
    @CurrentUserId() userId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const parsedYear = this.year(year);
    const parsedMonth = this.month(month);
    const scope = `days:${parsedYear}:${parsedMonth}`;
    const { limit, offset } = this.page(cursor, rawLimit, scope);
    const rows = await this.prisma.$queryRawUnsafe<{ day: number | null; photoCount: bigint }[]>(
      `SELECT EXTRACT(DAY FROM "effectiveDateValue")::int AS day, COUNT(*)::bigint AS "photoCount"
       FROM "Photo" WHERE "userId" = $1 AND status = 'ACTIVE' AND EXTRACT(YEAR FROM "effectiveDateValue")::int = $2
         AND EXTRACT(MONTH FROM "effectiveDateValue")::int = $3 AND "effectiveDatePrecision" = 'DAY' GROUP BY 1
       UNION ALL
       SELECT NULL::int AS day, COUNT(*)::bigint AS "photoCount" FROM "Photo"
       WHERE "userId" = $1 AND status = 'ACTIVE' AND EXTRACT(YEAR FROM "effectiveDateValue")::int = $2
         AND EXTRACT(MONTH FROM "effectiveDateValue")::int = $3 AND "effectiveDatePrecision" = 'MONTH'
       ORDER BY day NULLS LAST LIMIT $4 OFFSET $5`,
      userId,
      parsedYear,
      parsedMonth,
      limit + 1,
      offset,
    );
    const items = rows
      .filter((row) => Number(row.photoCount) > 0)
      .slice(0, limit)
      .map((row) => ({
        day: row.day,
        kind: row.day === null ? 'MONTH' : 'DAY',
        label: row.day === null ? 'Día sin concretar' : null,
        photoCount: Number(row.photoCount),
      }));
    return { items, nextCursor: rows.length > limit ? this.cursor(scope, offset + limit) : null };
  }
  @UseGuards(SessionGuard) @Get('timeline/undated') async undated(@CurrentUserId() userId: string) {
    const rows = await this.prisma.$queryRawUnsafe<{ photoCount: bigint }[]>(
      `SELECT COUNT(*)::bigint AS "photoCount" FROM "Photo"
       WHERE "userId" = $1 AND status = 'ACTIVE' AND "effectiveDateValue" IS NULL`,
      userId,
    );
    return { photoCount: Number(rows[0]?.photoCount ?? 0) };
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
  @Put('photos/manual-date-overrides')
  async setManualDates(
    @CurrentUserId() userId: string,
    @Body() body: ManualDateInput & { photoIds?: unknown },
  ) {
    if (!Array.isArray(body?.photoIds) || !body.photoIds.every((id) => typeof id === 'string'))
      throw new BadRequestException({
        code: 'INVALID_PHOTO_IDS',
        message: 'Photo IDs are required.',
      });
    const photos = await this.manualDates.set(userId, body.photoIds, body);
    return { items: photos.map(photoDateResponse) };
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
  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('photos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePhoto(@CurrentUserId() userId: string, @Param('id') id: string) {
    const photo = await this.prisma.photo.findFirst({ where: { id, userId } });
    if (!photo)
      throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
    await this.prisma.$transaction(async (tx) => {
      await tx.photoExclusion.upsert({
        where: { userId_driveFileId: { userId, driveFileId: photo.driveFileId } },
        create: { userId, driveFileId: photo.driveFileId },
        update: {},
      });
      await tx.photo.delete({ where: { id: photo.id } });
    });
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
