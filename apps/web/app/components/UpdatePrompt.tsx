import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Offers a new version of the app once its files are downloaded. The person decides when to
 * reload, so an ordering session is never interrupted.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-2 rounded-lg border border-white/15 bg-sky-ink-2 p-2 pl-4 text-sm text-sky-fg shadow-lg"
    >
      <span className="flex-1">Hay una versión nueva de Línea de vida.</span>
      <button
        type="button"
        className="min-h-11 px-3 text-sky-accent"
        onClick={() => void updateServiceWorker(true)}
      >
        Actualizar
      </button>
      <button
        type="button"
        className="min-h-11 px-3 text-sky-mute"
        onClick={() => setNeedRefresh(false)}
      >
        Luego
      </button>
    </div>
  );
}
