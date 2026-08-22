import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RetentionService } from './retention.service';
import { loadRuntimeConfig } from './production';

async function main() {
  loadRuntimeConfig();
  if (process.env.RETENTION_PURGE_CONFIRMATION !== 'DELETE_SYNC_METADATA')
    throw new Error(
      'Set RETENTION_PURGE_CONFIRMATION=DELETE_SYNC_METADATA to run retention cleanup.',
    );
  const context = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await context.get(RetentionService).purge();
    console.info(JSON.stringify({ event: 'retention_purge_completed', ...result }));
  } finally {
    await context.close();
  }
}

void main();
