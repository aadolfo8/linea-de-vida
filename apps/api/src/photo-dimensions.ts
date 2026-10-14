export type PhotoDimensions = { width: number; height: number };

const MAX_DIMENSION = 100_000;

export function photoDimensions(width: unknown, height: unknown): PhotoDimensions | null {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  )
    return null;
  return { width, height };
}

export function readPhotoDimensions(metadata: unknown): PhotoDimensions | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  return photoDimensions(value.width, value.height);
}
