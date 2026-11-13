import { useRef } from 'react';
import { api } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { draftFromStored, draftToPayload } from '../../lib/ordering/dates';
import { thumbnailVariantUrl } from '../../lib/media';
import type {
  DateDraft,
  FolderDateRule,
  FolderDetail,
  OrderingPhoto,
} from '../../lib/ordering/types';
import { photoCountLabel } from '../components/timeline-model';
import { DateSheet } from './DateSheet';
import { FolderDateDialog } from './FolderDateDialog';
import { QuickMode, type QuickResult } from './QuickMode';
import type { useOrderingActions } from './use-ordering-actions';
import type { OrderingData } from './use-ordering-data';

export type Dialog = 'date' | 'folder' | 'quick' | null;

/** The modal sheets of Ordenar: date for the selection, date for a folder, one by one. */
export function OrderingDialogs({
  dialog,
  onClose,
  data,
  actions,
  selected,
  selectedPhotos,
  folder,
  folderRule,
}: {
  dialog: Dialog;
  onClose: () => void;
  data: OrderingData;
  actions: ReturnType<typeof useOrderingActions>;
  selected: ReadonlySet<string>;
  selectedPhotos: OrderingPhoto[];
  folder: FolderDetail | null;
  folderRule: FolderDateRule | null;
}) {
  /** The year the person set last, offered when there is no date to start from. */
  const lastYear = useRef<number | null>(null);
  const folderId = data.location?.folderId ?? null;

  const initialDraft = () => {
    const only = selectedPhotos.length === 1 ? selectedPhotos[0]! : null;
    const stored = only
      ? draftFromStored(only.effectiveDate.value, only.effectiveDate.precision)
      : null;
    return stored ?? { year: lastYear.current, month: null, day: null };
  };

  const applyDate = (draft: DateDraft) => {
    lastYear.current = draft.year;
    onClose();
    void actions.applyDate([...selected], draft);
  };

  const closeQuick = (summary: QuickResult) => {
    onClose();
    if (summary.empty) {
      actions.show({
        tone: 'ok',
        message: 'No queda nada por fechar en esta vista.',
      });
      return;
    }
    if (summary.dated || summary.hidden) {
      notifyArchiveIndexUpdated();
      data.reloadList();
      void data.refreshCounts();
      actions.show({
        tone: 'ok',
        message: `Hecho: ${photoCountLabel(summary.dated)} fechadas${summary.hidden ? ` y ${photoCountLabel(summary.hidden)} ocultas` : ''}.`,
      });
    }
  };

  return (
    <>
      {dialog === 'date' && (
        <DateSheet
          title={`Poner fecha a ${photoCountLabel(selected.size)}`}
          subtitle="Basta con el año. Si sabes el mes o el día, mejor."
          previewUrls={selectedPhotos
            .slice(0, 12)
            .map((photo) => thumbnailVariantUrl(api, photo.thumbnailUrl, 640))}
          extraPhotos={Math.max(0, selected.size - 12)}
          initial={initialDraft()}
          applyText={`Poner a ${photoCountLabel(selected.size)}`}
          onApply={applyDate}
          onCancel={onClose}
        />
      )}
      {dialog === 'folder' && folder && folderId && (
        <FolderDateDialog
          folder={folder}
          folderRule={folderRule}
          defaultIncludeSubfolders={data.location?.includeSubfolders ?? true}
          fallbackYear={lastYear.current}
          onApply={(draft, options) => {
            lastYear.current = draft.year;
            onClose();
            void actions.applyFolderDate(
              { id: folder.id, name: folder.name },
              { ...draftToPayload(draft), ...options },
              folderRule,
            );
          }}
          onCancel={onClose}
        />
      )}
      {dialog === 'quick' && <QuickMode scope={data.scope} onClose={closeQuick} />}
    </>
  );
}
