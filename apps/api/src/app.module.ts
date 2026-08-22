import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaService } from './prisma.service';
import { DriveAdapter, GoogleDriveProvider, MemoryDriveProvider } from './drive';
import { PhotoDateResolver } from './date-resolver';
import { SyncService } from './sync.service';
import { GoogleOAuthClient, GoogleOAuthProvider, OAuthStateService } from './oauth';
import { ManualDateService } from './manual-date.service';
import { MediaProxyService } from './media-proxy.service';
import { RetentionService } from './retention.service';
import { TakeoutMatcher, TakeoutMetadataParser } from './takeout';
@Module({
  controllers: [AppController],
  providers: [
    PrismaService,
    PhotoDateResolver,
    TakeoutMetadataParser,
    TakeoutMatcher,
    ManualDateService,
    MediaProxyService,
    RetentionService,
    SyncService,
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
