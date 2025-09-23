module.exports = {
  root: true,
  env: { 
    browser: true, 
    es2020: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.js', 'build', '**/*.test.ts', '**/*.test.tsx'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': 'off',
    'no-unused-vars': 'off',
    'no-undef': 'off',
    'react/prop-types': 'off',
    'no-redeclare': 'off',
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
}