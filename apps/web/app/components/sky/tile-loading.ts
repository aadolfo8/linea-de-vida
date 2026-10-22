import type { SyntheticEvent } from 'react';

/**
 * Tiles shimmer until their image has arrived. The flag lives on the DOM node (set from the
 * image events) so a frame loop or a re-render never has to know about it.
 */
const mark = (image: HTMLImageElement) => image.parentElement?.setAttribute('data-loaded', 'true');

/** `onLoad` and `onError` of a tile image: either way the shimmer has nothing left to wait for. */
export const tileImageSettled = (event: SyntheticEvent<HTMLImageElement>) =>
  mark(event.currentTarget);

/** Ref for a tile image: one that came straight from the browser cache never fires `onLoad`. */
export const trackTileImage = (image: HTMLImageElement | null) => {
  if (image?.complete && image.naturalWidth > 0) mark(image);
};
