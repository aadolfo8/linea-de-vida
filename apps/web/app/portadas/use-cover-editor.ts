'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { coversApi } from '../../lib/covers/client';
import {
  DEFAULT_LIMITS,
  moveChoice,
  sameOrder,
  sameScope,
  scopeKey,
  toggleChoice,
  type CoverScope,
} from '../../lib/covers/model';
import { apiErrorCopy } from '../../lib/sources/errors';
import { useToast } from '../../lib/use-toast';
import { photoCountLabel, type TimelinePhoto } from '../components/timeline-model';
import type { YearData } from './use-covers-data';

const TOAST_MS = 9000;

type CoverToast = {
  message: string;
  tone: 'ok' | 'error';
  link?: { href: string; label: string };
  undo?: () => Promise<void>;
};

/**
 * Editing one cover: the draft order, keyboard focus that follows moved photos, saving and
 * returning to automatic (with undo), and the messages about each.
 */
export function useCoverEditor({
  year,
  scope,
  data,
  reload,
}: {
  year: number | null;
  scope: CoverScope;
  data: YearData | null;
  reload: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast, show, dismiss } = useToast<CoverToast>(TOAST_MS);
  const [announcement, setAnnouncement] = useState('');
  const known = useRef(new Map<string, TimelinePhoto>());
  const focusRequest = useRef<{ id: string; act: string; index: number } | null>(null);

  const limits = data?.covers.limits ?? DEFAULT_LIMITS;
  const limit = limits[scope.kind];
  const saved = data?.covers.items.find((item) => sameScope(item, scope));
  const savedIds = useMemo(() => saved?.photos.map((photo) => photo.id) ?? [], [saved]);
  const dropped = saved?.dropped ?? [];
  const scopeId = scopeKey(scope);

  // A different cover (or fresh data after saving) starts from what is saved.
  useEffect(() => {
    if (!data) return;
    const current = data.covers.items.find((item) => sameScope(item, scope));
    for (const photo of current?.photos ?? []) known.current.set(photo.id, photo);
    setDraft(current?.photos.map((photo) => photo.id) ?? []);
    // `scope` is identified by its key.
  }, [data, scopeId]);

  const dirty = data !== null && !sameOrder(draft, savedIds);
  const canSave = data !== null && !busy && (dirty || dropped.length > 0);
  const hasChoice = savedIds.length > 0 || dropped.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const chosenPhotos = draft
    .map((id) => known.current.get(id))
    .filter((photo): photo is TimelinePhoto => Boolean(photo));

  // Keyboard focus follows a moved or removed photo instead of falling back to the page.
  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) return;
    const items = document.querySelectorAll<HTMLElement>('.cov-strip li');
    if (request.act === 'remove') {
      const next = items[Math.min(request.index, items.length - 1)];
      (
        next?.querySelector<HTMLElement>('[data-act="remove"]') ??
        document.querySelector<HTMLElement>('.cov-grid button')
      )?.focus();
      return;
    }
    const item = document.querySelector<HTMLElement>(`[data-chosen-id="${request.id}"]`);
    const button =
      item?.querySelector<HTMLButtonElement>(`[data-act="${request.act}"]:not(:disabled)`) ??
      item?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    button?.focus();
  }, [draft]);

  const onToggle = (photo: TimelinePhoto) => {
    const result = toggleChoice(draft, photo.id, limit);
    if (result.blocked) {
      setAnnouncement(`La portada ya tiene ${limit} fotos. Quita una para añadir otra.`);
      return;
    }
    known.current.set(photo.id, photo);
    setDraft(result.ids);
    setAnnouncement(
      result.ids.includes(photo.id)
        ? `Foto añadida en el puesto ${result.ids.length}. ${result.ids.length} de ${limit}.`
        : `Foto quitada. ${result.ids.length} de ${limit}.`,
    );
  };
  const onMove = (id: string, delta: -1 | 1) => {
    focusRequest.current = { id, act: delta < 0 ? 'earlier' : 'later', index: 0 };
    const next = moveChoice(draft, id, delta);
    setDraft(next);
    setAnnouncement(`Foto movida al puesto ${next.indexOf(id) + 1} de ${next.length}.`);
  };
  const onRemove = (id: string) => {
    focusRequest.current = { id, act: 'remove', index: draft.indexOf(id) };
    const next = draft.filter((other) => other !== id);
    setDraft(next);
    setAnnouncement(`Foto quitada. ${next.length} de ${limit}.`);
  };

  const failure = async (error: unknown, fallback: string) => {
    show({
      tone: 'error',
      message:
        error instanceof ApiError && error.code === 'COVER_PHOTOS_REJECTED'
          ? 'Alguna foto ya no puede estar en esta portada. Hemos recargado las portadas; revisa tu elección.'
          : apiErrorCopy(error, fallback),
    });
    if (error instanceof ApiError && error.code === 'COVER_PHOTOS_REJECTED') await reload();
  };

  const save = async (): Promise<boolean> => {
    if (year === null || !canSave) return false;
    setBusy(true);
    try {
      await coversApi.save(year, scope, draft);
      notifyArchiveIndexUpdated();
      await reload();
      show({
        tone: 'ok',
        message: draft.length
          ? `Portada guardada: ${photoCountLabel(draft.length)} elegidas.`
          : 'Portada vuelta a automática.',
        link: { href: `/timeline/${year}`, label: 'Verla en la cronología' },
      });
      setAnnouncement('Portada guardada.');
      return true;
    } catch (error) {
      await failure(
        error,
        'No se pudo guardar la portada. Tu elección sigue aquí; inténtalo de nuevo.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (year === null || busy) return;
    const previous = savedIds;
    const target = { year, scope };
    setBusy(true);
    try {
      await coversApi.reset(year, scope);
      notifyArchiveIndexUpdated();
      await reload();
      show({
        tone: 'ok',
        message: 'La portada vuelve a ser automática.',
        undo: previous.length
          ? async () => {
              setBusy(true);
              try {
                await coversApi.save(target.year, target.scope, previous);
                notifyArchiveIndexUpdated();
                await reload();
                setAnnouncement('Portada recuperada.');
              } catch (error) {
                await failure(error, 'No se pudo recuperar la portada.');
              } finally {
                setBusy(false);
              }
            }
          : undefined,
      });
      setAnnouncement('La portada vuelve a ser automática.');
    } catch (error) {
      await failure(error, 'No se pudo volver a la portada automática. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return {
    draft,
    setDraft,
    busy,
    dirty,
    limit,
    dropped,
    hasChoice,
    canSave,
    chosenPhotos,
    toast,
    dismiss,
    announcement,
    onToggle,
    onMove,
    onRemove,
    save,
    reset,
  };
}
