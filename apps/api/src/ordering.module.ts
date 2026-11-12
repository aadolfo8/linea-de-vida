import { Module } from '@nestjs/common';
import { FolderDateRuleService } from './folder-date-rule.service';
import { OrderingController } from './ordering.controller';
import { OrderingService } from './ordering.service';
import { PhotoVisibilityService } from './photo-visibility.service';
import { TimelineModule } from './timeline.module';

@Module({
  imports: [TimelineModule],
  controllers: [OrderingController],
  providers: [PhotoVisibilityService, FolderDateRuleService, OrderingService],
})
export class OrderingModule {}
