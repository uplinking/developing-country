import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
//
// `base` (the public path prefix the SPA is served under) is driven by VITE_BASE
// so the explorer build is explicit about its root-relative public path.
// `base` must be set in the config itself — it can't be read from client code —
// so we resolve it here with loadEnv (config runs in node; import.meta.env isn't
// available yet). Client code reads the resolved prefix via import.meta.env.BASE_URL
// (see src/base.ts).
//
// Under `vite dev` (port 5173) the Cloudflare Worker isn't running, so /api and
// /mcp don't exist. Proxy them to a locally-running `wrangler dev` (port 8787)
// so prospects / issues / stepper / analyze work in the dev server exactly as
// they do in production (same-origin fetch). If wrangler isn't running the
// proxied calls just fail and those layers show as "unavailable" — no crash.
// The dev default base is '/', so the proxy keys stay '/api' and '/mcp'.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_BASE || '/',
    plugins: [react()],
    build: {
      // MapLibre ships as one compiled module (~1.03 MB minified, ~273 kB gzip),
      // so Rolldown cannot split it internally. Keep it isolated for caching and
      // retain a close ceiling that warns if this known vendor chunk grows.
      chunkSizeWarningLimit: 1050,
      rolldownOptions: {
        // mcp-app.html is the MCP App's own entry: the Worker builds the ui://
        // resource from its tags (src/worker/mcpLoader.ts).
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          'mcp-app': fileURLToPath(new URL('./mcp-app.html', import.meta.url)),
        },
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'maplibre',
                test: /node_modules[\\/]maplibre-gl[\\/]/,
                includeDependenciesRecursively: false,
                priority: 20,
              },
              {
                name: 'react',
                test: /node_modules[\\/](react|react-dom)[\\/]/,
                includeDependenciesRecursively: false,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
        '/mcp': { target: 'http://localhost:8787', changeOrigin: true },
      },
    },
  }
})
