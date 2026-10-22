'use client';

import { ProtectedSurface } from '../components/ProtectedSurface';
import { AjustesScreen } from './AjustesScreen';

export default function AjustesPage() {
  return (
    <ProtectedSurface tone="sky">
      {(session) => <AjustesScreen session={session} />}
    </ProtectedSurface>
  );
}
