import { photoCountText, storedLabel } from './dates';
import type { FilenameSuggestions, FolderDatePreview, OrderingPhoto, Pile } from './types';

/** The folder date preview as one plain sentence. */
export function previewSentence(preview: FolderDatePreview) {
  if (preview.scopePhotoCount === 0) return 'Esta carpeta no tiene fotos todavía.';
  if (preview.willChangeCount === 0)
    return 'Con estas opciones no cambiaría ninguna foto: todas conservan la fecha que ya tienen.';
  const parts = [
    `Cambiará la fecha de ${photoCountText(preview.willChangeCount)} de ${preview.scopePhotoCount.toLocaleString('es-ES')}.`,
  ];
  if (preview.preservesManualCount > 0)
    parts.push(
      `Las que tienen fecha puesta a mano (${preview.preservesManualCount.toLocaleString('es-ES')}) no se tocan.`,
    );
  if (preview.replacesAutomaticCount > 0)
    parts.push(
      `Se sustituye la fecha de cámara de ${photoCountText(preview.replacesAutomaticCount)}.`,
    );
  if (preview.replacesFolderNameDateCount > 0)
    parts.push(
      `Se sustituye la fecha del nombre de ${photoCountText(preview.replacesFolderNameDateCount)}.`,
    );
  return parts.join(' ');
}

export const pileCopy: Record<Pile, { title: string; sub: string }> = {
  undated: { title: 'Sin fecha', sub: 'Fotos que aún no aparecen en la cronología.' },
  yearOnly: {
    title: 'Solo el año',
    sub: 'Ya están en su año; si sabes el mes, quedarán mejor colocadas.',
  },
  dated: {
    title: 'Con fecha',
    sub: 'Ya están en la cronología. Puedes corregir cualquiera.',
  },
  hidden: {
    title: 'Ocultas',
    sub: 'No aparecen en Línea de vida. Siguen intactas en tu Drive.',
  },
};

export const emptyCopy: Record<Pile, { title: string; text: string }> = {
  undated: {
    title: 'Nada sin fecha',
    text: 'Todas las fotos de esta vista ya están en la cronología.',
  },
  yearOnly: {
    title: 'Nada solo con el año',
    text: 'No hay fotos pendientes de mes en esta vista.',
  },
  dated: {
    title: 'Aún no hay fotos con fecha',
    text: 'Cuando pongas fecha a alguna, aparecerá aquí.',
  },
  hidden: {
    title: 'No hay fotos ocultas',
    text: 'Lo que ocultes aparecerá aquí para poder recuperarlo.',
  },
};

export function headline(counts: { undated: number; yearOnly: number; total: number }) {
  if (counts.total === 0) return 'Aún no hay fotos que ordenar. Añade una carpeta desde Ajustes.';
  if (counts.undated + counts.yearOnly === 0)
    return `Todo está en su sitio: ${photoCountText(counts.total)} con fecha.`;
  return `Tienes ${photoCountText(counts.undated)} sin fecha y ${photoCountText(counts.yearOnly)} con solo el año. Selecciónalas y ponles fecha; aparecerán en su sitio de la cronología.`;
}

const KIND_LABELS: Record<string, string> = {
  whatsapp: 'de WhatsApp',
  'android-camera': 'de la cámara del móvil',
  pixel: 'de un Pixel',
  screenshot: 'capturas de pantalla',
  messenger: 'de Messenger',
  timestamp: 'con una marca de fecha',
};

/** Banner text for the filename suggestions: how many, what kind, and one real example. */
export function suggestionText(suggestions: FilenameSuggestions) {
  const [top] = suggestions.groups;
  const kind = top && suggestions.groups.length === 1 ? KIND_LABELS[top.kind] : undefined;
  const title =
    suggestions.totalCount === 1
      ? '1 foto lleva la fecha en el nombre.'
      : `${suggestions.totalCount.toLocaleString('es-ES')} fotos llevan la fecha en el nombre${kind ? ` (${kind})` : ''}.`;
  const example = top?.examples[0];
  const exampleDate = example ? storedLabel(example.date, 'DAY') : null;
  const detail =
    example && exampleDate ? `Por ejemplo «${example.fileName}» es del ${exampleDate}.` : '';
  return { title, detail };
}

export const photoAria = (photo: OrderingPhoto) => {
  const date = storedLabel(photo.effectiveDate.value, photo.effectiveDate.precision);
  return `${photo.fileName}, ${date ?? 'sin fecha'}`;
};
