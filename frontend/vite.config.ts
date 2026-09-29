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
  },
})
