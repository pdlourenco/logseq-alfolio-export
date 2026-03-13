import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/__mocks__/logseq.mock.js'],
    clearMocks: true,
  },
});
