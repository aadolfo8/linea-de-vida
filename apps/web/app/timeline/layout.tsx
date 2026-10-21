import { TimelineRoute } from '../components/TimelineRoute';
import { TimelineFocusProvider } from '../components/TimelineFocus';

/**
 * The timeline shell lives in the layout so it survives navigation between depths: the sky,
 * the session and the travel transition all continue while the pages below only pick the route.
 */
export default function TimelineLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sky-scope">
      <TimelineFocusProvider>
        <TimelineRoute />
        {children}
      </TimelineFocusProvider>
    </div>
  );
}
