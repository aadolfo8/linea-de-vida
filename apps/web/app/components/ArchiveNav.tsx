'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ArchiveNav({
  name,
  timelinePath = '/timeline',
}: {
  name?: string | null;
  timelinePath?: string;
}) {
  const pathname = usePathname();
  return (
    <header className="archive-nav">
      <Link
        className="archive-mark"
        href={timelinePath}
        aria-label="Línea de vida, ir a la cronología"
      >
        Línea de vida
      </Link>
      <nav aria-label="Navegación principal">
        <Link
          data-cursor="route"
          href={timelinePath}
          aria-current={
            pathname === '/timeline' || pathname.startsWith('/timeline/') ? 'page' : undefined
          }
        >
          Cronología
        </Link>
        <Link
          data-cursor="route"
          href="/settings"
          aria-current={pathname === '/settings' ? 'page' : undefined}
        >
          Ajustes
        </Link>
      </nav>
      <p className="session-status" aria-label={name ? `Sesión de ${name}` : 'Sesión activa'}>
        <span aria-hidden="true" />
        {name ?? 'Sesión activa'}
      </p>
    </header>
  );
}
