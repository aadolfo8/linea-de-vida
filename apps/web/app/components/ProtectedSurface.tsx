'use client';

import { useEffect, useState } from 'react';
import { apiJson, isUnauthenticated, type Session } from '../../lib/api';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const load = () => {
    setState('loading');
    apiJson<Session>('/me')
      .then((data) => {
        setSession(data);
        setState('ready');
      })
      .catch((error) => setState(isUnauthenticated(error) ? 'signed-out' : 'error'));
  };
  useEffect(load, []);
  return { session, state, retry: load };
}

export function ProtectedSurface({
  children,
}: {
  children: (session: Session) => React.ReactNode;
}) {
  const { session, state, retry } = useSession();
  useEffect(() => {
    if (state === 'signed-out') window.location.replace('/');
  }, [state]);
  if (state === 'error')
    return (
      <main className="route-pending" aria-live="polite">
        <p>No se pudo comprobar la sesión. Tu archivo sigue intacto.</p>
        <button onClick={retry}>Reintentar</button>
      </main>
    );
  if (state !== 'ready' || !session)
    return (
      <main className="route-pending" aria-live="polite">
        Comprobando tu sesión privada…
      </main>
    );
  return <>{children(session)}</>;
}
