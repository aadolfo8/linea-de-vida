import { Bodoni_Moda, Figtree, Martian_Mono } from 'next/font/google';
import { TimelineRoute } from '../components/TimelineRoute';
import { TimelineFocusProvider } from '../components/TimelineFocus';

// The night sky has its own type: an editorial display face, a mono for labels, a quiet UI sans.
const display = Bodoni_Moda({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-sky-display',
});
const mono = Martian_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-sky-mono' });
const ui = Figtree({ subsets: ['latin'], display: 'swap', variable: '--font-sky-ui' });

/**
 * The timeline shell lives in the layout so it survives navigation between depths: the sky,
 * the session and the travel transition all continue while the pages below only pick the route.
 */
export default function TimelineLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sky-scope ${display.variable} ${mono.variable} ${ui.variable}`}>
      <TimelineFocusProvider>
        <TimelineRoute />
        {children}
      </TimelineFocusProvider>
    </div>
  );
}
