// ESLint flat config (ESLint 10), copied from api-gamification-finances.
//
// Style: neostandard with semicolons enforced (2-space / single-quote /
// semicolon / no-trailing-comma), plus a few type-aware rules.
// Extra for this repo: no-console except console.error, because stdout is
// the MCP stdio protocol channel.
import neostandard, { plugins } from 'neostandard';

const tseslint = plugins['typescript-eslint'];

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '**/._*' // macOS AppleDouble sidecars on exFAT volumes
    ]
  },

  ...neostandard({ ts: true, semi: true }),

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Type-aware safety rules
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-for-in-array': 'error',

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },

  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['error'] }]
    }
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  }
];
