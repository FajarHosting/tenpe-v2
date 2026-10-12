import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './server/apiRouter.ts';
import { getRuntimeConfig } from './server/runtimeEnv.ts';
import { getDb } from './server/db.ts';

export async function createExpressApp(options?: { skipVite?: boolean }) {
  const app = express();
  const config = getRuntimeConfig();

  // Initialize database & schema migrations
  getDb();

  // Strict JSON body limit to prevent DoS payload attacks
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  // Mount API routes
  app.use('/api', createApiRouter());

  // Catch-all for unknown /api routes so they never fall through to HTML
  app.use('/api/*', (_req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'API_ENDPOINT_NOT_FOUND',
        message: 'Endpoint API tidak ditemukan.',
      },
    });
  });

  if (!options?.skipVite) {
    const distPath = path.resolve(process.cwd(), 'dist');
    const isProdBuildReady =
      config.isProduction && fs.existsSync(path.join(distPath, 'index.html'));

    if (isProdBuildReady) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  return app;
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'server.ts');

if (isMainModule) {
  const config = getRuntimeConfig();
  createExpressApp()
    .then((app) => {
      app.listen(config.port, '0.0.0.0', () => {
        console.log(
          `[AdViora] Server running on http://0.0.0.0:${config.port} (${config.nodeEnv})`
        );
      });
    })
    .catch((err) => {
      console.error('[AdViora] Failed to start server:', err);
      process.exit(1);
    });
}
