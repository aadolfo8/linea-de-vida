import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth.module';
import { CoversModule } from './covers.module';
import { DriveModule } from './drive.module';
import { OrderingModule } from './ordering.module';
import { PrismaModule } from './prisma.module';
import { SourcesModule } from './sources.module';
import { SyncModule } from './sync.module';
import { TimelineModule } from './timeline.module';

@Module({
  imports: [
    PrismaModule,
    DriveModule,
    AuthModule,
    SyncModule,
    SourcesModule,
    TimelineModule,
    OrderingModule,
    CoversModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
