import { Module } from '@nestjs/common';
import { PhotoDateResolver } from './date-resolver';
import { DriveModule } from './drive.module';
import { RetentionService } from './retention.service';
import { SyncScheduler } from './sync-scheduler';
import { SyncService } from './sync.service';
import { TakeoutMatcher, TakeoutMetadataParser } from './takeout';

/** Indexing a Drive folder: the scan itself, its scheduler and the metadata retention. */
@Module({
  imports: [DriveModule],
  providers: [
    PhotoDateResolver,
    TakeoutMetadataParser,
    TakeoutMatcher,
    SyncService,
    SyncScheduler,
    RetentionService,
  ],
  exports: [SyncService, SyncScheduler],
})
export class SyncModule {}
