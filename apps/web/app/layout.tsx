import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Línea de vida',
  description: 'Your photos, honestly ordered in time.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
