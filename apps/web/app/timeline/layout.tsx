import { TimelineFocusProvider } from '../components/TimelineFocus';

export default function TimelineLayout({ children }: { children: React.ReactNode }) {
  return <TimelineFocusProvider>{children}</TimelineFocusProvider>;
}
