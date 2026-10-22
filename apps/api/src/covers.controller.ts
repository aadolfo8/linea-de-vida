import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CsrfGuard, CurrentUserId, SessionGuard } from './auth';
import { CoversService } from './covers.service';

/** Routes of the "Portadas" screen. Thin: validation and rules live in the service. */
@Controller('v1')
export class CoversController {
  constructor(@Inject(CoversService) private readonly covers: CoversService) {}

  @UseGuards(SessionGuard)
  @Get('covers')
  list(@CurrentUserId() userId: string, @Query('year') year?: string) {
    return this.covers.list(userId, year);
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Put('covers')
  replace(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.covers.replace(userId, body);
  }

  @UseGuards(SessionGuard, CsrfGuard)
  @Delete('covers')
  @HttpCode(HttpStatus.OK)
  clear(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.covers.clear(userId, body);
  }
}
