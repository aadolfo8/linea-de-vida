import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// `pnpm --filter @linea-de-vida/web icons` regenerates the PNG icons from `public/favicon.svg`.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // The icon already carries the night-sky background, so padding keeps the same colour.
    transparent: { ...minimal2023Preset.transparent, resizeOptions: { background: '#05070d' } },
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#05070d' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#05070d' } },
  },
  images: ['public/favicon.svg'],
});
