'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall, apiJson, type Session } from '../lib/api';
import styles from './welcome.module.css';

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
      <main className={styles.pending} aria-live="polite">
        Comprobando tu sesión privada…
      </main>
    );
  return (
    <main className={styles.welcome}>
      <a className={styles.skip} href="#access">
        Saltar al acceso
      </a>
      <div className={styles.orbit} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <section>
        <p className={styles.wordmark}>Línea de vida</p>
        <h1>Lo que elegiste guardar sigue siendo solo tuyo.</h1>
        <p className={styles.lede}>
          Un archivo familiar privado para recorrer fotografías en el tiempo, sin inventar fechas ni
          leer más de lo que autorizas.
        </p>
        <div id="access" className={styles.access}>
          <button onClick={() => void signIn()}>Continuar con Google</button>
          {development && (
            <button className={styles.secondary} onClick={() => void devLogin()}>
              Entrar en desarrollo
            </button>
          )}
          <p role="status">
            {message ||
              'Google conecta identidad y acceso de solo lectura a las carpetas que elijas.'}
          </p>
        </div>
      </section>
      <aside>
        <span>Privado por diseño</span>
        <p>Solo lectura</p>
        <p>Carpetas explícitas</p>
        <p>Fechas con precisión real</p>
      </aside>
    </main>
  );
}
