/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, webextensions: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  settings: { react: { version: '18' } },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Prime Directive: never log secret material. Flag obvious offenders.
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.object.name='console'] Identifier[name=/mnemonic|secret|seed|privateKey|password/i]",
        message: 'Do not log secret material (mnemonic/seed/private key/password). See AGENT.md §1.',
      },
    ],
  },
  ignorePatterns: ['dist', 'node_modules', '*.config.ts', '*.config.js', 'scripts'],
};
