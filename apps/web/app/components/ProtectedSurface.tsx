import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { apiJson, isUnauthenticated, type Session } from '../../lib/api';
import { queryClient, SESSION_KEY } from '../../lib/query-client';

/** The signed-in session, shared by every page: `/me` is asked once per few minutes, not per page. */
export function useSession() {
  const query = useQuery(
    { queryKey: SESSION_KEY, queryFn: () => apiJson<Session>('/me') },
    queryClient,
  );
  const state: 'loading' | 'ready' | 'signed-out' | 'error' = query.isError
    ? isUnauthenticated(query.error)
      ? 'signed-out'
      : 'error'
    : query.data
      ? 'ready'
      : 'loading';
  return { session: query.data ?? null, state, retry: () => void query.refetch() };
}

export function ProtectedSurface({
  children,
  tone = 'paper',
}: {
  children: (session: Session) => React.ReactNode;
  /** `sky` renders the waiting and error states in the night-sky palette (the timeline). */
  tone?: 'paper' | 'sky';
}) {
  const { session, state, retry } = useSession();
  useEffect(() => {
    if (state === 'signed-out') window.location.replace('/');
  }, [state]);
  if (tone === 'sky' && (state !== 'ready' || !session))
    return state === 'error' ? (
      <main className="sky sky-gate" aria-live="polite">
        <p>No se pudo comprobar la sesión. Tu archivo sigue intacto.</p>
        <button type="button" onClick={retry}>
          Reintentar
        </button>
      </main>
    ) : (
      <main className="sky sky-gate" aria-live="polite">
        <p className="sky-wait">Comprobando tu sesión privada…</p>
      </main>
    );
  if (state === 'error')
    return (
      <main
        className="grid min-h-dvh place-items-center bg-map-paper p-6 text-map-ink"
        aria-live="polite"
      >
        <p>No se pudo comprobar la sesión. Tu archivo sigue intacto.</p>
        <Button onClick={retry}>Reintentar</Button>
      </main>
    );
  if (state !== 'ready' || !session)
    return (
      <main
        className="grid min-h-dvh place-items-center bg-map-paper p-6 text-map-ink"
        aria-live="polite"
      >
        Comprobando tu sesión privada…
      </main>
    );
  return <>{children(session)}</>;
}
