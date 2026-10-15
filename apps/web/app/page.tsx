'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, FolderHeart, LockKeyhole } from 'lucide-react';
import { apiCall, apiJson, isUnauthenticated, type Session } from '../lib/api';
import { Button } from '../components/ui/button';

const oauthNotice = (value: string | null) =>
  value === 'access-denied'
    ? 'Has cancelado el acceso. Tus recuerdos siguen tal como estaban.'
    : value === 'login-denied'
      ? 'Google no pudo completar el acceso. Comprueba tu cuenta e inténtalo de nuevo.'
      : value === 'drive-denied'
        ? 'No se concedió el acceso de solo lectura a Drive. Puedes intentarlo de nuevo desde Ajustes.'
        : '';

const assurances = [
  { icon: LockKeyhole, label: 'Tu espacio privado' },
  { icon: FolderHeart, label: 'Tú eliges las carpetas' },
  { icon: Eye, label: 'Drive, solo lectura' },
];

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [message, setMessage] = useState('');
  const [development, setDevelopment] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    const notice = oauthNotice(new URLSearchParams(window.location.search).get('oauth'));
    setMessage(notice);
    setMessageIsError(Boolean(notice));
    apiJson<Session>('/me')
      .then(() => router.replace('/timeline'))
      .catch((error: unknown) => {
        if (!isUnauthenticated(error)) {
          setMessage(
            'No pudimos comprobar la sesión. Puedes volver a intentarlo al iniciar sesión.',
          );
          setMessageIsError(true);
        }
        setStatus('ready');
      });
  }, [router]);

  const signIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setMessage('Preparando tu entrada…');
    setMessageIsError(false);
    try {
      const response = await apiCall('/auth/google/authorize', { method: 'POST' });
      if (!response.ok) throw new Error('oauth');
      const data = (await response.json()) as {
        available?: boolean;
        authorizationUrl?: string;
        message?: string;
      };
      if (data.available && data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setDevelopment(true);
      setMessage(data.message ?? 'El acceso con Google no está disponible ahora mismo.');
      setMessageIsError(true);
    } catch {
      setMessage(
        'No se pudo iniciar sesión con Google. Comprueba la conexión e inténtalo de nuevo.',
      );
      setMessageIsError(true);
    } finally {
      setSigningIn(false);
    }
  };

  const devLogin = async () => {
    setSigningIn(true);
    setMessage('Preparando tu espacio…');
    setMessageIsError(false);
    try {
      const response = await apiCall('/auth/development-login', { method: 'POST' });
      if (response.ok) router.replace('/timeline');
      else {
        setMessage('El acceso de desarrollo no está disponible mientras Google esté configurado.');
        setMessageIsError(true);
      }
    } catch {
      setMessage('No se pudo abrir el espacio. Comprueba la conexión e inténtalo de nuevo.');
      setMessageIsError(true);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <main
      aria-busy={status === 'checking'}
      className="relative flex min-h-dvh flex-col overflow-x-clip bg-map-paper px-5 pb-3 pt-2 text-map-ink sm:px-8 sm:pb-6 sm:pt-5 lg:px-[clamp(40px,7vw,112px)] lg:pt-7"
    >
      <a
        className="fixed left-3 top-[-60px] z-30 bg-map-active px-4 py-3 font-bold text-map-ink focus:top-3"
        href="#access"
      >
        Saltar al acceso
      </a>

      <header className="relative z-10 flex min-h-11 items-center justify-between gap-4">
        <Link
          className="inline-flex min-h-11 items-center gap-3 text-[0.78rem] font-extrabold uppercase tracking-[0.12em] text-map-ink no-underline"
          href="/"
          aria-label="Línea de vida, inicio"
        >
          <span className="relative grid size-9 place-items-center rounded-full border-2 border-map-route">
            <span className="absolute left-[7px] top-[16px] h-[2px] w-[19px] rotate-[-27deg] bg-map-active" />
            <span className="absolute left-[6px] top-[14px] size-1.5 rounded-full bg-map-route" />
            <span className="absolute right-[5px] top-[7px] size-1.5 rounded-full bg-map-active" />
          </span>
          Línea de vida
        </Link>
        <span className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-map-muted sm:flex">
          <span className="size-2 rounded-full bg-map-active" aria-hidden="true" />
          Un lugar para volver
        </span>
      </header>

      <div className="mx-auto grid w-full max-w-[1440px] flex-1 grid-rows-[auto_1fr] items-center gap-4 py-3 sm:gap-7 sm:py-7 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:grid-rows-1 lg:gap-[clamp(40px,7vw,104px)] lg:py-3">
        <section className="order-2 relative z-10 mx-auto w-full max-w-[36rem] lg:order-1 lg:mx-0">
          <p className="mb-2 flex items-center gap-3 text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-map-route sm:mb-5 sm:text-xs">
            <span className="h-px w-8 bg-map-active" aria-hidden="true" />
            Un archivo familiar, a tu manera
          </p>
          <h1 className="m-0 max-w-[15ch] text-[clamp(2.35rem,8vw,5.85rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-balance sm:max-w-[11ch] lg:text-[clamp(4.2rem,6.6vw,6.25rem)]">
            Tus recuerdos, siempre cerca.
          </h1>
          <p className="mb-0 mt-3 max-w-[36rem] text-[clamp(0.94rem,1.5vw,1.13rem)] leading-[1.5] text-map-muted text-pretty sm:mt-6">
            Vuelve a tus fotografías, recorre el tiempo y descubre momentos que guardaste. Un
            espacio privado para los recuerdos que importan.
          </p>

          <div
            id="access"
            className="mt-4 grid justify-items-start gap-2 scroll-mt-6 sm:mt-7 sm:gap-3"
          >
            <Button
              size="lg"
              className="group min-h-14 w-full justify-between rounded-xl bg-map-ink px-3 text-map-paper transition-[background,transform] hover:-translate-y-0.5 hover:bg-map-route sm:w-auto sm:min-w-[19rem] sm:px-5"
              onClick={() => void signIn()}
              disabled={signingIn}
            >
              <span className="flex items-center gap-3">
                <GoogleMark />
                {signingIn ? 'Preparando el acceso…' : 'Iniciar sesión con Google'}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="hidden size-4 transition-transform group-hover:translate-x-1 sm:block"
              />
            </Button>
            <p className="m-0 max-w-[36rem] text-xs leading-relaxed text-map-muted sm:text-sm">
              Entras con Google; después eliges las carpetas de Drive que quieres incluir.
            </p>
            {development && (
              <Button
                variant="outline"
                size="lg"
                className="mt-1 rounded-xl"
                onClick={() => void devLogin()}
                disabled={signingIn}
              >
                Entrar en modo de desarrollo
              </Button>
            )}
            {message && (
              <p
                className="m-0 max-w-[36rem] text-sm leading-relaxed text-map-danger"
                role={messageIsError ? 'alert' : 'status'}
                aria-live={messageIsError ? 'assertive' : 'polite'}
              >
                {message}
              </p>
            )}
          </div>
        </section>

        <MemoryAtlasArtwork />
      </div>

      <ul className="mx-auto grid w-full max-w-[1440px] list-none grid-cols-3 gap-2 border-t border-map-line pt-3.5 sm:gap-5 sm:pt-5 lg:gap-8">
        {assurances.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-2 text-[0.66rem] font-semibold leading-tight text-map-muted sm:gap-3 sm:text-sm"
          >
            <Icon
              aria-hidden="true"
              className="size-4 shrink-0 text-map-route sm:size-[18px]"
              strokeWidth={1.8}
            />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-[18px] shrink-0" viewBox="0 0 48 48">
      <path
        fill="#4285F4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
      />
      <path
        fill="#34A853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"
      />
      <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
      <path
        fill="#EA4335"
        d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.9 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z"
      />
    </svg>
  );
}

function MemoryAtlasArtwork() {
  return (
    <figure className="order-1 relative mx-auto my-0 h-[clamp(11rem,30dvh,16rem)] w-full max-w-[620px] overflow-hidden rounded-[1.5rem] bg-map-route-soft/70 lg:order-2 lg:aspect-[1.08/1] lg:h-auto lg:max-h-[min(65dvh,620px)] lg:rounded-[2rem]">
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 720 620"
        role="img"
        aria-labelledby="atlas-title atlas-description"
        preserveAspectRatio="xMidYMid slice"
      >
        <title id="atlas-title">Mapa ilustrado de recuerdos familiares</title>
        <desc id="atlas-description">
          Una ruta coral conecta tres hitos sobre un mapa verde azulado, alrededor de una fotografía
          ilustrada.
        </desc>
        <defs>
          <pattern id="atlas-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M36 0H0v36" fill="none" stroke="#1d7780" strokeOpacity=".1" strokeWidth="1" />
          </pattern>
          <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow
              dx="0"
              dy="20"
              stdDeviation="18"
              floodColor="#0c2935"
              floodOpacity=".18"
            />
          </filter>
          <clipPath id="photo-window">
            <rect x="192" y="130" width="340" height="326" rx="9" />
          </clipPath>
        </defs>
        <rect width="720" height="620" fill="#a8d9d1" />
        <rect width="720" height="620" fill="url(#atlas-grid)" />
        <path
          d="M-45 125C70 35 126 170 225 107s126-102 225-35 113 73 220-9 119 18 112 89v-210H-45Z"
          fill="#1d7780"
          fillOpacity=".12"
        />
        <path
          d="M-30 496c102-108 155-13 251-89s146-62 233 8 129 74 207 6 90-38 100 12v235H-30Z"
          fill="#e96b4d"
          fillOpacity=".15"
        />
        <path
          d="M46 480c50-72 89-102 140-107 57-6 79 46 134 28 58-18 48-91 108-102 49-9 78 36 116 7 31-24 28-72 67-93 30-16 70-8 111 7"
          fill="none"
          stroke="#f1efe8"
          strokeDasharray="2 12"
          strokeLinecap="round"
          strokeWidth="13"
        />
        <path
          d="M46 480c50-72 89-102 140-107 57-6 79 46 134 28 58-18 48-91 108-102 49-9 78 36 116 7 31-24 28-72 67-93 30-16 70-8 111 7"
          fill="none"
          stroke="#e96b4d"
          strokeLinecap="round"
          strokeWidth="4"
        />
        <g filter="url(#paper-shadow)" transform="rotate(-3 362 293)">
          <rect x="171" y="101" width="382" height="394" rx="20" fill="#fbfaf6" />
          <rect x="184" y="114" width="356" height="358" rx="12" fill="#f1efe8" />
          <g clipPath="url(#photo-window)">
            <rect x="192" y="130" width="340" height="326" fill="#e6ad70" />
            <circle cx="447" cy="205" r="55" fill="#f6d27b" />
            <path
              d="M165 344c65-67 130-37 178-3s76 31 117-6 83-56 127-11v166H165Z"
              fill="#5c9a85"
            />
            <path
              d="M167 382c86-54 139-7 190 19 50 26 104 5 143-28 44-38 79-38 108-14v122H167Z"
              fill="#2d6f6e"
            />
            <path
              d="M199 426c70-45 128-30 179-2s103 30 151-2 70-29 89-21v73H199Z"
              fill="#174d5b"
              fillOpacity=".82"
            />
            <path
              d="M320 451c17-35 34-47 55-39 18 7 27 30 45 39"
              fill="none"
              stroke="#f1efe8"
              strokeLinecap="round"
              strokeWidth="7"
            />
            <path
              d="M359 409c-2-22 3-34 16-38 14-4 24 7 22 27"
              fill="none"
              stroke="#0c2935"
              strokeLinecap="round"
              strokeWidth="10"
            />
            <circle cx="375" cy="360" r="12" fill="#e96b4d" />
            <path
              d="M230 315c20-23 37-35 55-37 21-2 37 12 57 30"
              fill="none"
              stroke="#f1efe8"
              strokeLinecap="round"
              strokeWidth="6"
              opacity=".8"
            />
          </g>
          <path
            d="M203 438c50-36 79-26 112-2"
            fill="none"
            stroke="#f1efe8"
            strokeDasharray="1 9"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <rect x="201" y="464" width="114" height="5" rx="2.5" fill="#1d7780" fillOpacity=".3" />
        </g>
        <g fill="#e96b4d" stroke="#f1efe8" strokeWidth="7">
          <circle cx="46" cy="480" r="13" />
          <circle cx="420" cy="399" r="13" />
          <circle cx="622" cy="214" r="13" />
        </g>
        <g
          fill="#0c2935"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="12"
          fontWeight="800"
          letterSpacing="2"
        >
          <text x="40" y="527">
            UN RECUERDO
          </text>
          <text x="519" y="174">
            TU HISTORIA
          </text>
        </g>
        <g
          transform="translate(604 477)"
          fill="none"
          stroke="#0c2935"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <circle r="31" fill="#f1efe8" fillOpacity=".62" strokeOpacity=".4" />
          <path d="M0 16V-14M0-14l-8 10m8-10 8 10" />
        </g>
      </svg>
      <figcaption className="absolute bottom-3 left-3 rounded-full border border-white/40 bg-map-paper/90 px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-map-ink backdrop-blur-sm sm:bottom-5 sm:left-5 sm:px-4 sm:py-2 sm:text-xs">
        Un mapa hecho de momentos
      </figcaption>
    </figure>
  );
}
