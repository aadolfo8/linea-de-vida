import { Bodoni_Moda, Figtree, Martian_Mono } from 'next/font/google';

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
 * Class names that expose the sky fonts as CSS variables. They are only variables: nothing
 * changes until a `.sky` / `.sky-scope` surface reads them, so the paper pages keep their look.
 */
export const skyFontVariables = `${display.variable} ${mono.variable} ${ui.variable}`;
