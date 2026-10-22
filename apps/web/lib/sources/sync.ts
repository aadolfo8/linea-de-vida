/** What Ajustes knows about a source's reading of Drive, and how it reads it out in Spanish. */
export type SyncRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export type SyncRun = {
  id: string;
  photoSourceId: string;
  status: SyncRunStatus;
  phase?: 'SCANNING' | 'PROCESSING' | string;
  foundCount?: number;
  processedCount?: number;
  issueCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export const isSyncActive = (run: Pick<SyncRun, 'status'> | null | undefined) =>
  run?.status === 'QUEUED' || run?.status === 'RUNNING';

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** "ahora mismo", "hace 5 minutos", "hace 2 horas", "ayer", "hace 3 días", "hace 2 meses". */
export function relativeTime(iso: string | undefined, now: Date = new Date()) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return 'ahora mismo';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return rtf.format(-Math.round(days / 30), 'month');
}

export type SourceState = {
  tone: 'ok' | 'busy' | 'error' | 'idle' | 'off';
  label: string;
  /** Present while a reading is under way and the total is known. */
  progress: { done: number; total: number } | null;
  /** The last reading did not finish; the card offers "Reintentar". */
  failed: boolean;
};

export function describeSource(
  input: { status: string; run: SyncRun | null },
  now: Date = new Date(),
): SourceState {
  const { run } = input;
  if (input.status !== 'ACTIVE')
    return {
      tone: 'off',
      label: 'Drive desconectado · no se pueden buscar fotos nuevas',
      progress: null,
      failed: false,
    };
  if (isSyncActive(run)) {
    const total = run?.foundCount ?? 0;
    const done = Math.min(run?.processedCount ?? 0, total);
    return {
      tone: 'busy',
      label:
        run?.status === 'QUEUED'
          ? 'En cola para leer fotos nuevas…'
          : total > 0
            ? `Leyendo fotos nuevas… ${done.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}`
            : 'Buscando fotos en la carpeta…',
      progress: total > 0 ? { done, total } : null,
      failed: false,
    };
  }
  if (!run)
    return {
      tone: 'idle',
      label: 'Aún no hemos leído esta carpeta',
      progress: null,
      failed: false,
    };
  if (run.status === 'FAILED' || run.status === 'CANCELLED')
    return {
      tone: 'error',
      label:
        run.status === 'FAILED'
          ? 'La última búsqueda no terminó. Tus fotos siguen intactas.'
          : 'La última búsqueda se canceló.',
      progress: null,
      failed: true,
    };
  const when = relativeTime(run.updatedAt, now);
  const issues = run.issueCount ?? 0;
  return {
    tone: 'ok',
    label: `Al día${when ? ` · actualizado ${when}` : ''}${
      run.status === 'PARTIAL' && issues > 0
        ? ` · ${issues.toLocaleString('es-ES')} ${issues === 1 ? 'foto no se pudo leer' : 'fotos no se pudieron leer'}`
        : ''
    }`,
    progress: null,
    failed: false,
  };
}

export type SourceCounts = { total: number; toDate: number; hidden: number };

export const countsFromPiles = (piles: {
  undated: number;
  yearOnly: number;
  total: number;
  hidden: number;
}): SourceCounts => ({
  total: piles.total,
  toDate: piles.undated + piles.yearOnly,
  hidden: piles.hidden,
});
