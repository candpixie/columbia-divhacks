import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// TravelTime credentials live in .env.local (TRAVELTIME_APP_ID, TRAVELTIME_API_KEY).
// The dev server adds them to proxied requests so they never reach the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/traveltime': {
          target: 'https://api.traveltimeapp.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/traveltime/, '/v4'),
          headers: {
            'X-Application-Id': env.TRAVELTIME_APP_ID ?? '',
            'X-Api-Key': env.TRAVELTIME_API_KEY ?? '',
          },
        },
      },
    },
  }
})
