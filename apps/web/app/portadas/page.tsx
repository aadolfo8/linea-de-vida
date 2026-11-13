import { ProtectedSurface } from '../components/ProtectedSurface';
import { PortadasScreen } from './PortadasScreen';

export default function PortadasPage() {
  return (
    <ProtectedSurface tone="sky">
      {(session) => <PortadasScreen session={session} />}
    </ProtectedSurface>
  );
}
