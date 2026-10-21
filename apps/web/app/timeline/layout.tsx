import { Bodoni_Moda, Figtree, Martian_Mono } from 'next/font/google';
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

export default function TimelineLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sky-scope ${display.variable} ${mono.variable} ${ui.variable}`}>
      <TimelineFocusProvider>{children}</TimelineFocusProvider>
    </div>
  );
}
