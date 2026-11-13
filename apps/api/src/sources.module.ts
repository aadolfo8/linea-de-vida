import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { DriveModule } from './drive.module';
import { SourcesController } from './sources.controller';
import { SyncModule } from './sync.module';

@Module({
  imports: [AuthModule, DriveModule, SyncModule],
  controllers: [SourcesController],
})
export class SourcesModule {}
