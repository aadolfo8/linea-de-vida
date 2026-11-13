import { TimelineRoute } from '../components/TimelineRoute';
import { TimelineFocusProvider } from '../components/TimelineFocus';

/**
 * The one route for every depth of the timeline (`/timeline/*`), so the shell survives navigation
 * between depths: the sky, the session and the travel transition all continue while
 * `TimelineRoute` reads the pathname and picks what to show.
 */
export default function TimelineLayout() {
  return (
    <div className="sky-scope">
      <TimelineFocusProvider>
        <TimelineRoute />
      </TimelineFocusProvider>
    </div>
  );
}
