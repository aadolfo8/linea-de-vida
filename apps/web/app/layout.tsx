import type { Metadata } from 'next';
import { ContextCursor } from './components/ContextCursor';
import './globals.css';
export const metadata: Metadata = {
  title: 'Línea de vida',
  description: 'Your photos, honestly ordered in time.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {/* THESIS: A private archive is a route through real time, never a dashboard. OWN-WORLD: ink-black fields, lime route marks, raw authenticated photography, and fine spatial lines. STORY: visitors enter privately, move through loaded memories, and configure only explicit Drive folders. FIRST VIEWPORT: the welcome is a quiet access threshold; the timeline is a full-height route. FORM: editorial route sequence, approved immersive direction. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md. */}
        {children}
        <ContextCursor />
      </body>
    </html>
  );
}
