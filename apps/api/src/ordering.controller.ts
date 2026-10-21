import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { PhotoVisibilityService } from './photo-visibility.service';

/** Routes of the "Ordenar" screen. Thin: validation and rules live in the services. */
@Controller('v1')
export class OrderingController {
  constructor(
    @Inject(PhotoVisibilityService) private readonly visibility: PhotoVisibilityService,
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
}
