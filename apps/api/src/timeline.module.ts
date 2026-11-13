import { Module } from '@nestjs/common';
import { DriveModule } from './drive.module';
import { ManualDateService } from './manual-date.service';
import { MediaProxyService } from './media-proxy.service';
import { ThumbnailStore } from './thumbnail-store';
import { TimelineController } from './timeline.controller';

/** Reading the archive: the timeline, photo dates and the authorized media proxy. */
@Module({
  imports: [DriveModule],
  controllers: [TimelineController],
  providers: [
    ManualDateService,
    { provide: ThumbnailStore, useFactory: () => new ThumbnailStore() },
    MediaProxyService,
  ],
  exports: [ManualDateService],
})
export class TimelineModule {}
