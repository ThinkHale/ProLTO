import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `--mode vr` serves over HTTPS with a self-signed certificate. WebXR requires a
// secure context, and localhost only counts as secure on the machine serving it
// -- so a headset loading the app over the LAN by IP gets no WebXR at all unless
// the origin is HTTPS. This is the most reliable way to test on a Quest, because
// it runs the headset's own native WebXR stack rather than routing through a PC
// OpenXR runtime. Default modes are untouched, so the Playwright harness keeps
// talking plain HTTP to localhost.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'vr' ? [basicSsl()] : [])],
  base: './',
  build: {
    // Three's ESM core is one indivisible upstream module. It is isolated for
    // long-term caching, while the application and addons remain small chunks.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-addons', test: /node_modules[\\/]three[\\/]examples[\\/]jsm[\\/]/, priority: 4, includeDependenciesRecursively: false },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 3 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
}))
