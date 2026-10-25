module.exports = {
  root: true,
  extends: '@react-native',
  env: {
    jest: true,
    es2020: true,
    node: true,
  },
  rules: {
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
