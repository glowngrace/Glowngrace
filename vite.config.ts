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
      // The default 'forks' pool pays for a fresh Node process per test file, and
      // the jsdom environment on top of it takes several seconds to build. Under
      // full parallelism the pool gives up waiting for a worker before the
      // slowest file has finished starting, which fails three of the twelve files
      // with "[vitest-pool-runner]: Timeout waiting for worker to respond" even
      // though every one of them passes when it is run on its own.
      // Worker threads reuse this process instead, which starts fast enough to
      // stay inside the pool's own startup deadline, and per-file isolation is
      // kept so a test still cannot see another file's globals.
      pool: 'threads',
    },
  };
});
