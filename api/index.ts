import { createExpressApp } from '../server.ts';

// Build the Express API once per warm serverless instance.
// Do not start a listener or mount Vite inside a Vercel Function.
let appPromise: ReturnType<typeof createExpressApp> | undefined;

export default async function handler(req: any, res: any) {
  try {
    if (!appPromise) {
      appPromise = createExpressApp({ skipVite: true });
    }
    const app = await appPromise;
    return app(req, res);
  } catch (error) {
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
