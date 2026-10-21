'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, FolderCog, Settings2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { apiJson } from '../../lib/api';

const links = [
  { href: '/timeline', label: 'Cronología', icon: CalendarDays },
  { href: '/organizar', label: 'Organizar', icon: FolderCog },
  { href: '/settings', label: 'Ajustes', icon: Settings2 },
] as const;

export function ArchiveNav({
  name,
  timelinePath = '/timeline',
  variant = 'paper',
}: {
  name?: string | null;
  timelinePath?: string;
  /** `sky` is the compact, quiet version that sits over the night sky of the timeline. */
  variant?: 'paper' | 'sky';
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      await apiJson<void>('/auth/logout', { method: 'POST' });
      router.replace('/');
      router.refresh();
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  };

  const isCurrent = (href: string) =>
    href === '/timeline'
      ? pathname === '/timeline' || pathname.startsWith('/timeline/')
      : pathname === href;

  if (variant === 'sky')
    return (
      <header className="archive-nav sky-nav">
        <nav aria-label="Navegación principal">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              data-cursor="route"
              href={href === '/timeline' ? timelinePath : href}
              aria-current={isCurrent(href) ? 'page' : undefined}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <p
          className="session-status sky-nav-user"
          aria-label={name ? `Sesión de ${name}` : 'Sesión activa'}
        >
          <i aria-hidden="true" />
          {name ?? 'Sesión activa'}
        </p>
        <button type="button" onClick={() => void signOut()} disabled={signingOut}>
          {signingOut ? 'Saliendo…' : 'Cerrar sesión'}
        </button>
        {signOutError && (
          <span className="sr-only" role="alert">
            No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.
          </span>
        )}
      </header>
    );

  return (
    <header className="archive-nav sticky top-0 z-20 grid min-h-[72px] grid-cols-[1fr_auto_1fr] items-center gap-6 border-b border-map-line bg-map-paper px-[5vw] text-map-ink max-[680px]:min-h-16 max-[680px]:grid-cols-[1fr_auto] max-[680px]:px-[18px]">
      <Link
        className="inline-flex min-h-11 items-center text-[0.8rem] font-bold uppercase tracking-[0.08em] text-inherit no-underline"
        href={timelinePath}
        aria-label="Línea de vida, ir a la cronología"
      >
        Línea de vida
      </Link>
      <nav
        className="flex gap-1 max-[680px]:order-3 max-[680px]:col-span-full max-[680px]:w-full max-[680px]:justify-between max-[680px]:gap-0 max-[680px]:overflow-x-auto"
        aria-label="Navegación principal"
      >
        <Link
          className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-map-muted no-underline transition-colors hover:text-map-route aria-[current=page]:bg-map-route-soft aria-[current=page]:text-map-ink max-[680px]:shrink-0 max-[680px]:px-2 max-[680px]:whitespace-nowrap"
          data-cursor="route"
          href={timelinePath}
          aria-current={
            pathname === '/timeline' || pathname.startsWith('/timeline/') ? 'page' : undefined
          }
        >
          <CalendarDays aria-hidden="true" className="size-4" />
          <span>Cronología</span>
        </Link>
        <Link
          className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-map-muted no-underline transition-colors hover:text-map-route aria-[current=page]:bg-map-route-soft aria-[current=page]:text-map-ink max-[680px]:shrink-0 max-[680px]:px-2 max-[680px]:whitespace-nowrap"
          data-cursor="route"
          href="/organizar"
          aria-current={pathname === '/organizar' ? 'page' : undefined}
        >
          <FolderCog aria-hidden="true" className="size-4" />
          <span>Organizar</span>
        </Link>
        <Link
          className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-map-muted no-underline transition-colors hover:text-map-route aria-[current=page]:bg-map-route-soft aria-[current=page]:text-map-ink max-[680px]:shrink-0 max-[680px]:px-2 max-[680px]:whitespace-nowrap"
          data-cursor="route"
          href="/settings"
          aria-current={pathname === '/settings' ? 'page' : undefined}
        >
          <Settings2 aria-hidden="true" className="size-4" />
          <span>Ajustes</span>
        </Link>
      </nav>
      <div className="flex items-center justify-self-end gap-2 max-[680px]:col-start-2 max-[680px]:row-start-1">
        <p
          className="session-status flex items-center gap-2 text-[0.82rem] text-map-muted max-[420px]:sr-only"
          aria-label={name ? `Sesión de ${name}` : 'Sesión activa'}
        >
          <span className="size-2 rounded-full bg-map-route" aria-hidden="true" />
          {name ?? 'Sesión activa'}
        </p>
        <Button variant="outline" size="sm" onClick={() => void signOut()} disabled={signingOut}>
          {signingOut ? 'Saliendo…' : 'Cerrar sesión'}
        </Button>
        {signOutError && (
          <span className="sr-only" role="alert">
            No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.
          </span>
        )}
      </div>
    </header>
  );
}
