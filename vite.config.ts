import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${env.PORT ?? '3001'}`,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
      css: true,
      // A full console page has to resolve a dozen requests before its first
      // assertion can match, which is slow on a loaded CI runner.
      testTimeout: 30000,
    },
  };
});
