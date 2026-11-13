import { Link } from '../../lib/link';
import type { ReactNode } from 'react';
import { ArchiveNav } from './ArchiveNav';
import './sky/sky.css';
import './sky/sky-page.css';

/**
 * The night-sky frame of Ordenar and Ajustes: the same top bar as the timeline (brand and the
 * archive menu), a skip link, and one `main` below it.
 */
export function SkyPage({
  name,
  mainId,
  children,
}: {
  name?: string | null;
  mainId: string;
  children: ReactNode;
}) {
  return (
    <div className="sky sky-scope sp-page">
      <a className="sky-skip" href={`#${mainId}`}>
        Saltar al contenido
      </a>
      <header className="sky-bar">
        <div className="sky-where">
          <Link
            className="sky-brand"
            href="/timeline"
            aria-label="Línea de vida, ir a la cronología"
          >
            <i className="sky-brand-mark" aria-hidden="true" />
            <span className="sky-brand-text">Línea de vida</span>
          </Link>
        </div>
        <div className="sky-controls">
          <ArchiveNav variant="sky" name={name} />
        </div>
      </header>
      <main id={mainId} className="sp-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
