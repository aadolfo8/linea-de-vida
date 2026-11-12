import { Module } from '@nestjs/common';
import { DriveAdapter, GoogleDriveProvider, MemoryDriveProvider } from './drive';

/** The Google Drive adapter, or the in-memory one when no Google client is configured. */
@Module({
  providers: [
    {
      provide: DriveAdapter,
      useFactory: () =>
        process.env.GOOGLE_CLIENT_ID ? new GoogleDriveProvider() : new MemoryDriveProvider(),
    },
  ],
  exports: [DriveAdapter],
})
export class DriveModule {}
