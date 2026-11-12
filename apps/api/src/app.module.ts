import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthController } from './auth.controller';
import { SourcesController } from './sources.controller';
import { TimelineController } from './timeline.controller';
import { OrderingController } from './ordering.controller';
import { CoversController } from './covers.controller';
import { CoversService } from './covers.service';
import { PrismaService } from './prisma.service';
import { DriveAdapter, GoogleDriveProvider, MemoryDriveProvider } from './drive';
import { PhotoDateResolver } from './date-resolver';
import { SyncService } from './sync.service';
import { SyncScheduler } from './sync-scheduler';
import { GoogleOAuthClient, GoogleOAuthProvider, OAuthStateService } from './oauth';
import { ManualDateService } from './manual-date.service';
import { MediaProxyService } from './media-proxy.service';
import { RetentionService } from './retention.service';
import { TakeoutMatcher, TakeoutMetadataParser } from './takeout';
import { FolderDateRuleService } from './folder-date-rule.service';
import { OrderingService } from './ordering.service';
import { PhotoVisibilityService } from './photo-visibility.service';
@Module({
  controllers: [
    AppController,
    AuthController,
    SourcesController,
    TimelineController,
    OrderingController,
    CoversController,
  ],
  providers: [
    PrismaService,
    PhotoDateResolver,
    TakeoutMetadataParser,
    TakeoutMatcher,
    ManualDateService,
    FolderDateRuleService,
    PhotoVisibilityService,
    OrderingService,
    CoversService,
    MediaProxyService,
    RetentionService,
    SyncService,
    SyncScheduler,
    OAuthStateService,
    { provide: GoogleOAuthClient, useClass: GoogleOAuthProvider },
    {
      provide: DriveAdapter,
      useFactory: () =>
        process.env.GOOGLE_CLIENT_ID ? new GoogleDriveProvider() : new MemoryDriveProvider(),
    },
  ],
})
export class AppModule {}
