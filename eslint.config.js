import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'tests/acceptance/**'] },
  ...tseslint.configs.recommended,
);
