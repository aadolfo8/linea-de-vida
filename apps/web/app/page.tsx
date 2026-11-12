'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/use-reduced-motion';
import { useRouter } from 'next/navigation';
import { apiCall, apiJson, isUnauthenticated, type Session } from '../lib/api';
import { useStarfield } from './components/sky/use-starfield';
import './components/sky/sky.css';
import './welcome.css';

const oauthNotice = (value: string | null) =>
  value === 'access-denied'
    ? 'Has cancelado el acceso. Tus recuerdos siguen tal como estaban.'
    : value === 'login-denied'
      ? 'Google no pudo completar el acceso. Comprueba tu cuenta e inténtalo de nuevo.'
      : value === 'drive-denied'
        ? 'No se concedió el acceso de solo lectura a Drive. Puedes intentarlo de nuevo desde Ajustes.'
        : '';

const guarantees = ['Privado por cuenta', 'Solo carpetas que eliges', 'Drive de solo lectura'];

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [message, setMessage] = useState('');
  const [development, setDevelopment] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [messageIsError, setMessageIsError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() ?? false;
  useStarfield(canvasRef, reduced);

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

  const describedBy = ['welcome-note', message ? 'welcome-message' : ''].filter(Boolean).join(' ');

  return (
    <main className="sky sky-scope welcome" aria-busy={status === 'checking'}>
      <canvas ref={canvasRef} className="welcome-canvas" aria-hidden="true" />
      <ThreadMotif />
      <a className="sky-skip" href="#access">
        Saltar al acceso
      </a>

      <div className="welcome-body">
        <p className="welcome-kicker">
          <i aria-hidden="true" />
          Archivo familiar
        </p>
        <h1 className="welcome-brand">Línea de vida</h1>
        <p className="welcome-purpose">
          Un archivo privado de fotografías familiares, para recorrer por fecha.
        </p>

        <div id="access" className="welcome-access">
          <button
            type="button"
            className="welcome-cta"
            onClick={() => void signIn()}
            disabled={signingIn}
            aria-describedby={describedBy}
          >
            <GoogleMark />
            <span>{signingIn ? 'Preparando el acceso…' : 'Iniciar sesión con Google'}</span>
          </button>
          <p id="welcome-note" className="welcome-note">
            Entras con Google; después eliges las carpetas de Drive que quieres incluir.
          </p>
          {development && (
            <button
              type="button"
              className="welcome-secondary"
              onClick={() => void devLogin()}
              disabled={signingIn}
            >
              Entrar en modo de desarrollo
            </button>
          )}
          {message && (
            <p
              id="welcome-message"
              className="welcome-message"
              data-error={messageIsError ? 'true' : 'false'}
              role={messageIsError ? 'alert' : 'status'}
              aria-live={messageIsError ? 'assertive' : 'polite'}
            >
              {message}
            </p>
          )}
        </div>
      </div>

      <ul className="welcome-guarantees">
        {guarantees.map((label) => (
          <li key={label}>
            <i aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </main>
  );
}

const threadNodes = [
  [90, 300],
  [260, 214],
  [430, 262],
  [610, 150],
  [790, 226],
  [930, 120],
] as const;

/** The timeline's grammar as pure decoration: diamond nodes on a thin thread. No photos, no data. */
function ThreadMotif() {
  return (
    <svg
      className="welcome-thread"
      viewBox="0 0 1000 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={`M${threadNodes.map(([x, y]) => `${x} ${y}`).join(' L')}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {threadNodes.map(([x, y], index) => (
        <rect
          key={`${x}-${y}`}
          x={x - 4}
          y={y - 4}
          width="8"
          height="8"
          transform={`rotate(45 ${x} ${y})`}
          fill={index % 2 ? 'none' : 'currentColor'}
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="welcome-google" viewBox="0 0 48 48">
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
