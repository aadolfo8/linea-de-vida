import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { FolderDateRuleService } from './folder-date-rule.service';
import { ManualDateInput, ManualDateService, validateManualDate } from './manual-date.service';
import { OrderingScope, OrderingService } from './ordering.service';
import { PhotoVisibilityService } from './photo-visibility.service';

type FolderDateBody = ManualDateInput & {
  includeSubfolders?: unknown;
  overrideCameraDates?: unknown;
};

const flag = (value: unknown, fallback: boolean, name: string) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean')
    throw new BadRequestException({
      code: 'INVALID_FOLDER_DATE_OPTIONS',
      message: `${name} must be true or false.`,
    });
  return value;
};

const includeSubfolders = (value: string | undefined) => {
  if (value === undefined) return true;
  if (value !== 'true' && value !== 'false')
    throw new BadRequestException({
      code: 'INVALID_INCLUDE_SUBFOLDERS',
      message: 'includeSubfolders must be true or false.',
    });
  return value === 'true';
};

/** Year, month or day for a folder, plus the two yes/no choices of the Ordenar screen. */
const folderDate = (body: FolderDateBody) => {
  const manual = validateManualDate({ ...body, reason: undefined });
  return {
    dateValue: manual.dateValue,
    precision: manual.precision,
    includeSubfolders: flag(body?.includeSubfolders, true, 'includeSubfolders'),
    overrideCameraDates: flag(body?.overrideCameraDates, false, 'overrideCameraDates'),
  };
};

/** Routes of the "Ordenar" screen. Thin: validation and rules live in the services. */
@Controller('v1')
export class OrderingController {
  constructor(
    @Inject(PhotoVisibilityService) private readonly visibility: PhotoVisibilityService,
    @Inject(ManualDateService) private readonly manualDates: ManualDateService,
    @Inject(FolderDateRuleService) private readonly folderDates: FolderDateRuleService,
    @Inject(OrderingService) private readonly ordering: OrderingService,
  ) {}

  @UseGuards(SessionGuard)
  @Get('ordering/piles')
  piles(
    @CurrentUserId() userId: string,
    @Query('sourceId') sourceId?: string,
    @Query('folderId') folderId?: string,
    @Query('includeSubfolders') subfolders?: string,
  ) {
    return this.ordering.piles(userId, {
      sourceId,
      folderId,
      includeSubfolders: includeSubfolders(subfolders),
    });
  }

  @UseGuards(SessionGuard)
  @Get('ordering/photos')
  photos(
    @CurrentUserId() userId: string,
    @Query('pile') pile?: string,
    @Query('sourceId') sourceId?: string,
    @Query('folderId') folderId?: string,
    @Query('includeSubfolders') subfolders?: string,
    @Query('order') order?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordering.photos(userId, {
      pile,
      sourceId,
      folderId,
      includeSubfolders: includeSubfolders(subfolders),
      order,
      cursor,
      limit,
    });
  }

  @UseGuards(SessionGuard)
  @Get('photo-sources/:id/folder-tree')
  folderTree(@CurrentUserId() userId: string, @Param('id') sourceId: string) {
    return this.ordering.folderTree(userId, sourceId);
  }

  @UseGuards(SessionGuard)
  @Get('indexed-folders/:id')
  folder(@CurrentUserId() userId: string, @Param('id') folderId: string) {
    return this.ordering.folder(userId, folderId);
  }

  @UseGuards(SessionGuard)
  @Get('ordering/filename-suggestions')
  filenameSuggestions(
    @CurrentUserId() userId: string,
    @Query('sourceId') sourceId?: string,
    @Query('folderId') folderId?: string,
    @Query('includeSubfolders') subfolders?: string,
  ) {
    return this.ordering.filenameSuggestions(userId, {
      sourceId,
      folderId,
      includeSubfolders: includeSubfolders(subfolders),
    });
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Post('ordering/filename-suggestions/accept')
  @HttpCode(HttpStatus.OK)
  acceptFilenameSuggestions(
    @CurrentUserId() userId: string,
    @Body()
    body: OrderingScope & { kinds?: unknown; photoIds?: unknown; includeSubfolders?: unknown },
  ) {
    return this.ordering.acceptFilenameSuggestions(userId, {
      sourceId: typeof body?.sourceId === 'string' ? body.sourceId : undefined,
      folderId: typeof body?.folderId === 'string' ? body.folderId : undefined,
      includeSubfolders: body?.includeSubfolders !== false,
      kinds: body?.kinds,
      photoIds: body?.photoIds,
    });
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Post('photos/hide')
  @HttpCode(HttpStatus.OK)
  hidePhotos(@CurrentUserId() userId: string, @Body() body: { photoIds?: unknown }) {
    return this.visibility.hide(userId, body?.photoIds);
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Post('photos/unhide')
  @HttpCode(HttpStatus.OK)
  unhidePhotos(@CurrentUserId() userId: string, @Body() body: { photoIds?: unknown }) {
    return this.visibility.unhide(userId, body?.photoIds);
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Put('photos/dates')
  setDates(
    @CurrentUserId() userId: string,
    @Body() body: ManualDateInput & { photoIds?: unknown },
  ) {
    return this.manualDates.setMany(userId, body?.photoIds, body);
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Post('photos/dates/clear')
  @HttpCode(HttpStatus.OK)
  clearDates(@CurrentUserId() userId: string, @Body() body: { photoIds?: unknown }) {
    return this.manualDates.clearMany(userId, body?.photoIds);
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Post('indexed-folders/:id/date/preview')
  @HttpCode(HttpStatus.OK)
  previewFolderDate(
    @CurrentUserId() userId: string,
    @Param('id') folderId: string,
    @Body() body: FolderDateBody,
  ) {
    return this.folderDates.previewSimple(userId, folderId, folderDate(body));
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Put('indexed-folders/:id/date')
  setFolderDate(
    @CurrentUserId() userId: string,
    @Param('id') folderId: string,
    @Body() body: FolderDateBody,
  ) {
    return this.folderDates.setSimple(userId, folderId, folderDate(body));
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('indexed-folders/:id/date')
  removeFolderDate(@CurrentUserId() userId: string, @Param('id') folderId: string) {
    return this.folderDates.remove(userId, folderId);
  }
}
