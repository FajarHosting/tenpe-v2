import os from 'os';
import path from 'path';

/**
 * Deteksi apakah aplikasi berjalan di Vercel Serverless / AWS Lambda
 */
export const isServerless: boolean = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  (typeof process.cwd === 'function' && process.cwd().startsWith('/var/task'))
);

export const isProduction: boolean = process.env.NODE_ENV === 'production' || isServerless;

/**
 * Direktori penyimpanan data yang AMAN untuk Vercel Serverless:
 * - Di Vercel / AWS Lambda: direktori /var/task bersifat READ-ONLY,
 *   sehingga SEMUA penulisan file/database HARUS diarahkan ke /tmp (os.tmpdir()).
 * - Di lokal (development): menggunakan folder ./data relatif terhadap root project.
 */
export const DATA_DIR: string = isServerless
  ? path.join(os.tmpdir(), 'tenpe-data')
  : path.resolve(process.cwd(), 'data');

/**
 * Path database SQLite yang aman
 */
export const DB_PATH: string = process.env.DATABASE_PATH || path.join(DATA_DIR, 'tenpe.db');

export const PORT: number = Number(process.env.PORT) || 3000;
export const JWT_SECRET: string = process.env.JWT_SECRET || 'tenpe-secure-secret-key-2026';
export const APP_URL: string = process.env.APP_URL || (isServerless ? 'https://tenpe-v2.vercel.app' : `http://localhost:${PORT}`);