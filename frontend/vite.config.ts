import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// `make screenshots` points the proxy at the demo backend on its own port.
const apiTarget = process.env.QOIMA_API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Headroom for a loaded machine; slow tests are fixed at the cause (see test/user.ts).
    testTimeout: 15000,
    // One jsdom per worker instead of per file, files stay isolated: the full run goes from 17 s to 13 s.
    pool: 'vmThreads',
  },
})
