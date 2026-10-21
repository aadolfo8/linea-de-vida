'use client';

import { ProtectedSurface } from '../components/ProtectedSurface';
import { OrdenarScreen } from './OrdenarScreen';

export default function OrdenarPage() {
  return (
    <ProtectedSurface tone="sky">
      {(session) => <OrdenarScreen session={session} />}
    </ProtectedSurface>
  );
}
