import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

export default [
  globalIgnores(['.next/**', 'next-env.d.ts'], 'Ignore Next.js generated files'),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: ['.'] } },
    rules: { ...nextPlugin.configs.recommended.rules },
  },
];
