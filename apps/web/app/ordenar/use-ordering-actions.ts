'use client';

import { useToast } from '../../lib/use-toast';
import { useCallback, useRef, useState } from 'react';
import { signOutIfExpired } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { orderingApi } from '../../lib/ordering/client';
import {
  draftLabel,
  draftToPayload,
  payloadFromStored,
  storedValueFromPayload,
  timelinePathFor,
} from '../../lib/ordering/dates';
import {
  CLEAR_STATUSES,
  DATE_STATUSES,
  HIDE_STATUSES,
  UNHIDE_STATUSES,
  classifyResults,
  pileForPrecision,
  planRestore,
  withManualDate,
  withMissingAsFailed,
} from '../../lib/ordering/results';
import type {
  DateDraft,
  FolderDateBody,
  FolderDateRule,
  OrderingPhoto,
} from '../../lib/ordering/types';
import { photoCountLabel, timelineHrefWithReturn } from '../components/timeline-model';
import { apiErrorCopy } from '../../lib/sources/errors';
import type { OrderingData } from './use-ordering-data';

export type Toast = {
  key: number;
  message: string;
  tone: 'ok' | 'error';
  link?: { href: string; label: string };
  undo?: () => Promise<void>;
  retry?: () => Promise<void>;
};

const TOAST_MS = 9000;

export const ruleToBody = (rule: FolderDateRule): FolderDateBody | null => {
  const payload = payloadFromStored(rule.dateValue, rule.precision);
  return payload
    ? {
        ...payload,
        includeSubfolders: rule.includeSubfolders,
        overrideCameraDates: rule.overrideCameraDates,
      }
    : null;
};

/**
 * Every change Ordenar can make, each with its undo and its honest failure message. The screen
 * only decides what to apply; this decides what happened and what to tell the person.
 */
