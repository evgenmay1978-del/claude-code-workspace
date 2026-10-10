import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xterm/')) return 'terminal'
        },
      },
    },
  },
  server: {
    allowedHosts: ['3000-isc6cyi03hvx70o3mzl9q-3fed1ece.us1.manus.computer'],
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: false },
    },
  },
})
