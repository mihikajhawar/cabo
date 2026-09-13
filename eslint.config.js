// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.config.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', process: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    // Enforcement mechanism for §Q's core invariant: packages/game-engine must
    // stay importable and testable with zero framework imports.
    files: ['packages/game-engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'socket.io', message: 'game-engine must stay framework-free.' },
            { name: 'socket.io-client', message: 'game-engine must stay framework-free.' },
            { name: 'express', message: 'game-engine must stay framework-free.' },
            { name: '@prisma/client', message: 'game-engine must stay framework-free.' },
            { name: 'react', message: 'game-engine must stay framework-free.' },
            { name: 'react-dom', message: 'game-engine must stay framework-free.' },
            { name: 'next', message: 'game-engine must stay framework-free.' },
          ],
        },
      ],
    },
  },
);
