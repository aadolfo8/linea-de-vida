'use client';

import { useEffect, useState } from 'react';
import { apiJson, type Session } from '../../lib/api';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  useEffect(() => {
    apiJson<Session>('/me')
      .then((data) => {
        setSession(data);
        setState('ready');
      })
      .catch(() => setState('signed-out'));
  }, []);
  return { session, state };
}

export function ProtectedSurface({
  children,
}: {
  children: (session: Session) => React.ReactNode;
}) {
  const { session, state } = useSession();
  useEffect(() => {
    if (state === 'signed-out') window.location.replace('/');
  }, [state]);
  if (state !== 'ready' || !session)
    return (
      <main className="route-pending" aria-live="polite">
        Comprobando tu sesión privada…
      </main>
    );
  return <>{children(session)}</>;
}
