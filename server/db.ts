import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { DATA_DIR, DB_PATH, isServerless } from './runtimeEnv.js';

const require = createRequire(import.meta.url);

let dbInstance: any = null;

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

function copySeedDatabaseIfNeeded(targetDbPath: string): void {
  try {
    if (fs.existsSync(targetDbPath)) {
      return;
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
 * Database Engine Persisten berbasis File JSON di /tmp.
 * Berjalan otomatis jika better-sqlite3 belum terpasang di Vercel,
 * sehingga registrasi akun baru, login, dan katalog layanan tetap berfungsi normal.
 */
class PersistentJsonDb {
  private filePath: string;
  private data: Record<string, any[]> = {
    users: [],
    orders: [],
    services: [],
    products: [],
    settings: [],
    transactions: [],
  };

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
    this.initDefaultSeed();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = { ...this.data, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn('[Tenpe DB] Inisialisasi data store baru:', err);
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[Tenpe DB] Gagal menyimpan store:', err);
    }
  }

  private initDefaultSeed(): void {
    if (!this.data.services || this.data.services.length === 0) {
      this.data.services = [
        {
          id: 1,
          name: 'Instagram Followers Premium',
          category: 'Instagram',
          min_amount: 100,
          max_amount: 10000,
          price_per_k: 15000,
          status: 'active',
          description: 'Layanan followers real & aktif garansi 30 hari.',
        },
        {
          id: 2,
          name: 'TikTok Likes Instant',
          category: 'TikTok',
          min_amount: 50,
          max_amount: 50000,
          price_per_k: 8000,
          status: 'active',
          description: 'Layanan likes proses cepat masuk dalam hitungan menit.',
        },
        {
          id: 3,
          name: 'YouTube Views High Retention',
          category: 'YouTube',
          min_amount: 500,
          max_amount: 100000,
          price_per_k: 25000,
          status: 'active',
          description: 'Views monetisasi aman dengan retensi tinggi.',
        },
      ];
      this.save();
    }
  }

  pragma(_cmd: string) {}

  exec(sql: string) {
    if (/CREATE TABLE/i.test(sql)) {
      const match = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-zA-Z0-9_]+)/i);
      if (match && match[1]) {
        const tbl = match[1].toLowerCase();
        if (!this.data[tbl]) {
          this.data[tbl] = [];
          this.save();
        }
      }
    }
  }

  prepare(sql: string) {
    const self = this;
    const cleanSql = sql.trim();

    return {
      all(...params: any[]) {
        self.load();
        const selectMatch = cleanSql.match(/SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+))?/i);
        if (!selectMatch) {
          return [];
        }
        const tableName = selectMatch[2].toLowerCase();
        const rows = self.data[tableName] || [];
        const whereClause = selectMatch[3];
        if (!whereClause) {
          return [...rows];
        }
        return self.filterRows(rows, whereClause, params);
      },

      get(...params: any[]) {
        const results = this.all(...params);
        return results.length > 0 ? results[0] : null;
      },

      run(...params: any[]) {
        self.load();
        const insertMatch = cleanSql.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)\s*\((.+?)\)\s*VALUES/i);
        if (insertMatch) {
          const tableName = insertMatch[1].toLowerCase();
          const colNames = insertMatch[2].split(',').map((c) => c.trim().replace(/[`"']/g, ''));

          if (!self.data[tableName]) {
            self.data[tableName] = [];
          }

          const newRow: Record<string, any> = {};
          colNames.forEach((col, idx) => {
            newRow[col] = params[idx] !== undefined ? params[idx] : null;
          });

          if (!newRow.id) {
            newRow.id = self.data[tableName].length + 1;
          }
          if (!newRow.created_at) {
            newRow.created_at = new Date().toISOString();
          }

          self.data[tableName].push(newRow);
          self.save();
          return { changes: 1, lastInsertRowid: newRow.id };
        }

        const updateMatch = cleanSql.match(/UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
        if (updateMatch) {
          const tableName = updateMatch[1].toLowerCase();
          const rows = self.data[tableName] || [];
          let changes = 0;

          const setParts = updateMatch[2].split(',').map((s) => s.trim());
          const whereClause = updateMatch[3];

          let paramIdx = 0;
          const updates: Record<string, any> = {};
          for (const sp of setParts) {
            const [c] = sp.split('=').map((x) => x.trim().replace(/[`"']/g, ''));
            updates[c] = params[paramIdx++];
          }

          const whereParams = params.slice(paramIdx);
          for (let i = 0; i < rows.length; i++) {
            if (whereClause ? self.matchWhere(rows[i], whereClause, whereParams) : true) {
              rows[i] = { ...rows[i], ...updates };
              changes++;
            }
          }

          if (changes > 0) {
            self.save();
          }
          return { changes, lastInsertRowid: null };
        }

        const deleteMatch = cleanSql.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+))?$/i);
        if (deleteMatch) {
          const tableName = deleteMatch[1].toLowerCase();
          const rows = self.data[tableName] || [];
          const whereClause = deleteMatch[2];

          const remaining = rows.filter((r) => (whereClause ? !self.matchWhere(r, whereClause, params) : false));
          const changes = rows.length - remaining.length;
          self.data[tableName] = remaining;
          if (changes > 0) {
            self.save();
          }
          return { changes, lastInsertRowid: null };
        }

        return { changes: 0, lastInsertRowid: null };
      },
    };
  }

  private filterRows(rows: any[], whereClause: string, params: any[]): any[] {
    return rows.filter((r) => this.matchWhere(r, whereClause, params));
  }

  private matchWhere(row: any, whereClause: string, params: any[]): boolean {
    const cleanWhere = whereClause.trim().replace(/ORDER\s+BY.+/i, '').replace(/LIMIT.+/i, '').trim();

    if (/OR/i.test(cleanWhere)) {
      const parts = cleanWhere.split(/\s+OR\s+/i);
      return parts.some((part, idx) => this.evalSimpleCond(row, part.trim(), params[idx]));
    }

    if (/AND/i.test(cleanWhere)) {
      const parts = cleanWhere.split(/\s+AND\s+/i);
      return parts.every((part, idx) => this.evalSimpleCond(row, part.trim(), params[idx]));
    }

    return this.evalSimpleCond(row, cleanWhere, params[0]);
  }

  private evalSimpleCond(row: any, condStr: string, paramVal: any): boolean {
    const eqMatch = condStr.match(/([a-zA-Z0-9_]+)\s*=\s*\?/);
    if (eqMatch) {
      const col = eqMatch[1].replace(/[`"']/g, '');
      return String(row[col]) === String(paramVal);
    }
    return true;
  }

  transaction(fn: any) {
    return (...args: any[]) => fn(...args);
  }
}

export function getDb(): any {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = ensureDataDirectory();
  copySeedDatabaseIfNeeded(DB_PATH);

  // 1. Coba better-sqlite3 jika tersedia
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
      // Abaikan pragma
    }

    console.log(`[Tenpe DB] Menggunakan SQLite Database (better-sqlite3) di: ${DB_PATH}`);
    return dbInstance;
  } catch (err: any) {
    console.warn(`[Tenpe DB] better-sqlite3 tidak terpasang (${err?.message || err}). Mengaktifkan Persistent JSON DB...`);
  }

  // 2. Fallback ke Persistent JSON DB di /tmp
  const jsonDbPath = path.join(dataDir, 'tenpe-store.json');
  dbInstance = new PersistentJsonDb(jsonDbPath);
  console.log(`[Tenpe DB] Berhasil menggunakan Persistent JSON DB di: ${jsonDbPath}`);
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