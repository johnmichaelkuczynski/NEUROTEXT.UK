import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

function routeStatusPlugin(): Plugin {
  const normalizedBase = basePath === '/' ? '' : `/${basePath.replace(/^\/|\/$/g, '')}`;
  const publicRoutes = new Set(['/', '/diagnostics', '/page-1', '/page-2', '/page-3', '/page-4', '/page-5', '/page-6', '/page-7', '/page-8', '/page-9', '/page-10', '/page-11', '/page-12', '/page-13', '/page-14', '/page-15']);

  const install = (middlewares: Connect.Server) => {
    middlewares.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        next();
        return;
      }

      const acceptsHtml = request.headers.accept?.includes('text/html');
      if (!acceptsHtml) {
        next();
        return;
      }

      const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
      const routePath = normalizedBase && requestPath.startsWith(normalizedBase)
        ? requestPath.slice(normalizedBase.length) || '/'
        : requestPath;

      if (publicRoutes.has(routePath)) {
        next();
        return;
      }

      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('X-Robots-Tag', 'noindex');
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — NEUROTEXT</title></head><body><main><h1>Page not found</h1><p>The requested page does not exist.</p><a href="${normalizedBase || '/'}">Return to NEUROTEXT</a></main></body></html>`);
    });
  };

  return {
    name: 'neurotext-route-status',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    routeStatusPlugin(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
