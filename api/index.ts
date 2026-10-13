import express, { Request, Response, NextFunction } from 'express';
import { getDb } from '../server/db.js';

let cachedApp: express.Express | null = null;

/**
 * Membuat Express app untuk Vercel Serverless Function (/api/*)
 */
export function createApiApp(): express.Express {
  if (cachedApp) {
    return cachedApp;
  }

  const app = express();

  // Middleware dasar
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // CORS & Security headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  // Health check endpoint
  app.get(['/api/health', '/health'], (_req: Request, res: Response) => {
    try {
      getDb();
      res.json({ status: 'ok', serverless: true, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err?.message || 'Database unavailable' });
    }
  });

  // Inisialisasi DB dengan aman saat app dibuat
  try {
    getDb();
  } catch (dbErr) {
    console.error('[Tenpe API] Warning: DB initial check failed, will retry on request:', dbErr);
  }

  // Load router utama aplikasi
  try {
    const { apiRouter } = require('../server/apiRouter.js');
    if (apiRouter) {
      app.use('/api', apiRouter);
      app.use('/', apiRouter);
    }
  } catch (routerErr) {
    console.warn('[Tenpe API] Memuat apiRouter dengan fallback module loader:', routerErr);
    try {
      const routerModule = require('../server/apiRouter');
      const router = routerModule.apiRouter || routerModule.default;
      if (router) {
        app.use('/api', router);
        app.use('/', router);
      }
    } catch (fallbackRouterErr) {
      console.error('[Tenpe API] Gagal memuat apiRouter:', fallbackRouterErr);
    }
  }

  // Catch-all 404 handler dalam format JSON (agar frontend tidak menerima HTML mentah)
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Not Found',
      message: `Endpoint ${req.method} ${req.url} tidak ditemukan di server API.`,
    });
  });

  // Global Error Handler selalu mengembalikan JSON
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Tenpe API] Unhandled Express Error:', err);
    res.status(err.status || 500).json({
      success: false,
      error: 'Internal Server Error',
      message: err?.message || 'Terjadi kesalahan pada server.',
    });
  });

  cachedApp = app;
  return app;
}

/**
 * Vercel Serverless Function Handler
 */
export default async function handler(req: Request, res: Response) {
  try {
    const app = createApiApp();
    return app(req, res);
  } catch (error: any) {
    console.error('[Tenpe API] Function execution failed:', error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      success: false,
      error: 'Function initialization failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}