import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages cannot send headers, so the Content Security Policy lives in a
// <meta> tag (verification B11, B12). The dev server needs websocket access for
// hot reload and inline <style> for injected CSS; production gets neither.
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
const CSP_DEV = CSP_PROD
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace('connect-src https://api.github.com', "connect-src 'self' ws: https://api.github.com");

function csp(): Plugin {
  let dev = false;
  return {
    name: 'planner-csp',
    configResolved(c) { dev = c.command === 'serve'; },
    transformIndexHtml(html) { return html.replace('%CSP%', dev ? CSP_DEV : CSP_PROD); },
  };
}

export default defineConfig({
  base: '/project-planner/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    csp(),
    preact(),
    VitePWA({
      registerType: 'prompt',       // never reload under an unsaved edit
      injectRegister: false,        // registered from main.tsx; no inline script
      manifest: {
        name: 'Project Planner',
        short_name: 'Planner',
        description: 'Projects, sub-projects and tasks, offline-first, stored in git.',
        start_url: '/project-planner/',
        scope: '/project-planner/',
        display: 'standalone',
        background_color: '#1C1714',
        theme_color: '#1C1714',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/project-planner/index.html',
      },
    }),
  ],
});
