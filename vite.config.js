import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5174, // off 5173 so it can run alongside the housing dashboard
    strictPort: true,
  },
})
