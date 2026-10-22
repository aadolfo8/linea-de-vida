/** Names Google Takeout gives its folders: "Takeout", "Google Fotos" / "Google Photos", "Photos from 2019". */
const TAKEOUT_NAME = /takeout|google\s*(fotos|photos)/i;
const ALBUM_OR_YEAR = /^(photos from|fotos de)\s+\d{4}$/i;

/**
 * Whether a folder looks like a Google Photos export, from its name (when known) and the names of
 * its subfolders. A hint only: the person decides, and we never claim certainty.
 */
export function looksLikeTakeout(folderName: string | null, children: readonly string[]) {
  if (folderName && TAKEOUT_NAME.test(folderName)) return true;
  if (children.some((name) => TAKEOUT_NAME.test(name))) return true;
  return children.filter((name) => ALBUM_OR_YEAR.test(name.trim())).length >= 2;
}

export const SOURCE_KIND = {
  GOOGLE_TAKEOUT: {
    label: 'Exportación de Google Fotos',
    detail: 'Exportación de Google Fotos · se ordena sola',
    defaultName: 'Google Fotos',
  },
  GENERIC: {
    label: 'Carpeta de Drive',
    detail: 'Carpeta de Drive',
    defaultName: 'Carpeta de Drive',
  },
} as const;

export type SourceType = keyof typeof SOURCE_KIND;
