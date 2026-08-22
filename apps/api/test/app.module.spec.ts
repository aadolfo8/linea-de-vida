import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { SyncService } from '../src/sync.service';
import { TakeoutMatcher, TakeoutMetadataParser } from '../src/takeout';

describe('AppModule dependency graph', () => {
  it('resolves SyncService with concrete Takeout collaborators', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(module.get(SyncService)).toBeInstanceOf(SyncService);
    expect(module.get(TakeoutMetadataParser)).toBeInstanceOf(TakeoutMetadataParser);
    expect(module.get(TakeoutMatcher)).toBeInstanceOf(TakeoutMatcher);

    await module.close();
  });
});
