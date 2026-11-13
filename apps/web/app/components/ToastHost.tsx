import { SkyToast, type SkyToastProps } from './SkyToast';

export type ToastData = Pick<SkyToastProps, 'message' | 'tone' | 'link'> & {
  key: number;
  undo?: () => Promise<void> | void;
  retry?: () => Promise<void> | void;
};

/**
 * Renders the current toast. Acting on it (undo, retry) dismisses it first, so the action never
 * runs while its own message is still on screen.
 */
export function ToastHost({
  toast,
  busy,
  onDismiss,
}: {
  toast: ToastData | null;
  busy: boolean;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  const { undo, retry } = toast;
  return (
    <SkyToast
      key={toast.key}
      message={toast.message}
      tone={toast.tone}
      link={toast.link}
      busy={busy}
      onUndo={
        undo
          ? () => {
              onDismiss();
              void undo();
            }
          : undefined
      }
      onRetry={
        retry
          ? () => {
              onDismiss();
              void retry();
            }
          : undefined
      }
      onDismiss={onDismiss}
    />
  );
}