export function useOrderingActions(
  data: OrderingData,
  onChanged: (ids: readonly string[]) => void,
) {
  const dataRef = useRef(data);
  dataRef.current = data;
  const {
    toast,
    show: showToast,
    dismiss,
  } = useToast<Omit<Toast, 'key'>>(TOAST_MS, (next) => next.tone === 'ok');
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const show = useCallback(
    (next: Omit<Toast, 'key'>) => {
      showToast(next);
      setAnnouncement(next.message);
    },
    [showToast],
  );

  /** One action at a time; an unexpected error becomes a message with a retry, never silence. */
  const run = useCallback(
    async (action: () => Promise<void>, retry: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await action();
      } catch (error) {
        signOutIfExpired(error);
        show({
          tone: 'error',
          message: apiErrorCopy(
            error,
            'No se pudo completar el cambio. Tus fotos no se han tocado.',
          ),
          retry,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [show],
  );

  /** An undo that fails offers "Reintentar" on that same undo, not a no-op. */
  const undoable = useCallback(
    (action: () => Promise<void>) => {
      const undo = (): Promise<void> => run(action, undo);
      return undo;
    },
    [run],
  );

  /** After a change: refresh the counts and say, for assistive technology, what is left. */
  const settle = useCallback(async (message: string) => {
    const counts = await dataRef.current.refreshCounts();
    if (counts) setAnnouncement(`${message} Quedan ${photoCountLabel(counts.undated)} sin fecha.`);
  }, []);

  const restore = useCallback(
    async (previous: OrderingPhoto[], message: string) => {
      const plan = planRestore(previous);
      let failed = 0;
      for (const step of plan.sets) {
        const result = classifyResults(
          (await orderingApi.setDates(step.ids, step.payload)).results,
          DATE_STATUSES,
        );
        failed += result.failed.length;
      }
      if (plan.clears.length) {
        const result = classifyResults(
          (await orderingApi.clearDates(plan.clears)).results,
          CLEAR_STATUSES,
        );
        failed += result.failed.length;
      }
      notifyArchiveIndexUpdated();
      dataRef.current.reloadList();
      void settle(message);
      show(
        failed
          ? {
              tone: 'error',
              message: `${photoCountLabel(failed)} no se pudieron devolver a como estaban. Recarga la página para ver el estado real.`,
            }
          : { tone: 'ok', message },
      );
    },
    [settle, show],
  );

  const applyDate = useCallback(
    async (ids: string[], draft: DateDraft): Promise<void> => {
      const payload = draftToPayload(draft);
      const label = draftLabel(draft);
      const retry = () => applyDate(ids, draft);
      await run(async () => {
        const d = dataRef.current;
        const previous = ids
          .map((id) => d.catalog.current.get(id))
          .filter((photo): photo is OrderingPhoto => Boolean(photo));
        const result = withMissingAsFailed(
          ids,
          classifyResults((await orderingApi.setDates(ids, payload)).results, DATE_STATUSES),
        );
        const done = result.changed;
        const failed = result.failed;
        if (done.length) {
          const stored = storedValueFromPayload(payload);
          if (d.pile === 'hidden' || pileForPrecision(payload.precision) === d.pile)
            d.patchPhotos(done, (photo) => ({
              ...photo,
              effectiveDate: {
                value: stored,
                precision: payload.precision,
                origin: 'MANUAL',
                originKind: 'manual',
              },
            }));
          else d.removeFromList(done);
          notifyArchiveIndexUpdated();
          onChanged(done);
        }
        const message = done.length
          ? `${photoCountLabel(done.length)} → ${label}${failed.length ? `. ${photoCountLabel(failed.length)} no se pudieron guardar.` : ''}`
          : 'No se pudo poner la fecha. Tus fotos no han cambiado.';
        const doneSet = new Set(done);
        const returnTo = `${window.location.pathname}${window.location.search}`;
        show({
          tone: failed.length ? 'error' : 'ok',
          message,
          link: done.length
            ? {
                href: timelineHrefWithReturn(timelinePathFor(payload), returnTo, 'Ordenar'),
                label: 'Ver en la cronología',
              }
            : undefined,
          undo: done.length
            ? undoable(() =>
                restore(
                  previous.filter((photo) => doneSet.has(photo.id)),
                  'Hecho: las fotos vuelven a como estaban.',
                ),
              )
            : undefined,
          retry: failed.length ? () => applyDate(failed, draft) : undefined,
        });
        if (done.length) void settle(message);
      }, retry);
    },
    [onChanged, restore, run, settle, show, undoable],
  );

  const clearDates = useCallback(
    async (ids: string[]): Promise<void> => {
      await run(
        async () => {
          const d = dataRef.current;
          const manual = withManualDate(
            ids
              .map((id) => d.catalog.current.get(id))
              .filter((photo): photo is OrderingPhoto => Boolean(photo)),
          );
          if (!manual.length) return;
          const target = manual.map((photo) => photo.id);
          const result = withMissingAsFailed(
            target,
            classifyResults((await orderingApi.clearDates(target)).results, CLEAR_STATUSES),
          );
          const changed = new Set(result.changed);
          if (changed.size) {
            notifyArchiveIndexUpdated();
            onChanged(result.changed);
            d.reloadList();
            void settle('Fecha quitada.');
          }
          show({
            tone: result.failed.length ? 'error' : 'ok',
            message: changed.size
              ? `Quitaste la fecha puesta a mano a ${photoCountLabel(changed.size)}.${result.failed.length ? ` ${photoCountLabel(result.failed.length)} no se pudieron cambiar.` : ''}`
              : 'No se pudo quitar la fecha. Tus fotos no han cambiado.',
            undo: changed.size
              ? undoable(() =>
                  restore(
                    manual.filter((photo) => changed.has(photo.id)),
                    'Hecho: las fechas vuelven a como estaban.',
                  ),
                )
              : undefined,
            retry: result.failed.length ? () => clearDates(result.failed) : undefined,
          });
        },
        () => clearDates(ids),
      );
    },
    [onChanged, restore, run, settle, show, undoable],
  );

  const setHidden = useCallback(
    async (ids: string[], hide: boolean): Promise<void> => {
      await run(
        async () => {
          const d = dataRef.current;
          const response = hide ? await orderingApi.hide(ids) : await orderingApi.unhide(ids);
          const result = withMissingAsFailed(
            ids,
            classifyResults(response.results, hide ? HIDE_STATUSES : UNHIDE_STATUSES),
          );
          const left = [...result.changed, ...result.unchanged];
          if (left.length) {
            d.removeFromList(left);
            notifyArchiveIndexUpdated();
            onChanged(left);
          }
          const message = left.length
            ? `${hide ? `${photoCountLabel(left.length)} ocultas. Siguen en tu Drive.` : `${photoCountLabel(left.length)} vuelven a tu archivo.`}${result.failed.length ? ` ${photoCountLabel(result.failed.length)} no se pudieron cambiar.` : ''}`
            : 'No se pudo cambiar la visibilidad. Tus fotos no han cambiado.';
          const changed = result.changed;
          show({
            tone: result.failed.length ? 'error' : 'ok',
            message,
            undo: changed.length
              ? undoable(async () => {
                  const back = hide
                    ? await orderingApi.unhide(changed)
                    : await orderingApi.hide(changed);
                  const undone = classifyResults(
                    back.results,
                    hide ? UNHIDE_STATUSES : HIDE_STATUSES,
                  );
                  notifyArchiveIndexUpdated();
                  dataRef.current.reloadList();
                  void settle('Hecho.');
                  show(
                    undone.failed.length
                      ? {
                          tone: 'error',
                          message: `${photoCountLabel(undone.failed.length)} no se pudieron devolver. Recarga la página para ver el estado real.`,
                        }
                      : { tone: 'ok', message: 'Hecho: las fotos vuelven a estar como antes.' },
                  );
                })
              : undefined,
            retry: result.failed.length ? () => setHidden(result.failed, hide) : undefined,
          });
          if (left.length) void settle(message);
        },
        () => setHidden(ids, hide),
      );
    },
    [onChanged, run, settle, show, undoable],
  );

  const acceptSuggestions = useCallback(async (): Promise<void> => {
    await run(async () => {
      const d = dataRef.current;
      const { appliedCount } = await orderingApi.acceptSuggestions(d.scope);
      notifyArchiveIndexUpdated();
      d.reloadList();
      const message = appliedCount
        ? `${photoCountLabel(appliedCount)} fechadas por su nombre. Si alguna no es correcta, ponle otra fecha.`
        : 'Ninguna foto cambió: ya no había nada que aplicar.';
      show({ tone: 'ok', message });
      void settle(message);
    }, acceptSuggestions);
  }, [run, settle, show]);

  const applyFolderDate = useCallback(
    async (
      folder: { id: string; name: string },
      body: FolderDateBody,
      previous: FolderDateRule | null,
    ): Promise<void> => {
      await run(
        async () => {
          const { affectedCount } = await orderingApi.setFolderDate(folder.id, body);
          notifyArchiveIndexUpdated();
          dataRef.current.reloadList();
          const message = `«${folder.name}» ahora es de ${draftLabel({ year: body.year, month: body.month ?? null, day: body.day ?? null })}. ${photoCountLabel(affectedCount)} cambiadas.`;
          void settle(message);
          show({
            tone: 'ok',
            message,
            undo: undoable(async () => {
              const before = previous ? ruleToBody(previous) : null;
              if (before) await orderingApi.setFolderDate(folder.id, before);
              else await orderingApi.removeFolderDate(folder.id);
              notifyArchiveIndexUpdated();
              dataRef.current.reloadList();
              void settle('Hecho.');
              show({ tone: 'ok', message: `Hecho: «${folder.name}» vuelve a como estaba.` });
            }),
          });
        },
        () => applyFolderDate(folder, body, previous),
      );
    },
    [run, settle, show, undoable],
  );

  const removeFolderDate = useCallback(
    async (
      folder: { id: string; name: string },
      previous: FolderDateRule | null,
    ): Promise<void> => {
      await run(
        async () => {
          const { affectedCount } = await orderingApi.removeFolderDate(folder.id);
          notifyArchiveIndexUpdated();
          dataRef.current.reloadList();
          const message = `Quitaste la fecha de «${folder.name}». ${photoCountLabel(affectedCount)} cambiadas.`;
          void settle(message);
          const before = previous ? ruleToBody(previous) : null;
          show({
            tone: 'ok',
            message,
            undo: before
              ? undoable(async () => {
                  await orderingApi.setFolderDate(folder.id, before);
                  notifyArchiveIndexUpdated();
                  dataRef.current.reloadList();
                  void settle('Hecho.');
                  show({
                    tone: 'ok',
                    message: `Hecho: «${folder.name}» vuelve a como estaba.`,
                  });
                })
              : undefined,
          });
        },
        () => removeFolderDate(folder, previous),
      );
    },
    [run, settle, show, undoable],
  );

  return {
    toast,
    dismiss,
    show,
    announcement,
    setAnnouncement,
    busy,
    applyDate,
    clearDates,
    setHidden,
    acceptSuggestions,
    applyFolderDate,
    removeFolderDate,
  };
}
