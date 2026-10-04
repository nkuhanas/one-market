import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'packages/bindings/src/**',
      'tests/private-bindings/**',
      'artifacts/**',
      'playwright-report/**',
      'test-results/**',
      '.codex/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/**/*.ts', '*playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
