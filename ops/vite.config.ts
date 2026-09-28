/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
