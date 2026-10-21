import { BadRequestException } from '@nestjs/common';

/** Photos a single batch request may name; the server chunks the work, the client never has to. */
export const PHOTO_BATCH_LIMIT = 2_000;

export const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

/** Validates a client-provided ID list and removes duplicates, keeping the first occurrence. */
export function parsePhotoIds(value: unknown, limit = PHOTO_BATCH_LIMIT): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)
  )
    throw new BadRequestException({
      code: 'INVALID_PHOTO_IDS',
      message: 'Provide a non-empty list of photo IDs.',
    });
  const ids = [...new Set<string>(value)];
  if (ids.length > limit)
    throw new BadRequestException({
      code: 'BATCH_LIMIT_EXCEEDED',
      message: `A maximum of ${limit} photos can be changed in one request.`,
    });
  return ids;
}
