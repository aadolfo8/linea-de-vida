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
        {children}
        <ContextCursor />
      </body>
    </html>
  );
}
