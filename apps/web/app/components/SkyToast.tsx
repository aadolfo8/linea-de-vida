'use client';

import Link from 'next/link';

export type SkyToastProps = {
  message: string;
  tone: 'ok' | 'error';
  link?: { href: string; label: string };
  onUndo?: () => void;
  onRetry?: () => void;
  onDismiss: () => void;
  busy?: boolean;
};

/** The one message after a change: what happened, and the way back (undo) or forward (retry). */
export function SkyToast({ message, tone, link, onUndo, onRetry, onDismiss, busy }: SkyToastProps) {
  return (
    <div className={`sp-toast ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <span>{message}</span>
      {link && <Link href={link.href}>{link.label}</Link>}
      {onUndo && (
        <button type="button" disabled={busy} onClick={onUndo}>
          Deshacer
        </button>
      )}
      {onRetry && (
        <button type="button" disabled={busy} onClick={onRetry}>
          Reintentar
        </button>
      )}
      {(tone === 'error' || !onUndo) && (
        <button type="button" className="quiet" onClick={onDismiss} aria-label="Cerrar aviso">
          Cerrar
        </button>
      )}
    </div>
  );
}
