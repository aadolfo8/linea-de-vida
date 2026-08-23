'use client';

import { ArchiveNav } from '../components/ArchiveNav';
import { ProtectedSurface } from '../components/ProtectedSurface';
import { TimelineExperience } from '../components/TimelineExperience';

export default function TimelinePage() {
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
