import type { Metadata } from 'next';
import { ContextCursor } from './components/ContextCursor';
import { skyFontVariables } from './fonts';
import './globals.css';
export const metadata: Metadata = {
  title: 'Línea de vida',
  description:
    'Un espacio privado para recorrer tus fotografías y recuerdos familiares en el tiempo.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={skyFontVariables}>
        <template
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html:
              '<!-- THESIS: Family memories follow a navigable route through verified time, not a dashboard. OWN-WORLD: survey-paper fields, marine ink, mint routes, coral active stations, and real photographs without filters. STORY: enter privately, travel from years to months to photos, and organize only explicitly selected Drive folders. FIRST VIEWPORT: access details lead into a clear year route; its selected station connects immediately to the photos and months. FORM: transit-wayfinding visual system, approved direction 3 of 7; seed 4bc7ea36. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md. -->',
          }}
        />
        {children}
        <ContextCursor />
      </body>
    </html>
  );
}
