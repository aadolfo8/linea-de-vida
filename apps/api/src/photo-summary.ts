import { readPhotoDimensions } from './photo-dimensions';

/** The photo fields the timeline and the covers send to the web app. */
export function compactPhoto(photo: any) {
  const dimensions = readPhotoDimensions(photo.imageMetadata);
  return {
    id: photo.id,
    fileName: photo.fileName,
    mimeType: photo.mimeType,
    thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
    ...(dimensions ? { dimensions } : {}),
    effectiveDate: {
      value: photo.effectiveDateValue,
      precision: photo.effectiveDatePrecision,
    },
  };
}
