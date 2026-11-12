import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PhotoSourceStatus } from '@prisma/client';
import { decryptSecret } from './crypto';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { PrismaService } from './prisma.service';
import { SyncService } from './sync.service';
import { DriveAdapter } from './drive';
import { GoogleOAuthClient } from './oauth';
import { findOverlappingFolderSource, FolderAncestryUnavailable } from './folder-source-overlap';
import { refreshPhotos } from './photo-catalog';

@Controller('v1')
export class SourcesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(DriveAdapter) private readonly drive: DriveAdapter,
    @Inject(GoogleOAuthClient) private readonly oauth: GoogleOAuthClient,
  ) {}
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
}
