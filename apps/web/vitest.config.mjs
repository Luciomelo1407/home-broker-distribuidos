import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O Next usa o runtime automático de JSX; os testes de componentes usam o mesmo.
  oxc: { jsx: { runtime: 'automatic' } },
});
