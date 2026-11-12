'use client';

import { orderingApi } from '../../lib/ordering/client';
import { draftFromStored, draftToPayload } from '../../lib/ordering/dates';
import type { DateDraft, FolderDateRule, FolderDetail } from '../../lib/ordering/types';
import { DateSheet, type FolderOptions } from './DateSheet';

/** The date of a whole folder: what it applies to, with a preview of its effect. */
export function FolderDateDialog({
  folder,
  folderRule,
  defaultIncludeSubfolders,
  fallbackYear,
  onApply,
  onCancel,
}: {
  folder: FolderDetail;
  folderRule: FolderDateRule | null;
  /** Used when the folder has no rule yet: the view's own "include subfolders" choice. */
  defaultIncludeSubfolders: boolean;
  /** The year the person set last, offered when the folder has no date yet. */
  fallbackYear: number | null;
  onApply: (draft: DateDraft, options: FolderOptions) => void;
  onCancel: () => void;
}) {
  return (
    <DateSheet
      title={`Fecha para «${folder.name}»`}
      subtitle="Se aplica a todas sus fotos. Si alguna la corriges luego a mano, tu corrección manda."
      previewUrls={[]}
      extraPhotos={0}
      initial={
        (folderRule && draftFromStored(folderRule.dateValue, folderRule.precision)) || {
          year: fallbackYear,
          month: null,
          day: null,
        }
      }
      applyText="Poner fecha a la carpeta"
      folder={{
        initial: {
          includeSubfolders: folderRule?.includeSubfolders ?? defaultIncludeSubfolders,
          overrideCameraDates: folderRule?.overrideCameraDates ?? false,
        },
        loadPreview: (draft, options) =>
          orderingApi.previewFolderDate(folder.id, { ...draftToPayload(draft), ...options }),
      }}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}
