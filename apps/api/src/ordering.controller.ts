import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { FolderDateRuleService } from './folder-date-rule.service';
import { ManualDateInput, ManualDateService, validateManualDate } from './manual-date.service';
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
  ) {}

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
