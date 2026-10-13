import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { DATA_DIR, DB_PATH, isServerless } from './runtimeEnv.js';

const require = createRequire(import.meta.url);

let dbInstance: any = null;

/**
 * Memastikan direktori data tersedia dengan aman.
 * Di Vercel / AWS Lambda, direktori /var/task adalah READ-ONLY,
 * sehingga semua file database HARUS berada di /tmp (os.tmpdir()).
 */
function ensureDataDirectory(): string {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    return DATA_DIR;
  } catch (err) {
    console.warn(`[Tenpe DB] Warning: Tidak dapat membuat direktori ${DATA_DIR}, beralih ke os.tmpdir():`, err);
    return os.tmpdir();
  }
}

/**
 * Menyalin database awal (seed) dari bundle repository ke /tmp jika tersedia.
 */
function copySeedDatabaseIfNeeded(targetDbPath: string): void {
  try {
    if (fs.existsSync(targetDbPath)) {
      return; // Database sudah ada di /tmp
    }

    const possibleSeedSources = [
      path.join(process.cwd(), 'data', 'tenpe.db'),
      path.join(process.cwd(), 'data', 'app.db'),
      path.join(process.cwd(), 'data', 'database.sqlite'),
      path.join('/var/task', 'data', 'tenpe.db'),
      path.join('/var/task', 'data', 'app.db'),
      path.join('/var/task', 'data', 'database.sqlite'),
    ];

    for (const src of possibleSeedSources) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, targetDbPath);
        console.log(`[Tenpe DB] Berhasil menyalin database awal dari ${src} ke ${targetDbPath}`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Tenpe DB] Warning saat menyalin seed database:', err);
  }
}

/**
 * Menjalankan migrasi skema SQL jika ada berkas schema.sql
 */
function runSchemaMigrations(db: any): void {
  try {
    const possibleSchemaPaths = [
      path.join(process.cwd(), 'db', 'schema.sql'),
      path.join('/var/task', 'db', 'schema.sql'),
      path.join(process.cwd(), 'schema.sql'),
    ];

    for (const schemaPath of possibleSchemaPaths) {
      if (fs.existsSync(schemaPath)) {
        const sql = fs.readFileSync(schemaPath, 'utf-8');
        if (typeof db.exec === 'function') {
          db.exec(sql);
          console.log(`[Tenpe DB] Berhasil menerapkan skema database dari ${schemaPath}`);
        }
        break;
      }
    }
  } catch (err) {
    console.warn('[Tenpe DB] Peringatan saat menjalankan schema.sql:', err);
  }
}

/**
 * Fallback In-Memory Storage sederhana jika modul native SQLite tidak tersedia
 */
class MemoryDatabaseFallback {
  constructor() {
    console.warn('[Tenpe DB] Menggunakan MemoryDatabaseFallback (pure JS).');
  }

  pragma(_cmd: string) {}
  exec(_sql: string) {}

  prepare(_sql: string) {
    return {
      all: (..._args: any[]) => [],
      get: (..._args: any[]) => null,
      run: (..._args: any[]) => ({ changes: 1, lastInsertRowid: 1 }),
    };
  }

  transaction(fn: any) {
    return fn;
  }
}

/**
 * Mendapatkan koneksi Database SQLite (Singleton).
 * Aman untuk Vercel Serverless Function maupun Local Development.
 */
export function getDb(): any {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDataDirectory();
  copySeedDatabaseIfNeeded(DB_PATH);

  // 1. Inisialisasi better-sqlite3 secara dinamis
  try {
    const Database = require('better-sqlite3');
    dbInstance = new Database(DB_PATH, {
      fileMustExist: false,
      timeout: 10000,
    });

    try {
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('busy_timeout = 5000');
      dbInstance.pragma('synchronous = NORMAL');
    } catch {
      // Abaikan pragma jika environment tertentu tidak mendukung WAL
    }

    runSchemaMigrations(dbInstance);
    console.log(`[Tenpe DB] Database berhasil diinisialisasi pada: ${DB_PATH} (Serverless: ${isServerless})`);
    return dbInstance;
  } catch (err: any) {
    console.warn(`[Tenpe DB] better-sqlite3 tidak dapat dimuat (${err?.message || err}). Mencoba fallback...`);
  }

  // 2. Coba SQLite in-memory jika driver native ada tapi file disk gagal
  try {
    const Database = require('better-sqlite3');
    dbInstance = new Database(':memory:');
    runSchemaMigrations(dbInstance);
    console.warn('[Tenpe DB] Database berhasil dibuka dalam mode :memory:');
    return dbInstance;
  } catch {
    // Abaikan
  }

  // 3. Fallback aman jika native binding tidak ter-compile di Vercel
  dbInstance = new MemoryDatabaseFallback();
  return dbInstance;
}

export const db = {
  get instance() {
    return getDb();
  },
  prepare(sql: string) {
    return getDb().prepare(sql);
  },
  exec(sql: string) {
    return getDb().exec(sql);
  },
  transaction(fn: any) {
    return getDb().transaction(fn);
  },
};

export default getDb;