'use client';

import { ArchiveNav } from '../components/ArchiveNav';
import { ArchiveWorkspace } from '../components/ArchiveWorkspace';
import { ProtectedSurface } from '../components/ProtectedSurface';
import { activeDriveConnection } from '../../lib/api';

export default function SettingsPage() {
  return (
    <ProtectedSurface>
      {(session) => (
        <>
          <ArchiveNav name={session.user.displayName} />
          <ArchiveWorkspace
            area="settings"
            sessionConnection={activeDriveConnection(session)}
            userName={session.user.displayName}
            userEmail={session.user.email}
          />
        </>
      )}
    </ProtectedSurface>
  );
}
