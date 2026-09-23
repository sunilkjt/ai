import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Project Pages serves from /ai/ — only apply the subpath base for that build.
  base: process.env.GITHUB_PAGES === 'true' ? '/ai/' : '/',
  server: {
    port: 5174,
    host: true,
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
