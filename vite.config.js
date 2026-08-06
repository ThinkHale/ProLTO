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
}))
