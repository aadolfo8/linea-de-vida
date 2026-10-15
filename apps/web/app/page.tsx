'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall, apiJson, type Session } from '../lib/api';
import { Button } from '../components/ui/button';

const oauthNotice = (value: string | null) =>
  value === 'access-denied'
    ? 'El acceso fue cancelado. Puedes volver a intentarlo cuando quieras.'
    : value === 'login-denied'
      ? 'Google no pudo completar el acceso. Comprueba tu cuenta y vuelve a intentarlo.'
      : value === 'drive-denied'
        ? 'No se concedió acceso de solo lectura a Drive. Vuelve a intentarlo desde Ajustes.'
        : '';

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [message, setMessage] = useState('');
  const [development, setDevelopment] = useState(false);
  useEffect(() => {
    setMessage(oauthNotice(new URLSearchParams(window.location.search).get('oauth')));
    apiJson<Session>('/me')
      .then(() => router.replace('/timeline'))
      .catch(() => setStatus('ready'));
  }, [router]);
  const signIn = async () => {
    setMessage('Preparando un acceso privado con Google…');
    try {
      const response = await apiCall('/auth/google/authorize', { method: 'POST' });
      if (!response.ok) throw new Error('oauth');
      const data = (await response.json()) as {
        available?: boolean;
        authorizationUrl?: string;
        message?: string;
      };
      if (data.available && data.authorizationUrl)
        return window.location.assign(data.authorizationUrl);
      setDevelopment(true);
      setMessage(data.message ?? 'El acceso con Google no está disponible en este momento.');
    } catch {
      setMessage(
        'No se pudo iniciar el acceso con Google. Comprueba la conexión e inténtalo de nuevo.',
      );
    }
  };
  const devLogin = async () => {
    const response = await apiCall('/auth/development-login', { method: 'POST' });
    if (response.ok) router.replace('/timeline');
    else setMessage('El acceso de desarrollo no está disponible mientras Google está configurado.');
  };
  if (status === 'checking')
    return (
      <main
        className="grid min-h-dvh place-items-center bg-map-paper p-6 text-map-ink"
        aria-live="polite"
      >
        Comprobando tu sesión privada…
      </main>
    );
  return (
    <main className="relative grid min-h-dvh grid-cols-[minmax(0,1fr)_minmax(220px,25vw)] items-center gap-[clamp(32px,7vw,112px)] overflow-hidden bg-map-paper p-[clamp(28px,7vw,112px)] text-map-ink max-[680px]:grid-cols-1 max-[680px]:items-start max-[680px]:p-6">
      <a
        className="fixed left-3 top-[-60px] z-20 bg-map-active px-4 py-3 font-bold text-map-ink focus:top-3"
        href="#access"
      >
        Saltar al acceso
      </a>
      <svg
        className="pointer-events-none absolute right-[-6%] top-[3%] h-auto w-[min(64vw,790px)] overflow-visible fill-map-active stroke-map-route opacity-25 [stroke-width:4] [vector-effect:non-scaling-stroke] max-[680px]:right-[-48%] max-[680px]:top-[2%] max-[680px]:w-[105vw] max-[680px]:opacity-[0.17]"
        viewBox="0 0 720 520"
        aria-hidden="true"
      >
        <path
          className="fill-none [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]"
          d="M58 430h164c48 0 64-32 64-78V210c0-53 25-78 78-78h256"
        />
        <path
          className="fill-none [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]"
          d="M286 290h115c52 0 79 27 79 79v61"
        />
        <circle className="stroke-map-paper [stroke-width:4]" cx="58" cy="430" r="10" />
        <circle className="stroke-map-paper [stroke-width:4]" cx="286" cy="290" r="10" />
        <circle className="stroke-map-paper [stroke-width:4]" cx="364" cy="132" r="10" />
        <circle className="stroke-map-paper [stroke-width:4]" cx="560" cy="132" r="10" />
        <circle className="stroke-map-paper [stroke-width:4]" cx="480" cy="430" r="10" />
      </svg>
      <section>
        <p className="relative z-10 mb-[clamp(36px,8vh,88px)] text-xs font-bold uppercase tracking-[0.13em] text-map-route max-[680px]:mb-[42px]">
          Línea de vida
        </p>
        <h1 className="relative z-10 m-0 max-w-[9.5ch] font-serif text-[clamp(3.25rem,8vw,7.25rem)] leading-[0.9] tracking-[-0.04em] text-balance max-[680px]:text-[clamp(3rem,14vw,5.2rem)]">
          Lo que elegiste guardar sigue siendo solo tuyo.
        </h1>
        <p className="relative z-10 my-8 max-w-[52ch] text-[clamp(1.05rem,1.8vw,1.35rem)] leading-[1.55] text-map-muted">
          Un archivo familiar privado para recorrer fotografías en el tiempo, sin inventar fechas ni
          leer más de lo que autorizas.
        </p>
        <div id="access" className="relative z-10 grid items-start gap-3.5">
          <Button size="lg" className="w-fit" onClick={() => void signIn()}>
            Continuar con Google
          </Button>
          {development && (
            <Button variant="outline" size="lg" className="w-fit" onClick={() => void devLogin()}>
              Entrar en desarrollo
            </Button>
          )}
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-map-muted" role="status">
            {message ||
              'Google conecta identidad y acceso de solo lectura a las carpetas que elijas.'}
          </p>
        </div>
      </section>
      <aside className="relative z-10 flex flex-col justify-end gap-4 border-l-2 border-map-route py-6 pl-6 text-map-ink max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-2 max-[680px]:border-l-0 max-[680px]:border-t max-[680px]:border-map-line max-[680px]:pt-6 max-[680px]:pl-0">
        <span className="mb-3 pl-5 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-map-route max-[680px]:col-span-full max-[680px]:pl-0">
          Privado por diseño
        </span>
        <p className="m-0 pl-5 max-[680px]:pl-0">Solo lectura</p>
        <p className="m-0 pl-5 max-[680px]:pl-0">Carpetas explícitas</p>
        <p className="m-0 pl-5 max-[680px]:pl-0">Fechas con precisión real</p>
      </aside>
    </main>
  );
}
