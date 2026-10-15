const ARCHIVE_INDEX_STORAGE_KEY = 'linea-de-vida:archive-index-updated';
const ARCHIVE_INDEX_EVENT = 'linea-de-vida:archive-index-updated';

/** Notifies this tab and other same-origin tabs that the local archive index changed. */
export function notifyArchiveIndexUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ARCHIVE_INDEX_EVENT));
  try {
    window.localStorage.setItem(
      ARCHIVE_INDEX_STORAGE_KEY,
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  } catch {
    // The current tab still receives the event when browser storage is unavailable.
  }
}

export function subscribeArchiveIndexUpdated(onUpdate: () => void) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === ARCHIVE_INDEX_STORAGE_KEY) onUpdate();
  };
  window.addEventListener(ARCHIVE_INDEX_EVENT, onUpdate);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ARCHIVE_INDEX_EVENT, onUpdate);
    window.removeEventListener('storage', onStorage);
  };
}
