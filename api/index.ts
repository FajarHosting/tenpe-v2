import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createApiRouter } from '../server/apiRouter.ts';
import { getRuntimeConfig } from '../server/runtimeEnv.ts';
import { getDb } from '../server/db.ts';

// Vercel serverless entry point. Do NOT import server.ts here: it imports Vite,
// whose optional Rolldown native binding caused FUNCTION_INVOCATION_FAILED.
let appPromise: Promise<express.Express> | undefined;

async function createApiApp(): Promise<express.Express> {
  const config = getRuntimeConfig();
  // Keep existing DB initialization/schema behavior from the project.
  getDb();

  const app = express();
  app.use(express.json({ limit: '7mb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  const proofDir = path.resolve(process.cwd(), 'data', 'payment-proofs');
  fs.mkdirSync(proofDir, { recursive: true });
  app.use(
    '/uploads/payment-proofs',
    express.static(proofDir, {
      index: false,
      dotfiles: 'deny',
      immutable: false,
      maxAge: '1h',
    }),
  );

  app.use('/api', createApiRouter());
  app.use('/api/*', (_req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'API_ENDPOINT_NOT_FOUND',
        message: 'Endpoint API tidak ditemukan.',
      },
    });
  });

  // Avoid unused config differences while retaining validation/initialization
  // performed by getRuntimeConfig().
  void config;
  return app;
}

export default async function handler(req: any, res: any) {
  try {
    appPromise ??= createApiApp();
    const app = await appPromise;
    return app(req, res);
  } catch (error) {
    // Allow a later invocation to retry initialization after a transient error.
    appPromise = undefined;
    console.error('[Tenpe API] Function initialization failed:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: {
          code: 'API_INITIALIZATION_FAILED',
          message: 'Server API gagal diinisialisasi. Periksa Runtime Logs.',
        },
      });
    }
  }
}
