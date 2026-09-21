import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// API base for the live Indian Market Price (FastAPI) service. Local/dev traffic
// is proxied through this same-origin route (see `server.proxy`) so we never hit
// the Render API's CORS restrictions. Production (Vercel) uses `api/market/[...path].js`.
const MARKET_API_TARGET = 'https://farmer-api-ooi2.onrender.com'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/market': {
        target: MARKET_API_TARGET,
        changeOrigin: true,
        // Strip the `/api/market` prefix before forwarding to Render.
        // FastAPI only serves `/products/` (trailing slash) — without it
        // upstream answers 307 to an absolute Render URL, the browser then
        // follows it cross-origin and CORS blocks the response, so every
        // live lookup silently fails in dev. Normalizing here keeps the
        // frontend URL slash-free (Vercel routing requirement) while the
        // upstream request always hits `/products/` directly (no redirect).
        rewrite: (path) => {
          const stripped = path.replace(/^\/api\/market/, '') || '/';
          return stripped.replace(/^\/products(?=[?#]|$)/, '/products/');
        },
      },
    },
  },
})
