'use client';

import { ArchiveNav } from './ArchiveNav';
import { ProtectedSurface } from './ProtectedSurface';
import { TimelineExperience } from './TimelineExperience';

export function TimelineRoute() {
  return (
    <ProtectedSurface>
      {(session) => (
        <>
          <ArchiveNav name={session.user.displayName} />
          <TimelineExperience />
        </>
      )}
    </ProtectedSurface>
  );
}
