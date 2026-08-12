import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'tmp/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        AbortController: 'readonly',
        console: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        ResizeObserver: 'readonly',
        window: 'readonly',
        XRRigidTransform: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        document: 'readonly',
        Event: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
